import {createHash} from 'node:crypto';
import type {RecordStore} from './firestore-store.ts';
import {safeExecutionEvents,type ExecutionEvent} from '../shared/propdao-execution-journal.ts';
import {reconcileTradeIdentity,type BrokerTradeEvidence,type TradeLink} from './trade-attribution.ts';
import {diagnoseBrokerTrade,summarizeDeterministicPerformance,type DecisionEvidence} from './trade-diagnostics.ts';

type Trade={id:string;symbol:string;side:'BUY'|'SELL';qty:number;entry:number;exit:number;pnl:number;openedAt:number|null;closedAt:number|null;reason:string;fee:number|null;positionId?:string|null;intentId?:string|null;orderId?:string|null};
type Account={accountId:string;status:string};
type Broker={list:(uid:string)=>Promise<{connected:boolean;accounts:Account[]}>;recentTrades:(uid:string,accountId:string)=>Promise<Trade[]>;
 tradesSince?:(uid:string,accountId:string,sinceMs:number,maxRecords?:number)=>Promise<{trades:Trade[];complete:boolean;capped:boolean;pages:number;providerTotal:number|null}>};
type Decision=DecisionEvidence;
type History=(uid:string,accountId:string)=>Promise<{available:boolean;partial?:boolean;events?:ExecutionEvent[]|null;
 decisionSnapshots?:Decision[];liveTrades?:Trade[];sqlLiveAvailable?:boolean;
 sqlCoverage?:Array<{botId:string;running:boolean;brokerSync?:{time:number;capped?:boolean}|null}>;
 error?:string}>;
const hash=(...parts:string[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,40);
const validId=(v:string)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const timestamp=(v:number|null)=>{
 if(typeof v!=='number'||!Number.isFinite(v))return null;
 const ms=v>1e11?v:v*1000;
 return ms>=946684800000&&ms<4102444800000?ms:null;
};
export const sastDay=(ms=Date.now())=>new Date(ms+7200000).toISOString().slice(0,10);
const validTrade=(v:any):v is Trade=>v&&typeof v.id==='string'&&v.id.length>0&&v.id.length<161&&
 typeof v.symbol==='string'&&v.symbol.length<=40&&['BUY','SELL'].includes(v.side)&&
 [v.qty,v.entry,v.exit,v.pnl].every((x:unknown)=>typeof x==='number'&&Number.isFinite(x));
const sum=(values:number[])=>Math.round(values.reduce((a,b)=>a+b,0)*1e6)/1e6;

/** Existing API kept for prior callers; live callers pass authenticated accountId. */
export function attributeTrade(t:Trade&{accountId?:string},events:ExecutionEvent[]):TradeLink{
 const scopes=[...new Set(events.map(e=>e.accountId))];
 const accountId=t.accountId??(scopes.length===1?scopes[0]:'');
 return reconcileTradeIdentity({...t,accountId},events);
}
export function summarizeDay(trades:Array<Trade&{accountId:string;botId:string|null;attribution:string;grantId?:string|null;strategyCodeHash?:string|null}>,day:string,coverage:{
 accountsChecked:number;failures:string[];capped:string[];journalWarnings:string[];ledgerAvailable:boolean;writeFailures:number;
}){
 const unknownTimes=trades.filter(t=>timestamp(t.closedAt)===null).length;
 const today=trades.filter(t=>{const ms=timestamp(t.closedAt);return ms!==null&&sastDay(ms)===day})
  .sort((a,b)=>(timestamp(b.closedAt)||0)-(timestamp(a.closedAt)||0));
 const losses=today.filter(t=>t.pnl<0),wins=today.filter(t=>t.pnl>0),decided=today.filter(t=>t.pnl!==0);
 const byRobot=new Map<string,{botId:string;trades:number;losses:number;pnl:number}>();
 for(const t of today){const k=t.attribution==='exact-provider-identity'&&t.botId?t.botId:'unattributed-or-probable',g=byRobot.get(k)||{botId:k,trades:0,losses:0,pnl:0};
  g.trades++;g.losses+=Number(t.pnl<0);g.pnl+=t.pnl;byRobot.set(k,g);}
 return {available:true,day,timeZone:'Africa/Johannesburg',window:'00:00–23:59 SAST',
  source:'Owner-authenticated PropDAO closed trades, Cloudflare journal, Firestore observation ledger',
  accountsChecked:coverage.accountsChecked,failedAccounts:coverage.failures,historyCapped:coverage.capped,
  journalWarnings:coverage.journalWarnings,ledgerAvailable:coverage.ledgerAvailable,
  partial:unknownTimes>0||coverage.failures.length>0||coverage.capped.length>0||
   coverage.journalWarnings.length>0||!coverage.ledgerAvailable||coverage.writeFailures>0,
  unknownClosedAtCount:unknownTimes,closedTradesToday:today.length,losses:losses.length,wins:wins.length,
  winRatePercent:decided.length?Number((100*wins.length/decided.length).toFixed(2)):null,
  reportedPnl:sum(today.map(t=>t.pnl)),
  feesReported:today.every(t=>t.fee!==null)?sum(today.map(t=>t.fee||0)):null,
  pnlCaveat:'It is unverified whether broker P/L includes fees: do not double deduct.',
  worstLoss:losses.length?Math.min(...losses.map(t=>t.pnl)):null,
  avgLoss:losses.length?sum(losses.map(t=>t.pnl))/losses.length:null,
  stopLossCount:today.filter(t=>/^(?:SL|STOP[_ -]?LOSS|STOPPED[_ -]?OUT)$/i.test(t.reason)).length,
  matchedRobotTrades:today.filter(t=>t.attribution==='exact-provider-identity').length,
  probableRobotTrades:today.filter(t=>t.attribution==='probable-entry-evidence').length,
  conflictingTrades:today.filter(t=>t.attribution==='conflicting-evidence').length,
  unattributedTrades:today.filter(t=>t.attribution!=='exact-provider-identity'&&t.attribution!=='probable-entry-evidence').length,
  byRobot:[...byRobot.values()].map(g=>({...g,pnl:Math.round(g.pnl*1e6)/1e6})),
  recentTrades:today.slice(0,20).map(t=>({
   accountId:t.accountId,tradeId:t.id,botId:t.botId,grantId:t.grantId??null,
   attribution:t.attribution,confidence:t.attribution==='exact-provider-identity'?'verified':t.attribution==='probable-entry-evidence'?'probable':'unknown',
   strategyCodeHash:t.strategyCodeHash??null,symbol:t.symbol,side:t.side,pnl:t.pnl,fee:t.fee,
   reason:t.reason,entry:t.entry,exit:t.exit,
   openedAtUTC:timestamp(t.openedAt)!==null?new Date(timestamp(t.openedAt)!).toISOString():null,
   closedAtUTC:timestamp(t.closedAt)!==null?new Date(timestamp(t.closedAt)!).toISOString():null
  })),
  verifiedRobotPerformance:[...new Set(today.filter(t=>t.attribution==='exact-provider-identity'&&t.botId).map(t=>t.botId!))].slice(0,12).map(botId=>({
   botId,attribution:'exact-provider-identity',
   metrics:summarizeDeterministicPerformance(today.filter(t=>t.botId===botId&&t.attribution==='exact-provider-identity').map(t=>({...t,accountId:t.accountId})))
  })),
  recentLosses:losses.slice(0,12).map(t=>({accountId:t.accountId,tradeId:t.id,botId:t.botId,attribution:t.attribution,
   side:t.side,symbol:t.symbol,pnl:t.pnl,fee:t.fee,reason:t.reason,entry:t.entry,exit:t.exit,
   grantId:t.grantId??null,strategyCodeHash:t.strategyCodeHash??null,
   confidence:t.attribution==='exact-provider-identity'?'verified':t.attribution==='probable-entry-evidence'?'probable':'unknown',
   openedAtUTC:timestamp(t.openedAt)!==null?new Date(timestamp(t.openedAt)!).toISOString():null,
   closedAtUTC:timestamp(t.closedAt)!==null?new Date(timestamp(t.closedAt)!).toISOString():null})),
  performanceAllObserved:summarizeDeterministicPerformance(today.map(t=>({...t,accountId:t.accountId}))),
  limitation:'Only broker-recorded closed trades are counted. Stop Loss is an exit label, not proof of indicator failure. Worker history can be incomplete. Historical broker pagination is bounded to 500 trades per account per investigation; coverage is flagged if incomplete. Firestore retains only trades observed by this system.'};
}
type ArchiveRow={kind:'trade'|'event'|'decision';key:string;grantId:string;accountId:string;botId:string;time:number;payload:Record<string,unknown>};
export class TradingDesk{
 private readonly store:RecordStore|null;private readonly broker:Broker;private readonly history?:History;
 constructor(store:RecordStore|null,broker:Broker,history?:History){this.store=store;this.broker=broker;this.history=history;}
 /** Signed Worker archival transfer. Caller must authenticate the internal
  * bearer AND independently validate this exact owner/bot/account grant.
  * Only an acknowledged Firestore write allows the Worker to mark SQL rows
  * archived. No order state or authorization is affected. */
 async ingestWorkerArchive(uid:string,botId:string,accountId:string,grantId:string,rows:ArchiveRow[]){
  if(!this.store)throw Error('Firestore archival store not configured');
  if(!uid||uid.length>256||uid.includes('/')||!validId(botId)||!validId(accountId)||
   typeof grantId!=='string'||grantId.length>120||!Array.isArray(rows)||rows.length>60)
   throw Error('Invalid Worker archival request');
  const acknowledged:string[]=[];
  for(const row of rows){
   if(!row||!['trade','event','decision'].includes(row.kind)||typeof row.key!=='string'||
    !row.key||row.key.length>400||row.accountId!==accountId||row.botId!==botId||
    typeof row.grantId!=='string'||row.grantId.length>120||!Number.isFinite(row.time)||
    !row.payload||typeof row.payload!=='object'||Array.isArray(row.payload)||
    JSON.stringify(row.payload).length>24000)throw Error('Invalid or cross-account Worker archive row');
   const v=row.payload,root='users/'+uid+'/';
   let path:string,record:Record<string,unknown>;
   if(row.kind==='trade'){
    const trade={...v,id:v.id} as Trade;
    if(!validTrade(trade))throw Error('Archived broker trade invalid');
    path=root+'liveTrades/'+hash('propdao',accountId,trade.id);
    const {id,...brokerFields}=trade;
    record={...brokerFields,accountId,providerTradeId:id,botId:null,grantId:null,
     attribution:'unattributed',localDay:timestamp(trade.closedAt)!==null?sastDay(timestamp(trade.closedAt)!):null,
     openedAtMillis:timestamp(trade.openedAt),closedAtMillis:timestamp(trade.closedAt),
     source:'durable-object-sql-authenticated-broker',observedAt:Date.now(),ledgerVersion:1};
   }else if(row.kind==='event'){
    const event=safeExecutionEvents([v],accountId)[0];
    if(!event||event.botId!==botId||event.grantId!==row.grantId)throw Error('Archived event identity invalid');
    path=root+'liveExecutionEvents/'+hash('propdao-event',accountId,botId,event.id);
    record={...event,source:'durable-object-sql-worker-event-not-broker-trade',observedAt:Date.now(),
     codeHash:typeof v.codeHash==='string'?v.codeHash:null,
     riskUsd:typeof v.riskUsd==='number'&&Number.isFinite(v.riskUsd)?v.riskUsd:null,
     riskReward:typeof v.riskReward==='number'&&Number.isFinite(v.riskReward)?v.riskReward:null,
     execution:v.execution&&typeof v.execution==='object'&&!Array.isArray(v.execution)?v.execution:null,
     ledgerVersion:1};
   }else{
    if(v.accountId!==accountId||v.botId!==botId||v.grantId!==row.grantId||
      !Number.isFinite(v.candleClose)||!['WAIT','BUY','SELL'].includes(String(v.action)))
     throw Error('Archived decision identity invalid');
    path=root+'liveRobotDecisions/'+hash('propdao-decision',accountId,botId,row.grantId,String(v.candleClose));
    record={accountId,botId,grantId:row.grantId,codeHash:typeof v.codeHash==='string'?v.codeHash:null,
     candleClose:v.candleClose,time:row.time,action:v.action,
     reason:typeof v.reason==='string'?v.reason.slice(0,240):'',
     checks:Array.isArray(v.checks)?v.checks.slice(0,16):[],
     completedCandles:v.completedCandles&&typeof v.completedCandles==='object'&&!Array.isArray(v.completedCandles)?v.completedCandles:null,
     historyCoverage:v.historyCoverage&&typeof v.historyCoverage==='object'&&!Array.isArray(v.historyCoverage)?v.historyCoverage:null,
     marketSource:'Hyperliquid',
     executionTimeframe:typeof v.executionTimeframe==='string'?v.executionTimeframe:null,
     recentCandles:Array.isArray(v.recentCandles)?v.recentCandles.slice(-20):[],
     source:'durable-object-sql-strategy-decision',
     observedAt:Date.now(),ledgerVersion:1};
   }
   // create is atomic and idempotent; an existing document with the same
   // deterministic identity is already archived and may be acknowledged.
   const created=await this.store.create(path,record);
   if(!created){
    const prior=await this.store.get(path);
    if(!prior||prior.accountId!==accountId||
      (row.kind==='trade'&&prior.providerTradeId!==record.providerTradeId)||
      (row.kind==='event'&&(prior.id!==record.id||prior.botId!==botId))||
      (row.kind==='decision'&&(prior.botId!==botId||prior.candleClose!==record.candleClose)))
     throw Error('Existing Firebase archive identity mismatch');
   }
   acknowledged.push(row.kind+':'+row.key);
  }
  return {acknowledged};
 }
 /** Owner-scoped, read-only investigation of ONE broker trade and its actual
  * decision evidence. Never treat missing journal data as a zero or an SL as
  * proof of a broken strategy. Stored trades remain accessible after STOP. */
 async inspect(uid:string,accountId:string,tradeId:string){
  if(typeof uid!=='string'||!uid||uid.length>256||uid.includes('/')||
     !validId(accountId)||!validId(tradeId))
   return {available:false,reason:'Invalid investigation identity'};
  const accounts=await this.broker.list(uid).catch(()=>null);
  if(!accounts?.connected||!accounts.accounts.some(a=>a.accountId===accountId))
   return {available:false,reason:'Cannot verify ownership of this broker account'};
  const [brokerResult,workerResult]=await Promise.allSettled([
   this.broker.recentTrades(uid,accountId),
   this.history?this.history(uid,accountId):Promise.resolve(null)
  ]);
  const issues:string[]=[];
  if(brokerResult.status==='rejected')issues.push('Live broker closed-trade read unavailable');
  if(workerResult.status==='rejected'||!workerResult.value?.available)
   issues.push('Worker execution history partially unavailable');
  let direct=brokerResult.status==='fulfilled'?brokerResult.value.find(t=>t.id===tradeId):null;
  // A named historical trade can be older than the Worker M1 broker poll.
  // Query bounded provider pages before falling back to a retained observation.
  if(!direct&&this.broker.tradesSince){
   try{
    const historical=await this.broker.tradesSince(uid,accountId,0,500);
    direct=historical.trades.find(t=>t.id===tradeId);
    if(!historical.complete)issues.push('Broker historical search capped at 500 trades');
   }catch{issues.push('Paginated broker history unavailable');}
  }
  let trade:Trade|null=direct&&validTrade(direct)?direct:null;
  if(!trade&&this.store){
   try{
    const cached=await this.store.get('users/'+uid+'/liveTrades/'+hash('propdao',accountId,tradeId));
    if(cached?.accountId===accountId&&cached.providerTradeId===tradeId){
     const old={...cached,id:tradeId};
     if(validTrade(old))trade=old;
    }
   }catch{issues.push('Firestore trade archive unavailable');}
  }
  if(!trade)return {available:false,accountId,tradeId,partial:true,
   reason:'Trade not available in bounded broker history or verified owner-scoped archive',issues};
  let events=safeExecutionEvents(workerResult.status==='fulfilled'?workerResult.value?.events:null,accountId);
  let decisions:Decision[]=workerResult.status==='fulfilled'&&Array.isArray(workerResult.value?.decisionSnapshots)?
   workerResult.value.decisionSnapshots.filter((d:Decision)=>d.accountId===accountId).slice(-300):[];
  if(this.store){
   for(const [collection,type] of [['liveExecutionEvents','events'],['liveRobotDecisions','decisions']] as const){
    try{
     let rows:Record<string,unknown>[]=[];
     if(this.store.page){
      let cursor:string|undefined;
      for(let i=0;i<5;i++){
       const page=await this.store.page('users/'+uid+'/'+collection,'accountId',accountId,cursor,100);
       rows.push(...page.items);
       if(!page.next)break;
       cursor=page.next;
       if(i===4)issues.push(collection+' has more than 500 archived records');
      }
     }else rows=(await this.store.query('users/'+uid+'/'+collection,'accountId',accountId)).slice(0,500);
     if(type==='events'){
      const merged=new Map(events.map(e=>[e.id,e]));
      for(const e of safeExecutionEvents(rows,accountId))if(!merged.has(e.id))merged.set(e.id,e);
      events=[...merged.values()];
     }else{
      const merged=new Map(decisions.map(d=>[d.botId+':'+d.grantId+':'+d.candleClose,d]));
      for(const raw of rows){
       const d=raw as Decision;
       if(d?.accountId===accountId&&validId(d.botId)&&validId(d.grantId)&&
          Number.isFinite(d.candleClose)&&['WAIT','BUY','SELL'].includes(d.action))
        if(!merged.has(d.botId+':'+d.grantId+':'+d.candleClose))
         merged.set(d.botId+':'+d.grantId+':'+d.candleClose,d);
      }
      decisions=[...merged.values()];
     }
    }catch{issues.push(collection+' archive unavailable');}
   }
  }
  const link=attributeTrade({...trade,accountId},events);
  const event=link.eventId?events.find(e=>e.id===link.eventId)||null:null;
  const decision=event?decisions.find(d=>d.botId===event.botId&&d.grantId===event.grantId&&
   d.candleClose===event.decisionCandleClose)??null:null;
  const result=diagnoseBrokerTrade({...trade,accountId},link,event,decision);
  return {available:true,accountId,tradeId,
   source:direct?'Fresh authenticated PropDAO closed-trade history':
    'Owner-scoped Firestore archive of an earlier broker observation',
   brokerFresh:!!direct,checkedAt:new Date().toISOString(),partial:issues.length>0,
   evidenceIssues:issues,trade:{...trade,accountId},attribution:link,
   diagnostic:result,
   strategyRevisionVerified:link.confidence==='verified'&&Boolean(link.strategyCodeHash),
   safety:'Read-only. No strategy, deployment or broker order was modified.'};
 }
 /** Read-through, account-scoped and idempotent. Does NOT place any orders. */
 async today(uid:string,now=Date.now()){
  if(typeof uid!=='string'||uid.length>256||!uid||uid.includes('/'))throw Error('Invalid owner');
  const day=sastDay(now),listing=await this.broker.list(uid);
  if(!listing.connected)return {available:false,day,timeZone:'Africa/Johannesburg',reason:'PropDAO disconnected; cannot verify current broker trades'};
  const accounts=[...new Set(listing.accounts.map(a=>a.accountId).filter(validId))];
  if(!accounts.length)return {available:false,day,timeZone:'Africa/Johannesburg',reason:'No connected PropDAO accounts'};
  if(accounts.length>12)return {available:false,day,reason:'More than 12 accounts; restrict the investigation to a named account'};
  const root='users/'+uid+'/liveTrades';
  const retained=new Map<string,Trade&{accountId:string;botId:string|null;attribution:string}>();
  const failures:string[]=[],capped:string[]=[],journalWarnings:string[]=[];
  let writeFailures=0,tradeWrites=0,eventWrites=0,decisionWrites=0;
  let liveSqlAccountCount=0,liveSqlTradeCount=0;
  const allEvents=new Map<string,ExecutionEvent[]>();
  for(const accountId of accounts){
   try{
    // Worker SQL is the durable live source. Broker reads independently
    // reconcile newly closed trades. Neither source's outage masks the other.
    const sinceMs=Date.parse(day+'T00:00:00.000Z')-2*3600_000;
    const [brokerResult,workerResult]=await Promise.allSettled([
     this.broker.tradesSince?this.broker.tradesSince(uid,accountId,sinceMs,500):
      this.broker.recentTrades(uid,accountId).then(trades=>({
       trades,complete:trades.length<50,capped:trades.length>=50,
       pages:1,providerTotal:null
      })),
     this.history?this.history(uid,accountId):Promise.resolve(null)
    ]);
    const brokerTrades=brokerResult.status==='fulfilled'?brokerResult.value.trades:[];
    if(brokerResult.status==='rejected')failures.push(accountId+': Live broker read unavailable; showing retained evidence if present');
    if(brokerResult.status==='fulfilled'&&!brokerResult.value.complete)
     capped.push(accountId+': Broker pagination window incomplete');
    let events:ExecutionEvent[]=[],decisions:Decision[]=[];
    let doTrades:Trade[]=[],activeSql=false;
    if(workerResult.status==='fulfilled'&&workerResult.value){
     const activity=workerResult.value;
     events=safeExecutionEvents(activity.events,accountId);
     decisions=Array.isArray(activity.decisionSnapshots)?activity.decisionSnapshots.filter(d=>
      d&&d.accountId===accountId&&validId(d.botId)&&validId(d.grantId)&&Number.isFinite(d.candleClose)).slice(-300):[];
     doTrades=Array.isArray(activity.liveTrades)?activity.liveTrades.filter(validTrade):[];
     activeSql=activity.sqlLiveAvailable===true&&Array.isArray(activity.sqlCoverage)&&
      activity.sqlCoverage.some(x=>x.running===true);
     if(activeSql)liveSqlAccountCount++;
     liveSqlTradeCount+=doTrades.length;
     if(!activity.available||activity.partial)journalWarnings.push(accountId+': '+(activity.error||'Worker history incomplete'));
     if(activity.sqlCoverage?.some(x=>x.brokerSync?.capped))capped.push(accountId+': DO last broker sample capped');
    }else journalWarnings.push(accountId+': Worker journal unavailable');
    if(this.store){
     try{
      let archived:Record<string,unknown>[]=[];
      if(this.store.page){
       let after:string|undefined;
       for(let batch=0;batch<5;batch++){
        const result=await this.store.page('users/'+uid+'/liveExecutionEvents','accountId',accountId,after,100);
        archived.push(...result.items);
        if(!result.next)break;
        after=result.next;
        if(batch===4)journalWarnings.push(accountId+': Archived execution evidence capped at 500 rows');
       }
      }else archived=(await this.store.query('users/'+uid+'/liveExecutionEvents','accountId',accountId)).slice(0,500);
      const merged=new Map(events.map(e=>[e.id,e]));
      for(const event of safeExecutionEvents(archived,accountId))if(!merged.has(event.id))merged.set(event.id,event);
      events=[...merged.values()].sort((a,b)=>b.time-a.time).slice(0,500);
     }catch{journalWarnings.push(accountId+': Archived execution journal unavailable');}
    }
    allEvents.set(accountId,events);
    const byTradeId=new Map<string,Trade>();
    for(const trade of doTrades)byTradeId.set(trade.id,trade);
    for(const trade of brokerTrades.filter(validTrade))byTradeId.set(trade.id,trade);
    const trades=[...byTradeId.values()];
    if(brokerResult.status==='rejected'&&trades.length===0)
     journalWarnings.push(accountId+': No verified fresh or retained broker trades');
    // When a robot is live with a SQL journal, Firebase archival is deferred
    // until stop; the DO continues holding the authoritative observation.
    const writeThrough=!activeSql;
    const persist=async(rootName:string,id:string,data:Record<string,any>)=>{
     if(!this.store)return false;
     try{return await this.store.create('users/'+uid+'/'+rootName+'/'+id,data)}
     catch{writeFailures++;return false}
    };
    if(this.store){
     // Limit network concurrency, retain separate provenance for journal stages and strategy checks.
     for(let i=0;i<events.length;i+=8)await Promise.all(events.slice(i,i+8).map(async e=>{
      if(await persist('liveExecutionEvents',hash('propdao-event',accountId,e.botId,e.id),
       {...e,source:'structured-worker-event-not-broker-trade',observedAt:now,ledgerVersion:1}))eventWrites++;
     }));
     for(let i=0;i<decisions.length;i+=8)await Promise.all(decisions.slice(i,i+8).map(async d=>{
      if(await persist('liveRobotDecisions',hash('propdao-decision',accountId,d.botId,d.grantId,String(d.candleClose)),
       {...d,source:'structured-worker-decision',observedAt:now,ledgerVersion:1}))decisionWrites++;
     }));
    }
    const documents=trades.filter(validTrade).map(t=>{
     const scope=hash('propdao',accountId,t.id),link=attributeTrade({...t,accountId},events);
     const {id:providerTradeId,...brokerFields}=t;
     const record={...brokerFields,providerTradeId,accountId,...link,
      localDay:timestamp(t.closedAt)!==null?sastDay(timestamp(t.closedAt)!):null,
      openedAtMillis:timestamp(t.openedAt),closedAtMillis:timestamp(t.closedAt),
      observedAt:now,source:'authenticated-broker',ledgerVersion:1};
     retained.set(scope,{...record,id:providerTradeId});
     return {scope,record};
    });
    if(this.store&&writeThrough)for(let i=0;i<documents.length;i+=8){
     await Promise.all(documents.slice(i,i+8).map(async({scope,record})=>{
      const path=root+'/'+scope;
      try{
       if(await this.store!.create(path,record))tradeWrites++;
       else if(record.attribution==='exact-provider-identity'){
        const old=await this.store!.get(path);
        if(old?.providerTradeId===record.providerTradeId&&old?.accountId===record.accountId&&
          old?.attribution!=='exact-provider-identity')await this.store!.put(path,{...old,...record});
       }
      }catch{writeFailures++;}
     }));
    }
   }catch(e){failures.push(accountId+': '+(e instanceof Error?e.message:'history unavailable'));}
  }
  let ledgerAvailable=Boolean(this.store);
  if(this.store){
   try{
    if(this.store.page){
     let after:string|undefined;
     for(let batch=0;batch<5;batch++){
      const page=await this.store.page(root,'localDay',day,after,100);
      for(const r of page.items){
       if(typeof r.accountId!=='string'||!accounts.includes(r.accountId)||typeof r.providerTradeId!=='string')continue;
       const t={...r,id:r.providerTradeId} as Trade&{accountId:string;botId:string|null;attribution:string};
       if(validTrade(t)){const id=hash('propdao',t.accountId,t.id);if(!retained.has(id))retained.set(id,t);}
      }
      if(!page.next)break;after=page.next;
      if(batch===4)journalWarnings.push('Firestore daily query capped at 500 documents');
     }
    }else{
     const records=await this.store.query(root,'localDay',day);
     for(const r of records.slice(0,500)){
      if(typeof r.accountId!=='string'||!accounts.includes(r.accountId)||typeof r.providerTradeId!=='string')continue;
      const t={...r,id:r.providerTradeId} as Trade&{accountId:string;botId:string|null;attribution:string};
      if(validTrade(t)){const id=hash('propdao',t.accountId,t.id);if(!retained.has(id))retained.set(id,t);}
     }
     if(records.length>500)journalWarnings.push('Firestore daily query capped at 500 documents');
    }
   }catch{ledgerAvailable=false;journalWarnings.push('Firestore ledger read unavailable');}
  }
  // Archived trades are re-linked using persisted execution identities,
  // but a prior exact match cannot be downgraded by incomplete new evidence.
  for(const [key,t] of retained){
   const events=allEvents.get(t.accountId);
   if(!events?.length)continue;
   const link=attributeTrade(t,events);
   if(link.attribution==='exact-provider-identity'||
      (link.attribution==='probable-entry-evidence'&&t.attribution!=='exact-provider-identity')){
    const previous=t.attribution;
    retained.set(key,{...t,...link});
    if(this.store&&previous!==link.attribution){
     try{
      const path=root+'/'+key,prior=await this.store.get(path);
      if(prior?.providerTradeId===t.id&&prior?.accountId===t.accountId&&
         prior.attribution!=='exact-provider-identity')
       await this.store.put(path,{...prior,...link});
     }catch{writeFailures++;journalWarnings.push(t.accountId+': Attribution projection write failed');}
    }
   }
  }
  return {...summarizeDay([...retained.values()],day,{accountsChecked:accounts.length,failures,capped,journalWarnings,ledgerAvailable,writeFailures}),
   fetchedAt:new Date(now).toISOString(),
   liveDurableObject:{activeAccounts:liveSqlAccountCount,retainedBrokerTrades:liveSqlTradeCount,
    source:'Per-robot SQLite Durable Objects; provider fills remain account-wide'},
   ledger:{tradeWrites,eventWrites,decisionWrites,writeFailures,available:ledgerAvailable}};
 }
}
