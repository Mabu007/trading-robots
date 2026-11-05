import {createHash,randomUUID} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {parseStrategyConfig} from '../src/strategy.ts';
import {venueOf,type Venue} from '../shared/venues.ts';
import type {RecordData,RecordStore} from './firestore-store.ts';

export type AgentState='backtest_running'|'backtest_completed'|'backtest_failed'|'deployment_pending'|'running'|'paused'|'stopped'|'unknown';
export type AgentBot={id:string;ownerUid:string;name:string;asset:string;venue:Venue;code:string;updatedAt?:number|string};
export type AgentPermissions={marketDataRead:boolean;backtests:boolean;strategyProposals:boolean;brokerStateRead:boolean;paperExecution:boolean;liveExecution:boolean;executionManagement:boolean};
export type AgentRecord={schemaVersion:1;id:string;ownerUid:string;botId:string;name:string;asset:string;venue:Venue;mode:'backtest'|'live';state:AgentState;strategy:{version:string;codeHash:string;revision:number};configuration:{timeframes:string[];executionTimeframe:string;riskPercent:number;riskReward:number};permissions:AgentPermissions;createdAt:number;updatedAt:number;lastEventAt:number;activeBacktest?:{runId:string;codeHash:string;startedAt:number;heartbeatAt?:number};deployment?:{grantId:string;authorizedAt:number;expiresAt:number;codeHash?:string;strategyVersion?:string;limits:Record<string,string|number|boolean>};lastBacktest?:{runId:string;codeHash:string;completedAt:number;summary:Record<string,number|string>};lastError?:string};
export type AgentAuditEvent={id:string;agentId:string;ownerUid:string;actorUid:string;action:string;fromState:AgentState|null;toState:AgentState;occurredAt:number;source:'backtest-workspace'|'live-runtime';strategyVersion:string;details:Record<string,string|number|boolean|null>};

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const safeId=(value:string)=>/^[A-Za-z0-9_-]{1,100}$/.test(value);
const safeMessage=(value:unknown)=>String(value||'').replace(/sk-or-v1-[A-Za-z0-9]{32,128}/gi,'[redacted]').replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]').replace(/[\r\n\t]+/g,' ').slice(0,300);
const basePermissions=():AgentPermissions=>({marketDataRead:true,backtests:true,strategyProposals:true,brokerStateRead:false,paperExecution:false,liveExecution:false,executionManagement:false});
const summarizeConfig=(code:string)=>{const config=parseStrategyConfig(code);return {timeframes:[...config.timeframes],executionTimeframe:config.executionTimeframe,riskPercent:config.riskPercent,riskReward:config.riskReward}};
const summary=(input:unknown):Record<string,number|string>=>{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid backtest summary');
 const output:Record<string,number|string>={};
 for(const [key,value] of Object.entries(input as Record<string,unknown>)){
  if(!['netReturn','netProfit','winRate','profitFactor','maxDrawdown','trades','wins','losses','currency'].includes(key))continue;
  if(key==='currency'){if(value==='ZAR'||value==='USD'||value==='USDC')output[key]=value;continue;}
  if(typeof value==='number'&&Number.isFinite(value))output[key]=value;
 }
 if(Object.keys(output).length>10)throw Error('Backtest summary is too large');
 return output;
};
const validateBot=(uid:string,bot:AgentBot)=>{
 if(!bot||bot.ownerUid!==uid||!safeId(bot.id)||!bot.name||typeof bot.asset!=='string'||!bot.asset||bot.asset.length>64||typeof bot.code!=='string'||!bot.code.trim()||bot.code.length>180000)throw Error('Saved strategy ownership or content could not be verified');
 return {codeHash:digest(bot.code),configuration:summarizeConfig(bot.code),venue:venueOf(bot.venue)};
};

export class AgentRegistry{
 static readonly BACKTEST_STALE_AFTER_MS=10*60_000;
 private readonly store:RecordStore;private readonly now:()=>number;private readonly uuid:()=>string;
 constructor(store:RecordStore,now:()=>number=Date.now,uuid:()=>string=randomUUID){this.store=store;this.now=now;this.uuid=uuid}
 idFor(uid:string,botId:string){return `agent_${digest(`${uid}\0${botId}`).slice(0,32)}`}
 private path(uid:string,id:string){return `users/${uid}/agents/${id}`}
 private auditPath(uid:string,id:string,eventId:string){return `${this.path(uid,id)}/audit/${eventId}`}
 private eventId(at:number){return `${String(at).padStart(13,'0')}_${this.uuid().replace(/-/g,'')}`}
 private async owned(uid:string,id:string){if(!safeId(id))throw Error('Invalid agent ID');const record=await this.store.get(this.path(uid,id)) as AgentRecord|null;if(!record||record.ownerUid!==uid||record.id!==id)throw Error('Agent not found');return record}
 private makeRecord(uid:string,bot:AgentBot,mode:'backtest'|'live',state:AgentState,at:number,previous?:AgentRecord|null):AgentRecord{
  const verified=validateBot(uid,bot),changed=Boolean(previous&&previous.strategy.codeHash!==verified.codeHash);
  return {schemaVersion:1,id:this.idFor(uid,bot.id),ownerUid:uid,botId:bot.id,name:bot.name.slice(0,80),asset:bot.asset,venue:verified.venue,mode,state,
   strategy:{version:verified.codeHash.slice(0,16),codeHash:verified.codeHash,revision:previous?(previous.strategy.revision+(changed?1:0)):1},
   configuration:verified.configuration,permissions:previous?.permissions||basePermissions(),createdAt:previous?.createdAt||at,updatedAt:at,lastEventAt:at,
   ...(previous?.deployment?{deployment:previous.deployment}:{}),...(previous?.lastBacktest?{lastBacktest:previous.lastBacktest}:{})};
 }
 private event(uid:string,record:AgentRecord,input:{action:string;fromState:AgentState|null;toState:AgentState;source:AgentAuditEvent['source'];details?:Record<string,string|number|boolean|null>}):AgentAuditEvent{
  const at=this.now();return {id:this.eventId(at),agentId:record.id,ownerUid:uid,actorUid:uid,action:input.action,fromState:input.fromState,toState:input.toState,occurredAt:at,source:input.source,strategyVersion:record.strategy.version,details:input.details||{}};
 }
 async list(uid:string):Promise<AgentRecord[]>{
  const collection=`users/${uid}/agents`,rows=await this.store.query(collection);
  for(const row of rows){if(row.ownerUid!==uid||row.state!=='backtest_running'||!row.activeBacktest)continue;const heartbeat=row.activeBacktest.heartbeatAt||row.activeBacktest.startedAt;if(this.now()-heartbeat>AgentRegistry.BACKTEST_STALE_AFTER_MS)await this.failStaleBacktest(uid,String(row.id),String(row.activeBacktest.runId),heartbeat)}
  const fresh=await this.store.query(collection);
  return fresh.filter(row=>row.ownerUid===uid&&row.schemaVersion===1&&typeof row.botId==='string').map(row=>row as AgentRecord).sort((a,b)=>b.updatedAt-a.updatedAt);
 }
 async get(uid:string,id:string){return this.owned(uid,id)}
 async audit(uid:string,id:string):Promise<AgentAuditEvent[]>{
  await this.owned(uid,id);const rows=await this.store.query(`${this.path(uid,id)}/audit`);return rows.filter(row=>row.ownerUid===uid&&row.agentId===id).map(row=>row as AgentAuditEvent).sort((a,b)=>a.occurredAt-b.occurredAt).slice(-100);
 }
 async startBacktest(uid:string,bot:AgentBot){
  const verified=validateBot(uid,bot);await this.list(uid);const id=this.idFor(uid,bot.id),path=this.path(uid,id),existing=await this.store.get(path) as AgentRecord|null;
  if(existing&&existing.ownerUid!==uid)throw Error('Agent identity ownership mismatch');
  if(existing&&['backtest_running','deployment_pending','running','paused','unknown'].includes(existing.state))throw Error(existing.mode==='live'?'A live agent process must be verified stopped before starting another backtest':'An active backtest agent process must finish before starting another backtest');
  const at=this.now(),runId=this.uuid(),auditId=this.eventId(at),auditPath=this.auditPath(uid,id,auditId);
  const makeRun=(previous:AgentRecord|null)=>{if(previous&&previous.ownerUid!==uid)throw Error('Agent identity ownership mismatch');if(previous&&['backtest_running','deployment_pending','running','paused','unknown'].includes(previous.state))throw Error(previous.mode==='live'?'A live agent process must be verified stopped before starting another backtest':'An active backtest agent process must finish before starting another backtest');const record=this.makeRecord(uid,bot,'backtest','backtest_running',at,previous);record.permissions=basePermissions();record.activeBacktest={runId,codeHash:verified.codeHash,startedAt:at,heartbeatAt:at};delete record.lastError;const changed=Boolean(previous&&previous.strategy.codeHash!==verified.codeHash);const event={...this.event(uid,record,{action:'backtest_started',fromState:previous?.state||null,toState:'backtest_running',source:'backtest-workspace',details:{runId,...(changed?{previousStrategyVersion:previous!.strategy.version}:{}),codeHash:verified.codeHash}}),id:auditId};return {record,event}};
  if(this.store.transaction){let result:{record:AgentRecord;event:AgentAuditEvent}|undefined;await this.store.transaction([path,auditPath],records=>{result=makeRun(records[0] as AgentRecord|null);return {[path]:result.record,[auditPath]:result.event}});return {agent:result!.record,runId}}
  const result=makeRun(existing);await this.store.put(path,result.record);await this.store.create(auditPath,result.event);return {agent:result.record,runId};
 }
 async heartbeatBacktest(uid:string,botId:string,runId:string){
  const id=this.idFor(uid,botId),path=this.path(uid,id),existing=await this.owned(uid,id);
  if(existing.mode!=='backtest'||existing.state!=='backtest_running'||existing.activeBacktest?.runId!==runId)throw Error('This backtest run is no longer active for the selected agent');
  const at=this.now(),next={...existing,updatedAt:at,lastEventAt:at,activeBacktest:{...existing.activeBacktest,heartbeatAt:at}};
  if(this.store.transaction){let updated:AgentRecord|undefined;await this.store.transaction([path],records=>{const current=records[0] as AgentRecord|null;if(!current||current.ownerUid!==uid||current.mode!=='backtest'||current.state!=='backtest_running'||current.activeBacktest?.runId!==runId)throw Error('This backtest run is no longer active for the selected agent');updated={...current,updatedAt:at,lastEventAt:at,activeBacktest:{...current.activeBacktest!,heartbeatAt:at}};return {[path]:updated}});return updated!}
  await this.store.put(path,next);return next;
 }
 private async failStaleBacktest(uid:string,id:string,runId:string,observedHeartbeat:number){
  if(!safeId(id)||!safeId(runId))return;const path=this.path(uid,id),eventId=this.eventId(this.now()),auditPath=this.auditPath(uid,id,eventId),at=this.now();
  const mutate=(current:RecordData|null)=>{
   if(!current||current.ownerUid!==uid||current.state!=='backtest_running'||current.activeBacktest?.runId!==runId)return null;
   const heartbeat=current.activeBacktest.heartbeatAt||current.activeBacktest.startedAt;if(heartbeat!==observedHeartbeat||at-heartbeat<=AgentRegistry.BACKTEST_STALE_AFTER_MS)return null;
   const next={...current,state:'backtest_failed' as const,updatedAt:at,lastEventAt:at,lastError:'Backtest heartbeat expired; this browser run was interrupted.'} as AgentRecord;delete next.activeBacktest;
   const audit=this.event(uid,next,{action:'backtest_interrupted',fromState:'backtest_running',toState:'backtest_failed',source:'backtest-workspace',details:{runId,heartbeatAt:heartbeat}});
   return {next,audit};
  };
  if(this.store.transaction){await this.store.transaction([path,auditPath],records=>{const result=mutate(records[0]);return result?{[path]:result.next,[auditPath]:result.audit}:{}});return}
  const current=await this.store.get(path),result=mutate(current);if(result){await this.store.put(path,result.next);await this.store.create(auditPath,result.audit)}
 }
 async finishBacktest(uid:string,bot:AgentBot,runId:string,outcome:'completed'|'failed',result?:unknown,error?:unknown){
  const verified=validateBot(uid,bot),id=this.idFor(uid,bot.id),path=this.path(uid,id),existing=await this.owned(uid,id);
  if(existing.mode!=='backtest'||existing.state!=='backtest_running'||existing.activeBacktest?.runId!==runId)throw Error('This backtest run is no longer active for the selected agent');
  const at=this.now(),next=this.makeRecord(uid,bot,'backtest',outcome==='completed'?'backtest_completed':'backtest_failed',at,existing),runCodeHash=existing.activeBacktest.codeHash;
  delete next.activeBacktest;
  if(outcome==='completed')next.lastBacktest={runId,codeHash:runCodeHash,completedAt:at,summary:summary(result)};
  if(outcome==='failed')next.lastError=safeMessage(error)||'Backtest failed';
  const action=outcome==='completed'?'backtest_completed':'backtest_failed';
  const event=this.event(uid,next,{action,fromState:'backtest_running',toState:next.state,source:'backtest-workspace',details:{runId,codeHash:runCodeHash,...(outcome==='completed'?summary(result):{error:next.lastError||'Backtest failed'}),strategyChangedDuringRun:verified.codeHash!==runCodeHash}});
  if(this.store.transaction){await this.store.transaction([path,this.auditPath(uid,id,event.id)],records=>{const current=records[0] as AgentRecord|null;if(!current||current.ownerUid!==uid||current.mode!=='backtest'||current.state!=='backtest_running'||current.activeBacktest?.runId!==runId)throw Error('This backtest run is no longer active for the selected agent');return {[path]:next,[this.auditPath(uid,id,event.id)]:event}});}
  else{await this.store.put(path,next);await this.store.create(this.auditPath(uid,id,event.id),event);}
  return next;
 }
 async liveTransition(uid:string,bot:AgentBot,input:{state:AgentState;action:string;grantId?:string;expiresAt?:number;codeHash?:string;limits?:Record<string,string|number|boolean>;error?:string;authorized?:boolean}){
  const verified=validateBot(uid,bot);const id=this.idFor(uid,bot.id),path=this.path(uid,id),existing=await this.store.get(path) as AgentRecord|null;
  if(existing&&existing.ownerUid!==uid)throw Error('Agent identity ownership mismatch');
  const at=this.now(),auditId=this.eventId(at),auditPath=this.auditPath(uid,id,auditId);
  const makeTransition=(previous:AgentRecord|null)=>{
   if(previous&&previous.ownerUid!==uid)throw Error('Agent identity ownership mismatch');
   if(previous?.state==='backtest_running')throw Error('Finish or cancel the active backtest before changing live agent state');
   const next=this.makeRecord(uid,bot,'live',input.state,at,previous),hasGrant=Boolean(input.grantId||previous?.deployment?.grantId);
   const authorized=input.authorized??(['deployment_pending','running','paused'].includes(input.state)||(input.state==='unknown'&&Boolean(input.grantId)));
   next.permissions={...basePermissions(),brokerStateRead:hasGrant,liveExecution:authorized&&hasGrant,executionManagement:true};
   if(input.grantId&&input.expiresAt){const sameGrant=previous?.deployment?.grantId===input.grantId,codeHash=input.codeHash||(sameGrant?previous?.deployment?.codeHash:undefined)||verified.codeHash;next.deployment={grantId:input.grantId,authorizedAt:sameGrant?(previous?.deployment?.authorizedAt||at):at,expiresAt:input.expiresAt,codeHash,strategyVersion:codeHash.slice(0,16),limits:input.limits||previous?.deployment?.limits||{}}}
   if(input.state==='stopped'||input.state==='unknown'&&!authorized)next.permissions={...basePermissions(),brokerStateRead:hasGrant,executionManagement:true};
   if(input.error)next.lastError=safeMessage(input.error)||'Runtime outcome unavailable';else delete next.lastError;
   const details:Record<string,string|number|boolean|null>={...(input.grantId?{grantId:input.grantId}:{}),...(input.expiresAt?{expiresAt:input.expiresAt}:{}),...(input.authorized!==undefined?{executionAuthorized:input.authorized}:{}),...(input.error?{error:next.lastError||'Runtime outcome unavailable'}:{}),...(input.limits?Object.fromEntries(Object.entries(input.limits).filter(([key])=>['riskUsd','leverage','allocation','riskBps','dailyLossBps'].includes(key))):{})};
   const event={...this.event(uid,next,{action:input.action,fromState:previous?.state||null,toState:input.state,source:'live-runtime',details}),id:auditId};return {next,event};
  };
  if(this.store.transaction){let result:{next:AgentRecord;event:AgentAuditEvent}|undefined;await this.store.transaction([path,auditPath],records=>{result=makeTransition(records[0] as AgentRecord|null);return {[path]:result.next,[auditPath]:result.event}});return result!.next}
  const result=makeTransition(existing);await this.store.put(path,result.next);await this.store.create(auditPath,result.event);return result.next;
 }
}

type AgentRoutes={uid:(req:Request,res:Response)=>Promise<string|null>;registry:AgentRegistry;bot:(uid:string,id:string,req:Request)=>Promise<AgentBot|null>;runtimeStatus?:(uid:string,agent:AgentRecord)=>Promise<RecordData>;ready?:()=>boolean};
export function agentRoutes(app:Express,deps:AgentRoutes){
 const route=(handler:(uid:string,req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{res.setHeader('Cache-Control','private, no-store');const uid=await deps.uid(req,res);if(!uid)return;if(deps.ready&&!deps.ready())return res.status(503).json({error:'Firebase server credentials are not configured for agent persistence.'});try{return res.json(await handler(uid,req,res))}catch(e){const message=e instanceof Error?e.message:'Agent request failed';const missing=/not found/i.test(message);return res.status(missing?404:/not configured|unavailable/i.test(message)?503:400).json({error:message})}};
 app.get('/api/agents',route(uid=>deps.registry.list(uid)));
 app.get('/api/agents/:id/audit',route((uid,req)=>deps.registry.audit(uid,String(req.params.id))));
 app.get('/api/agents/:id/status',route(async(uid,req)=>{const agent=await deps.registry.get(uid,String(req.params.id));if(!deps.runtimeStatus)return {agentId:agent.id,state:agent.state,verified:false};return deps.runtimeStatus(uid,agent)}));
 app.get('/api/agents/:id',route((uid,req)=>deps.registry.get(uid,String(req.params.id))));
 app.post('/api/agents/backtest',route(async(uid,req)=>{
  const input=req.body||{},botId=String(input.botId||'');if(!safeId(botId))throw Error('Choose a saved strategy before recording a backtest');
  const saved=await deps.bot(uid,botId,req);if(!saved)throw Error('Saved strategy ownership could not be verified');
  if(input.action==='start'){
   const bot:AgentBot={...saved,code:typeof input.code==='string'?input.code:saved.code,asset:typeof input.asset==='string'?input.asset:saved.asset};
   if(bot.venue!==saved.venue)throw Error('Backtest venue does not match the saved strategy');
   return deps.registry.startBacktest(uid,bot);
  }
  if(input.action==='heartbeat'){
   if(typeof input.runId!=='string'||!safeId(input.runId))throw Error('Invalid backtest run ID');
   return deps.registry.heartbeatBacktest(uid,botId,input.runId);
  }
  if(input.action!=='completed'&&input.action!=='failed')throw Error('Unknown backtest event');
  if(typeof input.runId!=='string'||!safeId(input.runId))throw Error('Invalid backtest run ID');
  return deps.registry.finishBacktest(uid,saved,input.runId,input.action,input.summary,input.error);
 }));
}
