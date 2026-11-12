import {DurableObject} from 'cloudflare:workers';
import {getQuickJSWASMModule} from '@cf-wasm/quickjs/workerd';
import {evaluateStrategyInSandbox} from './strategy-sandbox';
import {parseStrategyConfig} from '../src/strategy';
import {propDAOLiveHistoryBars,propDAOLiveHistoryStats} from './propdao-live-history';
import {TF_SECONDS} from '../shared/trading';
import {evaluateAutonomousEquity,type EvaluationEnvelope} from '../shared/propdao-autonomous-guard';
import {parseUpstreamJson,TemporaryReadError,retryableReadError,requireKnownExposure} from './propdao-upstream-response';
import {MAX_EXECUTION_EVENTS,type ExecutionEvent,type ExecutionStage} from '../shared/propdao-execution-journal';
import {PropDAOSqlJournal,reconciliationAlarm,type SqlHandle} from './propdao-sql-journal';
type Grant={autoPolicy?:EvaluationEnvelope;id:string;uid:string;botId:string;agentId?:string;accountId:string;symbol:string;coin:string;code:string;codeHash:string;riskUsd:number;riskReward?:number;leverage:number;issuedAt:number;expiresAt:number};
type Status={running:boolean;paused:boolean;lastError?:string;lastEvaluation?:any;lastOrder?:any;lastAccount?:any;events:string[];lastMarketData?:any;recentDecisions?:any[];lastReconciliation?:any};
const interval:Record<string,string>={m1:'1m',m5:'5m',m15:'15m',m30:'30m',h1:'1h',h4:'4h',d1:'1d'};
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(v=>v.toString(16).padStart(2,'0')).join('')}
export class PropDAOLiveBot extends DurableObject<any>{
 private sqlLedger:PropDAOSqlJournal|undefined;
 private ledger(){return this.sqlLedger??(this.sqlLedger=new PropDAOSqlJournal(this.ctx.storage.sql as SqlHandle));}
 private async syncBroker(grant:Grant,force=false){
  const now=Date.now(),last=await this.ctx.storage.get<number>('lastSqlBrokerCheck')||0;
  if(!force&&now-last<60000)return;
  const data=await this.provider(grant,'history');
  if(!Array.isArray(data?.trades))throw Error('Authenticated broker trade history invalid');
  let seen=0;
  for(const trade of data.trades.slice(0,50)){
   if(!trade||typeof trade.id!=='string'||!trade.id||trade.id.length>160||
    typeof trade.symbol!=='string'||!['BUY','SELL'].includes(trade.side)||
    !Number.isFinite(trade.pnl)||!Number.isFinite(trade.qty))continue;
   // A broker trade is account-wide. DO NOT misattribute it to this bot.
   this.ledger().put({kind:'trade',key:grant.accountId+':'+trade.id,
    grantId:grant.id,accountId:grant.accountId,botId:grant.botId,
    time:Number.isFinite(trade.closedAt)?(trade.closedAt>1e11?trade.closedAt:trade.closedAt*1000):now,
    payload:{...trade,source:'authenticated-propdao-broker',attribution:'unattributed',
     observedViaBot:grant.botId,accountId:grant.accountId}});
   seen++;
  }
  const flatVerified=data.exposure?.verified===true&&data.exposure.positions===0&&data.exposure.orders===0;
  const previously=await this.ctx.storage.get<{flatVerified?:boolean;flatConfirmations?:number}>('brokerSync');
  const notTrading=(await this.ctx.storage.get<boolean>('running'))!==true;
  const flatConfirmations=notTrading&&flatVerified?
   Math.min(10,previously?.flatVerified?Number(previously.flatConfirmations||0)+1:1):0;
  await this.ctx.storage.put('lastSqlBrokerCheck',now);
  await this.ctx.storage.put('brokerSync',{time:now,seen,capped:data.trades.length>=50,
   flatVerified,flatConfirmations,
   positions:data.exposure?.verified?data.exposure.positions:null,orders:data.exposure?.verified?data.exposure.orders:null,
   error:null});
 }
 private async archiveSql(grant:Grant){
  const candidate=this.ledger().pending(60);
  if(!candidate.length)return {pending:0,uploaded:0};
  // One signed archive batch belongs to ONE original bot/grant/account.
  // Durable Objects may retain old revisions (or legacy account scopes).
  const first=candidate[0];
  const rows=candidate.filter(r=>r.accountId===first.accountId&&
   r.botId===first.botId&&r.grantId===first.grantId);
  const secret=this.env.PROPDAO_LIVE_INTERNAL_SECRET;
  if(typeof secret!=='string'||secret.length<32)throw Error('Worker archival credential missing');
  const response=await fetch(new URL('/api/internal/propdao/archive',this.env.PROPDAO_CONTROL_URL),{
   method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
   body:JSON.stringify({uid:grant.uid,botId:first.botId,accountId:first.accountId,
    grantId:first.grantId,rows}),signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw Error('Firebase archive did not acknowledge: '+response.status);
  const body=await response.json() as {acknowledged?:string[]};
  if(!Array.isArray(body?.acknowledged)||body.acknowledged.length!==rows.length||
   !rows.every(row=>body.acknowledged?.includes(row.kind+':'+row.key)))
   throw Error('Firebase archival acknowledgement incomplete');
  this.ledger().acknowledge(rows.map(r=>({kind:r.kind,key:r.key})));
  await this.ctx.storage.put('lastSqlArchive',{time:Date.now(),uploaded:rows.length});
  return {pending:this.ledger().pendingCount(),uploaded:rows.length};
 }
 private async archiveAll(grant:Grant){
  let uploaded=0;
  for(let i=0;i<5;i++){
   const result=await this.archiveSql(grant);uploaded+=result.uploaded;
   if(result.pending===0)return {pending:0,uploaded};
  }
  return {pending:this.ledger().pendingCount(),uploaded};
 }
 private tail:Promise<unknown>=Promise.resolve();
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.tail.then(fn,fn);this.tail=next.catch(()=>{});return next}
 private async state():Promise<Status>{return {running:(await this.ctx.storage.get<boolean>('running'))===true,paused:(await this.ctx.storage.get<boolean>('paused'))===true,lastError:await this.ctx.storage.get<string>('lastError'),lastEvaluation:await this.ctx.storage.get('lastEvaluation'),recentDecisions:await this.ctx.storage.get<any[]>('recentDecisions')||[],lastOrder:await this.ctx.storage.get('lastOrder'),lastAccount:await this.ctx.storage.get('lastAccount'),lastMarketData:await this.ctx.storage.get('lastMarketData'),lastReconciliation:await this.ctx.storage.get('lastReconciliation'),events:(await this.ctx.storage.get<string[]>('events'))||[]};}
 private async record(message:string){const events=(await this.ctx.storage.get<string[]>('events'))||[];events.push(`${new Date().toISOString()} · ${message.slice(0,240)}`);await this.ctx.storage.put('events',events.slice(-100));}
 /** Account-owned durable trail. A signal must never be represented as a fill. */
 private async journal(grant:Grant,stage:ExecutionStage,details:Partial<Pick<ExecutionEvent,
  'side'|'intentId'|'quantity'|'positionId'|'brokerOrderId'|'entryPrice'|'filledAt'|
  'stopPrice'|'targetPrice'|'riskBudgetUsd'|'decisionCandleClose'|'reason'>>={}){
  const event:ExecutionEvent={id:'event_'+crypto.randomUUID().replace(/-/g,''),
   time:Date.now(),accountId:grant.accountId,botId:grant.botId,
   grantId:grant.id,symbol:grant.symbol,stage,codeHash:grant.codeHash,
   ...details,...(typeof details.reason==='string'?{
    reason:details.reason.replace(/[\r\n\t]/g,' ').slice(0,180)}:{})};
  const prior=(await this.ctx.storage.get<ExecutionEvent[]>('executionEvents'))||[];
  await this.ctx.storage.put('executionEvents',[...prior,event].slice(-MAX_EXECUTION_EVENTS));
  // Durable SQLite records survive runtime restart and are not truncated with
  // the legacy UI event ring; telemetry failure must not submit or repeat orders.
  try{
   const order=stage==='PROTECTED_FILL'?await this.ctx.storage.get<any>('lastOrder'):null;
   this.ledger().put({kind:'event',key:grant.id+':'+event.id,grantId:grant.id,
    accountId:grant.accountId,botId:grant.botId,time:event.time,
    payload:{...event,codeHash:grant.codeHash,riskUsd:grant.riskUsd,
     riskReward:grant.riskReward??null,
     ...(order?{execution:{stop:order.stop,target:order.target,quantity:order.quantity,
      plannedLoss:order.plannedLoss,projectedNetProfit:order.projectedNetProfit,
      riskBudgetUsd:order.riskBudgetUsd,providerStatus:order.providerStatus}}:{})}})
  }
  catch(error){await this.ctx.storage.put('sqlTelemetryError',error instanceof Error?error.message:'SQLite event write failed')}
 }
 private async provider(grant:Grant,action:string,payload?:unknown){
  const origin=this.env.PROPDAO_CONTROL_URL;
  const url=new URL('/api/internal/propdao/provider',origin);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Invalid control origin');
  let response:Response;
  try{
   response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${this.env.PROPDAO_LIVE_INTERNAL_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({uid:grant.uid,botId:grant.botId,grantId:grant.id,action,payload}),signal:AbortSignal.timeout(16000)});
  }catch{
   if(action==='execute')throw Error('Control API connection failed after possible order submission. Outcome unknown; reconcile before retrying.');
   throw new TemporaryReadError('Control API connection temporarily unavailable.');
  }
  return parseUpstreamJson(response,'Control API',{mayHaveSubmittedOrder:action==='execute'});
 }
 private async candles(grant:Grant,timeframe:string,cutoff:number){
  const duration=TF_SECONDS[timeframe],end=Math.floor(cutoff/duration)*duration,from=(end-propDAOLiveHistoryBars(timeframe)*duration)*1000;
  if(!duration||!interval[timeframe])throw Error('Unsupported live timeframe');
  let response:Response;
  try{
   response=await fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'candleSnapshot',req:{coin:grant.coin,interval:interval[timeframe],startTime:from,endTime:end*1000-1}}),signal:AbortSignal.timeout(12000)});
  }catch{
   throw new TemporaryReadError('Hyperliquid market data connection temporarily unavailable.');
  }
  const rows=await parseUpstreamJson(response,'Hyperliquid market data');
  if(!Array.isArray(rows))throw new TemporaryReadError('Hyperliquid returned an invalid candle response.');
  const result=rows.map((r:any)=>{if(r.s!==grant.coin||r.i!==interval[timeframe])throw Error('Market-data symbol/timeframe mismatch');return {time:Number(r.t)/1000,open:Number(r.o),high:Number(r.h),low:Number(r.l),close:Number(r.c),volume:Number(r.v)}}).filter((r:any)=>Number.isFinite(r.time)&&r.time>=from/1000&&r.time<end);
  result.sort((a:any,b:any)=>a.time-b.time);
  for(let i=0;i<result.length;i++){
   const c=result[i];if(c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.low<=0||[c.open,c.close,c.high,c.volume].some((n:number)=>!Number.isFinite(n))||(i>0&&c.time<=result[i-1].time))throw Error('Invalid market price series');
  }
  if(result.length<30||!result.length||result[result.length-1].time+duration!==end)throw Error('Latest closed market candle missing');
  // Market closures create legitimate historical gaps. The latest two bars must remain contiguous before entry.
  if(result.length>=2&&result.at(-1)!.time-result.at(-2)!.time!==duration)throw Error('Recent live candles contain gaps; refusing signal');
  return result;
 }
 /** Serialize order submissions account-wide, even though strategies run in
  * their own Durable Objects. A failed ambiguous order retains this lock
  * until the original bot's verified operator reconciliation. */
 private async executionLock(grant:Grant,action:'acquire'|'release',intentId:string){
  const id=await hash('propdao-execution:'+grant.uid+':'+grant.accountId);
  const stub=this.env.BOTS.get(this.env.BOTS.idFromName(id));
  const response=await stub.fetch(new Request('https://bot/'+action,{method:'POST',
   headers:{'X-TV-UID':grant.uid,'Content-Type':'application/json'},
   body:JSON.stringify({intentId,accountId:grant.accountId,botId:grant.botId})}));
  const body=await response.json() as any;
  if(!response.ok)throw Error(body?.error||'Account execution lock unavailable');
  return body?.acquired===true;
 }
 private async schedule(){
  const grant=await this.ctx.storage.get<Grant>('grant');
  if(!grant){await this.ctx.storage.deleteAlarm();return}
  const running=(await this.ctx.storage.get<boolean>('running'))===true;
  if(!running){
   const paused=(await this.ctx.storage.get<boolean>('paused'))===true;
   if(!paused&&!(await this.ctx.storage.get<number>('stoppedAt')))
    await this.ctx.storage.put('stoppedAt',Date.now());
   const broker=await this.ctx.storage.get<{flatVerified?:boolean;flatConfirmations?:number}>('brokerSync');
   const stoppingAt=await this.ctx.storage.get<number>('stoppedAt')||Date.now();
   // Two fresh, separate flat broker observations and a five-minute
   // post-stop settling interval prevent premature archival completion.
   const settled=broker?.flatVerified===true&&Number(broker.flatConfirmations||0)>=2&&
    Date.now()-stoppingAt>=300000;
   const next=reconciliationAlarm({running:false,paused,pendingArchive:this.ledger().pendingCount(),
    flatVerified:settled,
    unresolvedIntent:Boolean(await this.ctx.storage.get('pendingIntent')),now:Date.now()});
   if(next!==null)await this.ctx.storage.setAlarm(next);
   else await this.ctx.storage.deleteAlarm();
   return;
  }
  const timeframe=parseStrategyConfig(grant.code).executionTimeframe,period=TF_SECONDS[timeframe]*1000,now=Date.now();
  const next=(Math.floor((now-6000)/period)+1)*period+6000;
  const planned=reconciliationAlarm({running:true,paused:false,pendingArchive:0,flatVerified:false,
   unresolvedIntent:false,now,nextTradingCandle:Math.min(next,grant.expiresAt)});
  if(planned!==null)await this.ctx.storage.setAlarm(planned);
 }
 async fetch(req:Request){return this.serial(async()=>{try{
  const action=new URL(req.url).pathname.slice(1),existing=await this.ctx.storage.get<Grant>('grant');
  if(existing&&existing.uid!==req.headers.get('X-TV-UID'))return Response.json({error:'Deployment ownership mismatch'},{status:403});
  if(action==='ledger'&&req.method==='GET'){
   if(!existing)return Response.json({error:'No deployed robot'},{status:404});
   const sql=this.ledger(),broker=await this.ctx.storage.get('brokerSync');
   return Response.json({source:'durable-object-sql',accountId:existing.accountId,
    botId:existing.botId,grantId:existing.id,running:await this.ctx.storage.get('running')===true,
    paused:await this.ctx.storage.get('paused')===true,brokerSync:broker||null,
    trades:sql.read('trade',60),events:sql.read('event',80),decisions:sql.read('decision',60),
    counts:sql.counts(),lastArchive:await this.ctx.storage.get('lastSqlArchive')||null,
    error:await this.ctx.storage.get('sqlTelemetryError')||null});
  }
  if(action==='status'&&req.method==='GET')return Response.json({
   sqlJournal:existing?{source:'durable-object-sql',counts:this.ledger().counts(),
    brokerSync:await this.ctx.storage.get('brokerSync')||null,
    lastArchive:await this.ctx.storage.get('lastSqlArchive')||null,
    pending:this.ledger().pendingCount(),
    completed:(await this.ctx.storage.get<boolean>('running'))!==true&&
     this.ledger().pendingCount()===0&&
     Number((await this.ctx.storage.get<{flatVerified?:boolean;flatConfirmations?:number}>('brokerSync'))?.flatConfirmations||0)>=2}:null,
   grant:existing?{id:existing.id,botId:existing.botId,agentId:existing.agentId||null,accountId:existing.accountId,symbol:existing.symbol,expiresAt:existing.expiresAt}:null,...await this.state(),nextAlarm:await this.ctx.storage.getAlarm(),pendingIntent:await this.ctx.storage.get('pendingIntent'),executionEvents:(await this.ctx.storage.get<ExecutionEvent[]>('executionEvents'))||[],accountLock:await this.ctx.storage.get('accountExecutionLock')});
  if(req.method!=='POST')return Response.json({error:'POST required'},{status:405});
  const input=await req.json<any>();
  if(action==='acquire'||action==='release'){
   // This endpoint is internal to the BOTS binding. The public Worker router
   // does not forward these actions.
   const uid=req.headers.get('X-TV-UID');
   if(!uid||typeof input?.intentId!=='string'||!/^tv-[a-f0-9]{48}-\d{9,14}$/.test(input.intentId)||
      typeof input?.accountId!=='string'||!input.accountId)
    throw Error('Invalid account execution lock');
   const existingLock=await this.ctx.storage.get<any>('accountExecutionLock');
   if(existingLock&&(existingLock.uid!==uid||existingLock.accountId!==input.accountId))
    throw Error('Account execution lock owner mismatch');
   if(action==='acquire'){
    if(existingLock)return Response.json({acquired:existingLock.intentId===input.intentId,held:true});
    await this.ctx.storage.put('accountExecutionLock',{uid,accountId:input.accountId,botId:input.botId,intentId:input.intentId,at:Date.now()});
    return Response.json({acquired:true});
   }
   if(existingLock&&existingLock.intentId!==input.intentId)throw Error('Another live intent holds the account lock');
   await this.ctx.storage.delete('accountExecutionLock');
   return Response.json({acquired:true});
  }
  if(action==='deploy'){
   if(this.env.PROPDAO_LIVE_ENABLED!=='true'||!this.env.PROPDAO_LIVE_INTERNAL_SECRET)throw Error('Live runtime is disabled');
   const grant=input as Grant;
   if(!grant?.uid||grant.uid!==req.headers.get('X-TV-UID')||!grant.id||!grant.botId||grant.agentId!==undefined&&!/^agent_[a-f0-9]{32}$/.test(grant.agentId)||!grant.code||!Number.isFinite(grant.issuedAt)||!Number.isFinite(grant.expiresAt)||grant.issuedAt>Date.now()+5000||grant.expiresAt>grant.issuedAt+7*24*3600_000||Date.now()>grant.issuedAt+60000||Date.now()>=grant.expiresAt)throw Error('Invalid or expired deployment');
   if(grant.autoPolicy&&(!grant.autoPolicy.demoOnly||
    !/^[a-f0-9]{64}$/.test(grant.autoPolicy.policyFingerprint)||
    grant.autoPolicy.startingEquity!==1000||
    !Number.isFinite(grant.autoPolicy.maxDailyLossPct)||grant.autoPolicy.maxDailyLossPct>2||
    !Number.isFinite(grant.autoPolicy.maxDrawdownPct)||grant.autoPolicy.maxDrawdownPct>5))
    throw Error('Invalid autonomous demo risk limits');
   if(grant.riskReward!==undefined&&(!Number.isFinite(grant.riskReward)||grant.riskReward<1||grant.riskReward>5))throw Error('Invalid deployment reward ratio');
   if(await hash(grant.code)!==grant.codeHash)throw Error('Strategy identity mismatch');
   if(existing?.uid&&existing.uid!==grant.uid)throw Error('This account belongs to another identity');
   if(existing&&(await this.ctx.storage.get<boolean>('running')))throw Error('Account already has a running robot');
   if(await this.ctx.storage.get('pendingIntent'))throw Error('Unresolved prior order. Operator reconciliation required before redeployment.');
   parseStrategyConfig(grant.code);
   const account=await this.provider(grant,'snapshot');
   if(!['active','funded'].includes(account.account?.status)||account.risk?.breached)
    throw Error('Account not ready for live trading');
   // Existing positions remain visible and are guarded at order entry; they
   // must not stop independent strategies from scheduling observations.
   await this.ctx.storage.put('grant',grant);await this.ctx.storage.put('running',true);await this.ctx.storage.put('paused',false);
   await this.ctx.storage.delete('stoppedAt');
   await Promise.all(['lastError','lastEvaluation','lastOrder','lastAccount'].map(key=>this.ctx.storage.delete(key)));
   // Retain the previous runtime events and execution trail across revisions.
   await this.record(`Deployed ${grant.symbol} · risk $${grant.riskUsd} · simulated funds`);
   await this.schedule();return Response.json({running:true,events:(await this.state()).events});
  }
  if(!existing||existing.uid!==req.headers.get('X-TV-UID'))throw Error('No authorized deployment');
  if(action==='reconcile'){
   if(input?.confirm!=='I VERIFIED PROPDAO HAS NO OPEN ORDERS OR POSITIONS')
    throw Error('Explicit operator confirmation required before reconciliation');
   if((await this.ctx.storage.get<boolean>('running'))||(await this.ctx.storage.get<boolean>('paused')))
    throw Error('Stop the robot before reconciling an unresolved order');
   const pending=await this.ctx.storage.get<any>('pendingIntent');
   if(!pending)return Response.json({reconciled:true,reason:'No unresolved intent',...await this.state(),pendingIntent:null});
   if(typeof pending.intentId!=='string'||!pending.intentId.startsWith(`tv-${existing.id}-`))
    throw Error('Pending order identity does not match this Durable Object deployment');
   const proof=await this.provider(existing,'reconcile',{accountId:existing.accountId,pendingIntent:pending});
   if(proof?.verified!==true||proof.accountId!==existing.accountId||proof.intentId!==pending.intentId||
      proof.snapshots!==2||proof.openPositions!==0||proof.restingOrders!==0||proof.twapOrders!==0)
    throw Error('PropDAO did not verify a flat account; unresolved order remains locked');
   const record={time:Date.now(),intentId:pending.intentId,accountId:existing.accountId,
    verification:proof.verification,closedTradesSinceIntent:proof.closedTradesSinceIntent,
    historyEntries:proof.historyEntries};
   await this.ctx.storage.put('lastReconciliation',record);
   await this.executionLock(existing,'release',pending.intentId);
   await this.ctx.storage.delete('pendingIntent');
   await this.record(`Operator-verified flat account · unlocked pending order ${pending.intentId}`);
   return Response.json({reconciled:true,...await this.state(),pendingIntent:null,lastReconciliation:record});
  }
  if(action==='stop'){
   // Revoke entries immediately. Do not hold up the stop acknowledgement on
   // broker/API/Firebase availability; a durable alarm performs the transfer.
   const wasRunning=(await this.ctx.storage.get<boolean>('running'))===true;
   await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);
   if(wasRunning||!(await this.ctx.storage.get('stoppedAt')))await this.ctx.storage.put('stoppedAt',Date.now());
   await this.record('Stopped automatic entries. Existing positions remain with PropDAO.');
   await this.ctx.storage.setAlarm(Date.now()+1000);
   return Response.json({running:false,events:(await this.state()).events,
    transfer:{status:'pending-background-reconciliation',pending:this.ledger().pendingCount()}});
  }
  if(action==='pause'){if(!(await this.ctx.storage.get<boolean>('running'))&&!(await this.ctx.storage.get<boolean>('paused')))throw Error('Stopped or halted deployment cannot be paused or resumed. Deploy again.');await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',true);await this.schedule();await this.record('Paused automatic entries. Existing positions remain with PropDAO.');return Response.json({running:false,paused:true,events:(await this.state()).events})}
  if(action==='resume'){
   if(this.env.PROPDAO_LIVE_ENABLED!=='true'||!this.env.PROPDAO_LIVE_INTERNAL_SECRET)throw Error('Live runtime is disabled');
   if(Date.now()>=existing.expiresAt)throw Error('Deployment authorization expired. Deploy with new authorization.');
   if(await this.ctx.storage.get('pendingIntent'))throw Error('An unresolved order blocks resume. Reconcile the position first.');
   if(await this.ctx.storage.get<boolean>('running'))return Response.json({running:true,paused:false,events:(await this.state()).events});
   if((await this.ctx.storage.get<boolean>('paused'))!==true)throw Error('Robot was stopped or halted; deploy with new authorization.');
   const account=await this.provider(existing,'snapshot');
   if(!['active','funded'].includes(account.account?.status)||account.risk?.breached||!Number.isFinite(account.risk?.roomUsd)||account.risk.roomUsd<=existing.riskUsd*3||account.positions?.length||account.orders?.length)throw Error('PropDAO account is not clear for resume. Check risk room, positions and open orders.');
   parseStrategyConfig(existing.code);
   await this.ctx.storage.put('paused',false);await this.ctx.storage.put('running',true);await this.ctx.storage.delete('lastError');
   await this.record('Resumed authorized robot. Live market and risk checks will run on the next candle.');await this.schedule();
   return Response.json({running:true,paused:false,events:(await this.state()).events});
  }
  throw Error('Unknown live action');
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Live runtime failed'},{status:400})}})}
 async alarm(){return this.serial(async()=>{
  const grant=await this.ctx.storage.get<Grant>('grant');if(!grant)return;
  if(!(await this.ctx.storage.get<boolean>('running'))){
   try{await this.syncBroker(grant,true);
    if(!(await this.ctx.storage.get<boolean>('paused')))await this.archiveAll(grant);
   }catch(error){await this.ctx.storage.put('sqlTelemetryError',error instanceof Error?error.message:'Offline reconciliation unavailable')}
   finally{await this.schedule()}
   return;
  }
  let intentSignal:null|{side:'BUY'|'SELL';intentId:string}=null;
  try{
   if(Date.now()>=grant.expiresAt){await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);await this.record('Authorization expired. New entries stopped.');return;}
   if(this.env.PROPDAO_LIVE_ENABLED!=='true')throw Error('Worker operator disabled entries');
   const config=parseStrategyConfig(grant.code),period=TF_SECONDS[config.executionTimeframe],close=Math.floor((Date.now()/1000-5)/period)*period,marker=`evaluation:${grant.id}`;
   if((await this.ctx.storage.get<number>(marker)||0)>=close)return;
   if(await this.ctx.storage.get('pendingIntent'))throw Error('Unresolved order intent. Reconcile the PropDAO account before resuming.');
   let account:any;
   try{account=await this.provider(grant,'snapshot');requireKnownExposure(account)}catch(error){
    await this.ctx.storage.put('lastAccount',{time:Date.now(),positions:null,orders:null,exposure:'unknown'});
    throw error;
   }
   await this.ctx.storage.put('lastAccount',{time:Date.now(),equity:account.risk?.equity,roomUsd:account.risk?.roomUsd,positions:account.positions.length,orders:account.orders.length,accountStatus:account.account?.status});
   if(account.risk?.breached||!['active','funded'].includes(account.account?.status)){await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);await this.record('Account ineligible or risk breached. Trading stopped.');return}
   if(grant.autoPolicy){
    const day=new Date().toISOString().slice(0,10);
    const prior=await this.ctx.storage.get<{day:string;equity:number}>('autonomyDailyStart');
    const daily=prior?.day===day&&Number.isFinite(prior.equity)?prior.equity:account.risk?.equity;
    if(!prior||prior.day!==day)await this.ctx.storage.put('autonomyDailyStart',{day,equity:daily});
    const verdict=evaluateAutonomousEquity(grant.autoPolicy,account.risk?.equity,daily,
     {breached:account.risk?.breached,roomUsd:account.risk?.roomUsd},grant.riskUsd);
    if(!verdict.canEnter){
     await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);
     await this.record('Autonomous DEMO risk guard stopped new entries: '+verdict.reason);return;
    }
   }
   if(account.positions?.length||account.orders?.length){await this.ctx.storage.put(marker,close);await this.record('Existing position/order; awaiting reconciliation and skipping entry.');return}
   const data:Record<string,any[]>={};
   for(const tf of config.timeframes)data[tf]=await this.candles(grant,tf,close);
   const diagnostics=Object.fromEntries(config.timeframes.map((tf:string)=>[tf,propDAOLiveHistoryStats(tf,data[tf],close)]));
   await this.ctx.storage.put('lastMarketData',{time:Date.now(),source:'Hyperliquid',executionTimeframe:config.executionTimeframe,closedAt:close,timeframes:diagnostics});
   const execution=data[config.executionTimeframe];
   const vm=await getQuickJSWASMModule();
   const decisions=evaluateStrategyInSandbox(vm,grant.code,data,config as any) as any[];
   const decision=decisions.at(-1);
   await this.ctx.storage.put(marker,close);
   const evaluation={time:Date.now(),candleClose:close,action:decision?.action||'WAIT',
    reason:typeof decision?.reason==='string'?decision.reason.slice(0,240):'',checks:Array.isArray(decision?.checks)?decision.checks.slice(0,16):[],history:diagnostics};
   await this.ctx.storage.put('lastEvaluation',evaluation);
   const recent=await this.ctx.storage.get<any[]>('recentDecisions')||[];
   await this.ctx.storage.put('recentDecisions',[...recent.slice(-119),{
    time:evaluation.time,candleClose:close,action:evaluation.action,reason:evaluation.reason,checks:evaluation.checks
   }]);
   try{this.ledger().put({kind:'decision',key:grant.id+':'+close,grantId:grant.id,
    accountId:grant.accountId,botId:grant.botId,time:evaluation.time,
    payload:{accountId:grant.accountId,botId:grant.botId,grantId:grant.id,codeHash:grant.codeHash,
     candleClose:close,time:evaluation.time,action:evaluation.action,reason:evaluation.reason,
     checks:evaluation.checks,marketSource:'Hyperliquid',
     completedCandles:Object.fromEntries(config.timeframes.map((tf:string)=>[tf,data[tf].at(-1)])),
     historyCoverage:diagnostics}})}
   catch(error){await this.ctx.storage.put('sqlTelemetryError',error instanceof Error?error.message:'SQLite decision write failed')}
   await this.record(`Candle ${config.executionTimeframe.toUpperCase()} · ${new Date(close*1000).toISOString()} · ${decision?.action||'WAIT'}${decision?.reason?' · '+decision.reason:''} · history ${config.timeframes.map((tf:string)=>tf.toUpperCase()+' '+diagnostics[tf].received+'/'+diagnostics[tf].requested).join(', ')}`);
   if(decision?.action!=='BUY'&&decision?.action!=='SELL'){await this.ctx.storage.delete('lastError');return;}
   intentSignal={side:decision.action,intentId:'tv-'+grant.id+'-'+close};
   await this.journal(grant,'SIGNAL',{...intentSignal,
    reason:typeof decision.reason==='string'&&decision.reason.trim()?decision.reason:'Strategy signal without supplied reason'});
   const last=execution.at(-1);
   if(!last||last.time+period!==close||Date.now()-close*1000>25000)throw Error('Live candle too old for order entry');
   const stop=Number(decision.stopLoss),target=Number(decision.takeProfit);
   if(!Number.isFinite(stop)||!Number.isFinite(target)||stop<=0||target<=0)throw Error('Missing protective stop or target');
   const intentId=`tv-${grant.id}-${close}`;
   if(!(await this.executionLock(grant,'acquire',intentId))){
    await this.journal(grant,'ENTRY_SKIPPED',{...intentSignal,
     reason:'Account execution lock held by a different robot; no order was submitted'});
    await this.record('Another robot is submitting an order on this account; skipped this signal.');
    return;
   }
   try{await this.ctx.storage.put('pendingIntent',{
    intentId,createdAt:Date.now(),symbol:grant.symbol,side:decision.action,stop,target});
   }catch{
    await this.executionLock(grant,'release',intentId);
    throw Error('Pending order receipt could not be stored; no broker order was submitted');
   }
   await this.journal(grant,'SUBMISSION_STARTED',{...intentSignal,
    reason:'Broker execution requested. Fill is not yet verified.'});
   let order:any;
   try{
    order=await this.provider(grant,'execute',{symbol:grant.symbol,side:decision.action,price:last.close,stop,target,quoteTime:Date.now(),candleClose:close,intentId});
   }catch(error){
    // Only an explicit server-side confirmation that the HTTP POST was never
    // attempted allows this bot to release its pending execution lock.
    if(error instanceof Error&&(error as Error&{notSubmitted?:boolean}).notSubmitted===true){
     await this.executionLock(grant,'release',intentId);
     await this.ctx.storage.delete('pendingIntent');
     await this.journal(grant,'PRE_SUBMIT_REJECTED',{...intentSignal,reason:error.message});
     await this.record('Pre-submit validation rejected entry without placing an order · '+error.message);
     return;
    }
    // All other execution failures remain ambiguous and require reconciliation.
    throw error;
   }
   if(order.filled!==true&&order.filled!==false)throw Error('Provider did not confirm a fill outcome');
   if(order.filled===true&&order.protected!==true)throw Error('Fill has no confirmed protective bracket');
   await this.ctx.storage.put('lastOrder',{time:Date.now(),intentId,side:decision.action,
    quantity:order.quantity,positionId:order.positionId||null,
    brokerOrderId:order.brokerOrderId||null,entryPrice:order.entryPrice||null,
    filledAt:order.filledAt||null,fillTimestampSource:order.fillTimestampSource||null,
    decisionCandleClose:close,plannedLoss:order.plannedLoss,projectedNetProfit:order.projectedNetProfit,riskBudgetUsd:order.riskBudgetUsd,riskReward:order.riskReward,stop:order.stop,target:order.target,
    protected:order.protected===true,filled:order.filled===true,
    providerStatus:order.providerStatus||(order.filled?'PROTECTED_FILL':'CANCELLED_UNFILLED')});
   await this.journal(grant,order.filled?'PROTECTED_FILL':'CANCELLED_UNFILLED',{
    ...intentSignal,quantity:order.quantity,
    ...(typeof order.positionId==='string'?{positionId:order.positionId}:{}),
    ...(typeof order.brokerOrderId==='string'?{brokerOrderId:order.brokerOrderId}:{}),
    ...(typeof order.entryPrice==='number'&&order.entryPrice>0?{entryPrice:order.entryPrice}:{}),
    ...(typeof order.filledAt==='number'&&order.filledAt>0?{filledAt:order.filledAt}:{}),
    stopPrice:order.stop,targetPrice:order.target,
    riskBudgetUsd:order.riskBudgetUsd,decisionCandleClose:close,
    reason:order.filled?'Broker confirmed protected position':'Unfilled entry cancelled by broker'});
   await this.executionLock(grant,'release',intentId);
   await this.ctx.storage.delete('pendingIntent');
   await this.record(order.filled?`Protected fill ${decision.action} ${grant.symbol} · ${intentId}`:`Unfilled entry cancelled ${grant.symbol} · ${intentId}`);
   await this.ctx.storage.delete('lastError');
  }catch(e){const error=e instanceof Error?e.message:'Live evaluation failed';
   if(intentSignal){
    const pending=await this.ctx.storage.get('pendingIntent');
    await this.journal(grant,pending?'OUTCOME_UNKNOWN':'PRE_SUBMIT_REJECTED',{
     ...intentSignal,reason:pending?
      'Order outcome unknown. Reconcile the broker before restarting. '+error:
      'No confirmed order submission. '+error});
   }
   const transient=!(await this.ctx.storage.get('pendingIntent')) &&
    (retryableReadError(e)||/Latest closed market candle missing|Recent live candles contain gaps|Invalid Hyperliquid candles|Could not reach PropDAO|PropDAO rate limit reached|PropDAO account request failed|Live provider unavailable/.test(error));
   if(transient){
    const previous=await this.ctx.storage.get<string>('lastError');
    await this.ctx.storage.put('lastError','Temporary upstream outage · '+error);
    if(previous!=='Temporary upstream outage · '+error)await this.record('Retrying on next candle · '+error);
   }else{
    await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);await this.ctx.storage.put('lastError',error);
    await this.record('Execution halted · '+error);
   }
  }finally{
   // Preserve order-entry timing. Historic broker reads run AFTER the strategy
   // decision and broker execution, never in front of the M1 fill path.
   try{await this.syncBroker(grant)}catch(error){
    await this.ctx.storage.put('sqlTelemetryError',error instanceof Error?error.message:'Broker history unavailable');
   }
   // Transfer one bounded batch even while running. The SQL journal remains
   // authoritative until the archive explicitly acknowledges every row.
   try{await this.archiveSql(grant)}catch(error){
    await this.ctx.storage.put('sqlTelemetryError',error instanceof Error?error.message:'Firebase archive unavailable');
   }
   await this.schedule();
  }
 })}
}
