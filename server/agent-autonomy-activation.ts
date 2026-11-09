import {createHash} from 'node:crypto';
import type {Request} from 'express';
import type {RecordStore} from './firestore-store.ts';
import type {TaskRecord} from '../shared/agent-task-state.ts';
import type {VenueMarketData} from './venue-market-data.ts';
import type {PropDAOAccounts} from './propdao-account.ts';
import type {PropDAOLiveService} from './propdao-live-routes.ts';
import {DemoPolicyStore,verifyPropDAODemoAccount,evaluateDemoPolicy} from './agent-demo-policy.ts';
import {evaluateCandidateWindows,type CandidateWindow} from './agent-candidate-evaluation.ts';
import {evaluateAgentDraft} from './agent-task-backtest.ts';
import {parseStrategyConfig} from '../src/strategy.ts';
import {intervalMs} from './market-data.ts';

type R2={read:(key:string)=>Promise<string|null>;write:(key:string,data:string)=>Promise<void>};
type Live=Pick<PropDAOLiveService,'reviewAutonomous'|'deploy'|'status'>;
type Accounts=Pick<PropDAOAccounts,'snapshot'>;
export type ActivationDeps={
 store:RecordStore;objects:R2;market:Pick<VenueMarketData,'hyperliquidCandles'>;
 accounts:Accounts;live:Live;now?:()=>number;verifyLease?:()=>Promise<boolean>;
};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const root=(uid:string,id:string)=>'agent-task-drafts/v1/'+Buffer.from(uid).toString('base64url')+'/'+id;
const botRoot=(uid:string,id:string)=>'user-bots/'+Buffer.from(uid).toString('base64url')+'/'+id;
const proofRoot=(uid:string,id:string)=>'agent-autonomy-proof/v1/'+Buffer.from(uid).toString('base64url')+'/'+id;
const identity=/^[A-Za-z0-9_-]{8,100}$/;
export function candidateBotId(uid:string,taskId:string,codeHash:string){
 const d=sha([uid,taskId,codeHash].join(':'));
 return 'autobot_'+d.slice(0,32);
}
async function referencedRecord(objects:R2,uid:string,taskId:string,id:string){
 if(!identity.test(id))throw Error('Invalid agent research artifact ID');
 const raw=await objects.read(root(uid,taskId)+'/'+id+'.json');
 if(!raw||raw.length>80_000)throw Error('Agent research artifact is missing or oversized');
 const parsed=JSON.parse(raw);
 if(parsed.ownerUid!==uid||parsed.taskId!==taskId)throw Error('Cross-user artifact cannot be activated');
 return parsed;
}
export type ActivationResult={
 outcome:'running'|'retry'|'research'|'halted';
 botId?:string;codeHash?:string;exposure:'flat'|'open'|'pending'|'unknown';message:string;
};
/**
 * Privileged call path: the task Worker authenticates to an internal Express
 * route that rechecks the exact DO lease. No AI tool receives direct ordering.
 */
export async function activateDemoRobot(task:TaskRecord,deps:ActivationDeps):Promise<ActivationResult>{
 const uid=task.ownerUid,now=(deps.now||Date.now)(),scope=task.policy;
 const rejection=(reason:string):ActivationResult=>({outcome:'halted',exposure:'unknown',message:reason});
 if(!task.autonomy?.enabled||task.autonomy.stopRequested||!scope)
  return rejection('Autonomous DEMO task is not active or no approved account scope is linked');
 if(process.env.VIBES_DEMO_AUTONOMY_EXECUTION_ENABLED!=='true')
  return rejection('Autonomous order deployment has not passed the independent production acceptance gate');
 let policy;
 try{policy=await new DemoPolicyStore(deps.store).owned(uid,scope.policyId)}
 catch{return rejection('Standing demo consent is unavailable; refuse to deploy')}
 if(policy.revokedAt!==null||policy.expiresAt<=now||policy.demoOnly!==true||
  policy.mode!=='full-demo'||policy.fingerprint!==scope.fingerprint||policy.accountId!==scope.accountId||
  policy.maxOpenPositions<1||policy.maxRiskUsd<=0)
  return rejection('Standing authorization was revoked, expired, or is not full-demo');
 let broker;
 try{broker=await deps.accounts.snapshot(uid,scope.accountId)}
 catch{return rejection('Cannot inspect the owned PropDAO account. No deployment attempt was made')}
 if(!broker.simulated||!verifyPropDAODemoAccount(broker.account,undefined,true,broker.simulated)||
  broker.account?.status!=='active'||broker.risk.breached||!Number.isFinite(broker.risk.roomUsd)||
  !Array.isArray(broker.positions)||!Array.isArray(broker.orders))
  return rejection('PropDAO account is not independently classified as an active free evaluation demo');
 if(broker.positions.length||broker.orders.length)return rejection('Existing broker positions or resting orders block new autonomous deployment');
 const maxRisk=Math.min(policy.maxRiskUsd,.5);
 const verdict=evaluateDemoPolicy(policy,{uid,accountId:scope.accountId,instrument:'GOLDUSDC',
  riskUsd:maxRisk,action:'deploy',now,existingPositions:broker.positions.length,
  existingOrders:broker.orders.length,breached:broker.risk.breached,exposureVerified:true});
 if(!verdict.allowed||broker.risk.roomUsd<=maxRisk*4)return rejection('Risk guard rejected activation: '+verdict.reasons.join('; '));
 const candidate=task.memory.artifacts.filter(a=>a.kind==='evaluation'&&a.reviewEligible===true&&a.codeHash).at(-1);
 if(!candidate?.codeHash)return {outcome:'research',exposure:'flat',message:'No independently screened candidate yet; continue research'};
 const savedDraft=task.memory.artifacts.find(a=>a.kind==='draft'&&a.codeHash===candidate.codeHash);
 if(!savedDraft)return rejection('No exact immutable draft source for this evaluated candidate');
 let draft,evaluation;
 try{
  draft=await referencedRecord(deps.objects,uid,task.id,savedDraft.id);
  evaluation=await referencedRecord(deps.objects,uid,task.id,candidate.id);
 }catch{return rejection('Draft and evaluation provenance cannot be independently verified')}
 if(typeof draft.source!=='string'||draft.venue!=='propdao'||draft.asset!=='GOLDUSDC'||
  draft.codeHash!==candidate.codeHash||sha(draft.source)!==candidate.codeHash||
  evaluation.codeHash!==candidate.codeHash||evaluation.evaluation?.acceptedForResearchReview!==true||
  !Array.isArray(evaluation.reportIds)||evaluation.reportIds.length<2||evaluation.reportIds.length>4)
  return rejection('Candidate code, symbol or independent evaluation receipt is inconsistent');
 const code=draft.source,config=parseStrategyConfig(code);
 if(config.riskPercent>0.5||config.executionTimeframe!=='m1'||config.timeframes.length>4)
  return rejection('Autonomous demo accepts only M1 strategies under 0.5% reference risk');
 const challengeName=String((broker.account as any).challenge?.name||(broker.account as any).challenge?.type||'');
 if(!/iron/i.test(challengeName)||!/1\s*k|1000|1,000/i.test(challengeName))
  return rejection('Challenge replay currently certifies only Iron $1,000 evaluation rules');
 const botId=candidateBotId(uid,task.id,candidate.codeHash);
 if(task.autonomy.botId&&task.autonomy.botId!==botId)
  return rejection('Existing task has a different robot; stop and reconcile before replacement');
 // A replayed request must observe an existing grant, never issue a second order intent.
 try{
  const existing=await deps.live.status(uid,botId);
  if(existing?.running===true&&existing?.deployed===true&&!existing?.uncertain&&
   existing?.codeHash===candidate.codeHash&&existing?.accountId===scope.accountId)
    return {outcome:'running',botId,codeHash:candidate.codeHash,
     exposure:existing.brokerExposureVerified?existing.brokerExposure:'unknown',
     message:'Previously activated robot is already running. Exact grant reused.'};
  if(existing?.running||existing?.paused||existing?.uncertain||existing?.pendingIntent||
    existing?.statusUnavailable||existing?.accountOccupied||existing?.activeAuthorization)
   return {outcome:'retry',botId,codeHash:candidate.codeHash,exposure:'unknown',
    message:'Prior broker authorization is not safe for automatic replacement; no duplicate grant.'};
 }catch{
  return {outcome:'retry',botId,codeHash:candidate.codeHash,exposure:'unknown',
   message:'Cannot verify prior broker deployment; no new grant issued'};
 }
 const fresh:CandidateWindow[]=[],challenges:any[]=[];
 for(const id of evaluation.reportIds){
  let report;
  try{report=await referencedRecord(deps.objects,uid,task.id,id)}
  catch{return rejection('Historical report is not an owned immutable object')}
  if(report.draftId!==savedDraft.id||report.codeHash!==candidate.codeHash||
   !Number.isInteger(report.windowIndex)||report.windowIndex<0||report.windowIndex>3||
   !Array.isArray(report.coverage))return rejection('Historical report identity is invalid');
  const longest=report.coverage.reduce((best:any,row:any)=>
   !best||intervalMs[row.timeframe as keyof typeof intervalMs]>intervalMs[best.timeframe as keyof typeof intervalMs]?row:best,null);
  if(!longest||!Number.isInteger(longest.count)||longest.count<120||longest.count>3000)
   return rejection('Historical report lacks a complete reference window');
  const period=intervalMs[longest.timeframe as keyof typeof intervalMs];
  const fixedNow=Date.parse(longest.toExclusive)+report.windowIndex*longest.count*period;
  if(!Number.isFinite(fixedNow)||fixedNow>now)return rejection('Historical window is in the future');
  let replay;
  try{replay=await evaluateAgentDraft({source:code,coin:'xyz:GOLD',lookbackCandles:longest.count,
    market:deps.market,now:fixedNow,windowIndex:report.windowIndex})}
  catch{return {outcome:'retry',botId,codeHash:candidate.codeHash,exposure:'unknown',
   message:'Independent Hyperliquid history/replay is unavailable. No deployment made.'}}
  if(replay.codeHash!==candidate.codeHash||replay.tradeCount!==report.tradeCount||
   Math.abs(replay.metrics.netReturn-report.metrics.netReturn)>1e-7||
   replay.coverage.some((c:any,i:number)=>c.from!==report.coverage[i]?.from||c.toExclusive!==report.coverage[i]?.toExclusive))
   return rejection('Fresh independent QuickJS replay does not match archived candidate');
  const c=replay.coverage.find(row=>row.timeframe===config.executionTimeframe)!;
  fresh.push({codeHash:replay.codeHash,coin:replay.coin,venue:'propdao',reportId:id,
   from:c.from,toExclusive:c.toExclusive,tradeCount:replay.tradeCount,worstLossR:replay.worstLossR,
   metrics:replay.metrics,assumptions:replay.assumptions,quality:'reference',dataGaps:replay.dataGaps,source:replay.source});
  challenges.push(replay.challengeSummary);
 }
 const evaluationResult=evaluateCandidateWindows(fresh,config.riskPercent);
 if(!evaluationResult.acceptedForResearchReview)return {outcome:'research',botId,codeHash:candidate.codeHash,
  exposure:'flat',message:'Independent holdout or risk gate rejected candidate; return to research'};
 if(challenges.some(c=>!c||c.status==='failed-total'||c.status==='failed-daily'||
   c.maxObservedDrawdown>1000*policy.maxDrawdownPct/100||
   c.maxObservedDailyLoss>1000*policy.maxDailyLossPct/100))
  return {outcome:'research',botId,codeHash:candidate.codeHash,exposure:'flat',
   message:'Iron $1,000 reference challenge replay exceeded daily or static loss limits'};
 const botPath='users/'+uid+'/bots/'+botId,sourceKey=botRoot(uid,botId)+'/current.json';
 const prior=await deps.store.get(botPath);
 if(prior&&((prior.userId&&prior.userId!==uid)||prior.ownerUid&&prior.ownerUid!==uid||
  prior.venue!=='propdao'||prior.asset!=='GOLDUSDC'))
  return rejection('Autonomous robot ID collides with another owner or venue');
 if(!prior){
  const created=await deps.store.create(botPath,{
   id:botId,userId:uid,ownerUid:uid,venue:'propdao',asset:'GOLDUSDC',
   name:'VIBES autonomous Gold · '+candidate.codeHash.slice(0,8),
   createdAt:now,updatedAt:now,source:'agent-autonomy',taskId:task.id
  });
  if(!created)return {outcome:'retry',exposure:'unknown',message:'Concurrent strategy creation detected'};
 }
 const previous=await deps.objects.read(sourceKey);
 if(previous){
  const obj=JSON.parse(previous);
  if(obj.userId!==uid||obj.botId!==botId||sha(obj.code)!==candidate.codeHash)
   return rejection('Stored autonomous robot revision differs; never overwrite');
 }else await deps.objects.write(sourceKey,JSON.stringify({schemaVersion:1,userId:uid,botId,
  venue:'propdao',code,updatedAt:new Date(now).toISOString()}));
 const proofKey=proofRoot(uid,task.id)+'/proof_'+candidate.codeHash.slice(0,32)+'.json';
 const proof={version:1,uid,taskId:task.id,botId,codeHash:candidate.codeHash,
  accountId:scope.accountId,riskUsd:maxRisk,policyFingerprint:policy.fingerprint,
  maxDailyLossPct:policy.maxDailyLossPct,maxDrawdownPct:policy.maxDrawdownPct,
  reportIds:evaluation.reportIds,accepted:true,verifiedAt:now,
  challenge:{status:challenges.some(c=>c.status==='passed')?'passed':'not-passed',
   maxObservedDailyLoss:Math.max(...challenges.map(c=>c.maxObservedDailyLoss)),
   maxObservedDrawdown:Math.max(...challenges.map(c=>c.maxObservedDrawdown))}};
 await deps.objects.write(proofKey,JSON.stringify(proof));
 if(deps.verifyLease&&!(await deps.verifyLease()))
  return rejection('Agent was stopped or its activation lease changed during evaluation');
 const latest=await new DemoPolicyStore(deps.store).owned(uid,scope.policyId);
 if(latest.revokedAt!==null||latest.fingerprint!==scope.fingerprint||latest.accountId!==scope.accountId||
  latest.expiresAt<=(deps.now||Date.now)())
  return rejection('Policy changed during server-side replay; no execution permission granted');
 const updated=await deps.accounts.snapshot(uid,scope.accountId);
 if(updated.risk.breached||updated.positions.length||updated.orders.length)
  return rejection('Account exposure changed during evaluation; no deployment authorized');
 const request={body:{accountId:scope.accountId,riskUsd:maxRisk,leverage:1,
  confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING',expectedCodeHash:candidate.codeHash}} as Request;
 let review;
 try{review=await deps.live.reviewAutonomous(uid,botId,{taskId:task.id,accountId:scope.accountId,
  riskUsd:maxRisk,leverage:1,codeHash:candidate.codeHash,proofKey,policyFingerprint:scope.fingerprint},request)}
 catch(e){return {outcome:'retry',botId,codeHash:candidate.codeHash,exposure:'unknown',
  message:'Broker deployment preflight unavailable: '+(e instanceof Error?e.message.slice(0,150):'unknown')}}
 try{
  if(deps.verifyLease&&!(await deps.verifyLease()))
   return rejection('User stopped task before broker deployment; no entries authorized');
  const response=await deps.live.deploy(uid,botId,{...request,body:{...request.body,reviewId:review.reviewId}} as Request);
  if(response.running===true&&!response.uncertain)return {outcome:'running',botId,codeHash:candidate.codeHash,
   exposure:'flat',message:'Exact independently evaluated strategy deployed through existing PropDAO Durable Object'};
  return {outcome:'retry',botId,codeHash:candidate.codeHash,exposure:'unknown',
   message:'Broker accepted deployment request, but running status is uncertain. Do not repeat blindly.'};
 }catch{
  return {outcome:'retry',botId,codeHash:candidate.codeHash,exposure:'unknown',
   message:'Deployment outcome unknown. Existing grant must be reconciled before retry.'};
 }
}
