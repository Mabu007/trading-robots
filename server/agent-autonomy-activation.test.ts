import {describe,it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {initialTask} from '../shared/agent-task-state.ts';
import {activateDemoRobot,candidateBotId} from './agent-autonomy-activation.ts';
import {evaluateAgentDraft} from './agent-task-backtest.ts';

vi.mock('./agent-task-backtest.ts',()=>({evaluateAgentDraft:vi.fn()}));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const now=Date.parse('2026-11-09T16:00:00Z');
const source='export const config = {timeframes:["m1"],executionTimeframe:"m1",riskPercent:0.25,riskReward:2,backtestSpread:0.1,backtestSlippage:0.1,backtestCommissionR:0.04}; export function onCandle(ctx){return {action:"WAIT"};}';
const codeHash=hash(source),policyId='policy_12345678',draftId='draft_'+codeHash.slice(0,32);
const evalId='evaluation_1234567890abcdef1234567890abcdef',reportIds=['backtest_'+'a'.repeat(32),'backtest_'+'b'.repeat(32)];
const task=(()=>{
 const t=initialTask('owner','agenttask_12345678','trade propdao evaluation gold',now,80,60,true);
 t.autonomy={enabled:true,stage:'activating',stopRequested:false,completedCycles:0,policyRequired:true};
 t.policy={policyId,fingerprint:'a'.repeat(64),accountId:'prop_eval_1234',mode:'full-demo',
  expiresAt:253402300799000,linkedAt:now};
 t.memory.artifacts=[{kind:'draft',id:draftId,codeHash,updatedAt:new Date(now).toISOString()},
  {kind:'evaluation',id:evalId,codeHash,reviewEligible:true,updatedAt:new Date(now).toISOString()}];
 return t;
})();
const policy={version:1,id:policyId,ownerUid:'owner',mode:'full-demo',venue:'propdao',demoOnly:true,
 accountId:task.policy!.accountId,fingerprint:task.policy!.fingerprint,revokedAt:null,expiresAt:253402300799000,
 maxRiskUsd:.25,maxDrawdownPct:3,maxDailyLossPct:1,maxOpenPositions:1,instruments:['GOLDUSDC'],allowReplace:true};
const metrics={trades:15,netReturn:4,profitFactor:1.6,maxDrawdown:3,winRate:0.6};
function fixture(){
 const objects=new Map<string,string>(),store=new Map<string,any>(),live={
  status:vi.fn(async()=>({connected:true,configured:true,deployed:false,running:false})),
  reviewAutonomous:vi.fn(async()=>({reviewId:'a'.repeat(48),expectedCodeHash:codeHash,expiresAt:now+120000})),
  deploy:vi.fn(async()=>({running:true,uncertain:false}))
 };
 store.set('users/owner/agent-policies/'+policyId,policy);
 const base='agent-task-drafts/v1/'+Buffer.from('owner').toString('base64url')+'/agenttask_12345678/';
 objects.set(base+draftId+'.json',JSON.stringify({ownerUid:'owner',taskId:task.id,codeHash,source,venue:'propdao',asset:'GOLDUSDC'}));
 objects.set(base+evalId+'.json',JSON.stringify({ownerUid:'owner',taskId:task.id,codeHash,reportIds,evaluation:{acceptedForResearchReview:true}}));
 for(let i=0;i<2;i++){
  const end=now-i*2000*60000,from=end-2000*60000;
  objects.set(base+reportIds[i]+'.json',JSON.stringify({ownerUid:'owner',taskId:task.id,draftId,codeHash,
   reportId:reportIds[i],windowIndex:i,tradeCount:15,metrics,coverage:[{timeframe:'m1',count:2000,
    from:new Date(from).toISOString(),toExclusive:new Date(end).toISOString()}]}));
 }
 vi.mocked(evaluateAgentDraft).mockImplementation(async(input:any)=>{
  const end=now-input.windowIndex*2000*60000,from=end-2000*60000;
  return {codeHash,coin:'xyz:GOLD',source:'Hyperliquid public completed candles',tradeCount:15,metrics,
   worstLossR:-.9,windowIndex:input.windowIndex,
   coverage:[{timeframe:'m1',count:2000,from:new Date(from).toISOString(),toExclusive:new Date(end).toISOString()}],
   assumptions:{spread:.1,slippage:.1,commissionR:.04},dataGaps:0,quality:'reference',
   challengeSummary:{status:'not-passed',maxObservedDailyLoss:3,maxObservedDrawdown:10}} as any
 });
 return {live,objects,store,deps:{
  store:{get:async(key:string)=>store.get(key)||null,
   create:async(key:string,value:any)=>{if(store.has(key))return false;store.set(key,value);return true},
   query:async()=>[],put:async(key:string,value:any)=>store.set(key,value)} as any,
  objects:{read:async(k:string)=>objects.get(k)||null,write:async(k:string,v:string)=>{objects.set(k,v)}},
  market:{hyperliquidCandles:vi.fn()} as any,
  accounts:{snapshot:vi.fn(async()=>({simulated:true,account:{accountId:policy.accountId,status:'active',
   challenge:{name:'Iron $1K Evaluation'}},risk:{breached:false,roomUsd:49,equity:1000},positions:[],orders:[]}))},
  live,now:()=>now,verifyLease:async()=>true
 }};
}
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});
describe('independently authorized PropDAO demo activation',()=>{
 it('never calls broker review or deploy without explicit server execution gate',async()=>{
  const f=fixture();vi.stubEnv('VIBES_DEMO_AUTONOMY_EXECUTION_ENABLED','false');
  const r=await activateDemoRobot(task,f.deps as any);
  expect(r.outcome).toBe('halted');expect(f.live.deploy).not.toHaveBeenCalled();
 });
 it('deploys exact code only after independent replay, owner policy and challenge guard',async()=>{
  const f=fixture();vi.stubEnv('VIBES_DEMO_AUTONOMY_EXECUTION_ENABLED','true');
  const r=await activateDemoRobot(task,f.deps as any);
  expect(r).toMatchObject({outcome:'running',botId:candidateBotId('owner',task.id,codeHash),codeHash});
  expect(f.live.reviewAutonomous).toHaveBeenCalledTimes(1);
  expect(f.live.deploy).toHaveBeenCalledTimes(1);
  expect(f.objects.size).toBeGreaterThan(4);
 });
 it('halts on revoked consent before any broker side effect',async()=>{
  const f=fixture();vi.stubEnv('VIBES_DEMO_AUTONOMY_EXECUTION_ENABLED','true');
  f.store.set('users/owner/agent-policies/'+policyId,{...policy,revokedAt:now});
  expect((await activateDemoRobot(task,f.deps as any)).outcome).toBe('halted');
  expect(f.live.deploy).not.toHaveBeenCalled();
 });
 it('does not deploy into an account with a resting order or open exposure',async()=>{
  const f=fixture();vi.stubEnv('VIBES_DEMO_AUTONOMY_EXECUTION_ENABLED','true');
  f.deps.accounts.snapshot=vi.fn(async()=>({simulated:true,account:{accountId:policy.accountId,
   status:'active',challenge:{name:'Iron $1K Evaluation'}},risk:{breached:false,roomUsd:49,equity:1000},
   positions:[{id:'pos1'}],orders:[]})) as any;
  expect((await activateDemoRobot(task,f.deps as any)).outcome).toBe('halted');
  expect(f.live.deploy).not.toHaveBeenCalled();
 });
 it('rejects a previously running robot with mismatched code instead of placing duplicate grants',async()=>{
  const f=fixture();vi.stubEnv('VIBES_DEMO_AUTONOMY_EXECUTION_ENABLED','true');
  f.live.status=vi.fn(async()=>({connected:true,configured:true,running:true,uncertain:true,
   codeHash:'b'.repeat(64),accountId:policy.accountId})) as any;
  expect((await activateDemoRobot(task,f.deps as any)).outcome).toBe('retry');
  expect(f.live.deploy).not.toHaveBeenCalled();
 });
});
