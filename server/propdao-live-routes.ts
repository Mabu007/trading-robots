import {createHash,timingSafeEqual,randomBytes} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {parseStrategyConfig} from '../src/strategy.ts';
import {inspectBacktestEvidence} from './strategy-backtest-evidence.ts';
import {runTrustedBacktestReplay,ReplayUnavailable,ReplayMismatch,type TrustedReplayReceipt} from './trusted-backtest-replay.ts';
import {DwellirHistory} from './dwellir-history.ts';
import {PropDAOAccounts,PropDAONoSubmissionError} from './propdao-account.ts';
import type {AgentRegistry} from './agent-registry.ts';
import type {AgentBot} from './agent-registry.ts';
import {venueOf} from '../shared/venues.ts';

type Storage={read:(key:string)=>Promise<string|null>;write:(key:string,value:string)=>Promise<void>;remove?:(key:string)=>Promise<void>;list?:(prefix:string,limit:number)=>Promise<string[]>};
type Dependencies=Storage&{/** Legacy unit fixtures only; never pass from HTTP routes. */unsafeLegacyDeployForTests?:boolean;uid:(req:Request,res:Response)=>Promise<string|null>;bot:(uid:string,id:string,req:Request)=>Promise<{asset:string;code:string;venue?:string;name?:string}|null>;accounts:PropDAOAccounts;agents?:AgentRegistry;request?:typeof fetch;exclusive?:<T>(uid:string,id:string,work:()=>Promise<T>)=>Promise<T>;history?:Pick<DwellirHistory,'candles'>};
export type PropGrant={id:string;uid:string;botId:string;agentId?:string;accountId:string;symbol:string;coin:string;code:string;codeHash:string;riskUsd:number;leverage:number;issuedAt:number;expiresAt:number;revokedAt?:number;runtimeScope?:'bot'|'lock'};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const safeId=(value:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(value);
export class PropDAOLiveService{
 private request:typeof fetch;
 private readonly deps:Dependencies;
 constructor(deps:Dependencies){this.deps=deps;this.request=deps.request??fetch}
 private key(uid:string,botId:string){return `propdao-live/v1/${process.env.VERCEL_ENV||'development'}/${Buffer.from(uid).toString('base64url')}/${botId}.json`}

 private reviewKey(uid:string,botId:string,id:string){return `propdao-live-reviews/v1/${process.env.VERCEL_ENV||'development'}/${Buffer.from(uid).toString('base64url')}/${botId}/${id}.json`}
 private backtestKey(uid:string,botId:string){return `user-bots/${Buffer.from(uid).toString('base64url')}/${botId}/backtest.json`}
 /** A read-only, expiring review of the exact source, account, market and risk. */
 async review(uid:string,botId:string,req:Request){
  const accountId=req.body?.accountId,riskUsd=Number(req.body?.riskUsd),leverage=Number(req.body?.leverage??1);
  if(!safeId(accountId)||!Number.isFinite(riskUsd)||riskUsd<=0||riskUsd>5)throw Error('Choose an owned account and risk from $0.01 to $5.');
  const currentGrant=await this.grant(uid,botId);
  if(currentGrant&&!currentGrant.revokedAt&&Date.now()<currentGrant.expiresAt)throw Error('A deployment authorization already exists. Stop new entries and verify the account before reviewing a replacement.');
  const bot=await this.deps.bot(uid,botId,req);
  if(!bot||bot.venue!=='propdao')throw Error('Save a PropDAO strategy before reviewing live deployment.');
  const codeHash=hash(bot.code);
  if(req.body?.expectedCodeHash!==undefined&&req.body.expectedCodeHash!==codeHash)throw Error('The saved strategy changed. Open it again and review the current backtest.');
  const config=parseStrategyConfig(bot.code);
  if(config.timeframes.some((tf:string)=>!['m1','m5','m15','m30','h1','h4'].includes(tf)))throw Error('Unsupported live strategy timeframe.');
  const marketList=await this.deps.accounts.getPublicMarkets(),market=marketList.data.find((m:any)=>m.symbol===bot.asset);
  if(!market||!Number.isFinite(leverage)||leverage<1||leverage>Number(market.maxLeverage))throw Error('Instrument or leverage is not currently supported on PropDAO.');
  const account=await this.deps.accounts.accountRisk(uid,accountId);
  if(!['active','funded'].includes(account.account.status)||account.risk.breached||!Number.isFinite(account.risk.roomUsd)||account.risk.roomUsd<=riskUsd*3)throw Error('Account risk room does not permit this deployment.');
  const rawBacktest=await this.deps.read(this.backtestKey(uid,botId));
  if(!rawBacktest)throw Error('A saved backtest of this exact strategy is required before deployment. Run a backtest and save it first.');
  const evidence=inspectBacktestEvidence(rawBacktest,uid,botId,{code:bot.code,asset:bot.asset,venue:'propdao',executionTimeframe:config.executionTimeframe});
  // Prefer independent server replay on provider reference history, without
  // treating historical reference fills as actual executable broker fills.
  // Unsupported/old/missing data falls back to a clearly marked browser
  // validation. A checked mismatch MUST block rather than downgrade.
  let replay:TrustedReplayReceipt|null=null,verificationNote='Independent server replay unavailable; browser-produced simulation integrity checks only.';
  const providerSymbol=bot.asset==='GOLDUSDC'?'xyz:GOLD':(typeof market.coin==='string'?market.coin:'');
  try{
   const history=this.deps.history??new DwellirHistory();
   replay=await runTrustedBacktestReplay({
    raw:rawBacktest,uid,botId,code:bot.code,asset:bot.asset,providerSymbol,
    load:async({asset,timeframe,from,to})=>history.candles({asset,timeframe,from,to})
   });
   verificationNote='Exact strategy revision and historical reference candles were independently replayed using server QuickJS. Results matched. PropDAO fills and future performance remain unverified.';
  }catch(error){
   if(error instanceof ReplayMismatch)throw error;
   if(!(error instanceof ReplayUnavailable))throw Error('Unexpected replay verification failure. Retry the review.');
   verificationNote=error.message+' Browser-generated simulation validated for internal consistency only; NOT independently replayed.';
  }
  const id=randomBytes(24).toString('hex'),createdAt=Date.now();
  const data={version:1,id,uid,botId,accountId,riskUsd,leverage,symbol:bot.asset,codeHash,evidenceHash:evidence.receiptHash,backtest:{from:evidence.from,to:evidence.to,source:evidence.source,savedAt:evidence.savedAt,provenance:replay?.provenance??evidence.provenance,replayHash:replay?.replayHash??null,verifiedCandles:replay?.candleCount??null,browserObservedCandles:evidence.observedCandles,calendarIntervals:evidence.calendarIntervals},strategyRiskPercent:config.riskPercent,executionTimeframe:config.executionTimeframe,createdAt,expiresAt:createdAt+120000,consumedAt:null as number|null};
  await this.deps.write(this.reviewKey(uid,botId,id),JSON.stringify(data));
  return {...data,reviewId:id,environment:process.env.VERCEL_ENV||'development',evidence:verificationNote};
 }
 private async consumeReview(uid:string,botId:string,input:any,bot:{asset:string;code:string},leverage:number){
  if(this.deps.unsafeLegacyDeployForTests)return;
  if(!safeId(input?.reviewId)||typeof input?.expectedCodeHash!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedCodeHash))throw Error('A fresh deployment review is required.');
  const reviewKey=this.reviewKey(uid,botId,input.reviewId),raw=await this.deps.read(reviewKey);
  if(!raw)throw Error('Deployment review not found. Start a new review.');
  const r=JSON.parse(raw);
  if(r.version!==1||r.uid!==uid||r.botId!==botId||r.id!==input.reviewId||r.consumedAt!==null||!Number.isFinite(r.expiresAt)||Date.now()>=r.expiresAt)throw Error('Deployment review expired or already used.');
  if(r.accountId!==input.accountId||r.symbol!==bot.asset||r.codeHash!==hash(bot.code)||r.codeHash!==input.expectedCodeHash||r.riskUsd!==Number(input.riskUsd)||r.leverage!==leverage)throw Error('Strategy revision, account or risk changed since review. Request a fresh review.');
  const latest=await this.deps.read(this.backtestKey(uid,botId));
  if(!latest||hash(latest)!==r.evidenceHash)throw Error('Saved backtest changed since authorization review. Request a new review.');
  await this.deps.write(reviewKey,JSON.stringify({...r,consumedAt:Date.now()}));
 }
 private async grant(uid:string,botId:string):Promise<PropGrant|null>{const raw=await this.deps.read(this.key(uid,botId));if(!raw)return null;const g=JSON.parse(raw) as PropGrant;if(g.uid!==uid||g.botId!==botId)throw Error('Live authorization ownership mismatch');return g}
 private configured(){return Boolean(process.env.PROPDAO_LIVE_ENABLED==='true'&&process.env.PROPDAO_LIVE_RUNTIME_URL&&process.env.PROPDAO_LIVE_INTERNAL_SECRET&&process.env.PROPDAO_LIVE_INTERNAL_SECRET.length>=32)}
 private agentBot(uid:string,botId:string,bot:{asset:string;code:string;venue?:string;name?:string}):AgentBot{return {id:botId,ownerUid:uid,name:bot.name||'Trading agent',asset:bot.asset,venue:venueOf(bot.venue||'propdao'),code:bot.code}}
 private async recordAgent(uid:string,botId:string,bot:{asset:string;code:string;venue?:string;name?:string},input:Parameters<NonNullable<Dependencies['agents']>['liveTransition']>[2],bestEffort=false){
  if(!this.deps.agents)return;
  try{await this.deps.agents.liveTransition(uid,this.agentBot(uid,botId,bot),input)}catch(error){if(!bestEffort)throw error;}
 }
 private async runtime(g:PropGrant,action:'deploy'|'stop'|'status'|'pause'|'resume'|'reconcile',body?:unknown,timeoutMs=20000){
  const base=process.env.PROPDAO_LIVE_RUNTIME_URL,secret=process.env.PROPDAO_LIVE_INTERNAL_SECRET;
  if(!base||!secret||secret.length<32)throw Error('PropDAO Durable Object runtime is not configured');
  const runtimeId=g.runtimeScope==='bot'?hash(g.uid+':'+g.accountId+':'+g.botId):g.runtimeScope==='lock'?hash('propdao-execution:'+g.uid+':'+g.accountId):hash(g.uid+':'+g.accountId);
  const url=new URL(`/live/${runtimeId}/${action}`,base);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Live runtime requires HTTPS');
  const response=await this.request(url,{method:action==='status'?'GET':'POST',headers:{Authorization:`Bearer ${secret}`,'X-TV-UID':g.uid,'Content-Type':'application/json'},...(action==='status'?{}:{body:JSON.stringify(body??{})}),signal:AbortSignal.timeout(timeoutMs)});
  let result:any;try{result=await response.json()}catch{throw Error('Durable Object returned invalid JSON')}
  if(!response.ok)throw Error(typeof result.error==='string'?result.error:'Durable Object unavailable');
  return result;
 }
 async health(){
  if(!process.env.PROPDAO_LIVE_RUNTIME_URL||!process.env.PROPDAO_LIVE_INTERNAL_SECRET||process.env.PROPDAO_LIVE_INTERNAL_SECRET.length<32)return {configured:false,connected:false,error:'Cloudflare Worker endpoint or internal secret is not configured.'};
  try{
   const base=process.env.PROPDAO_LIVE_RUNTIME_URL!,secret=process.env.PROPDAO_LIVE_INTERNAL_SECRET!;
   const url=new URL('/health',base);
   if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Runtime requires HTTPS');
   const response=await this.request(url,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Cloudflare Worker rejected the runtime secret');
   const state=await response.json() as any;
   const enabled=this.configured()&&state?.ready===true;
   return {configured:enabled,connected:true,error:enabled?undefined:'Runtime connected. Automated trading is disabled.'};
  }catch(e){return {configured:false,connected:false,error:e instanceof Error?e.message:'Cloudflare Worker unavailable'}}
 }
 async status(uid:string,botId:string,selectedAccount?:string){
  const grant=await this.grant(uid,botId);const health=await this.health();const configured=health.configured;
  if(!grant){
   if(selectedAccount&&safeId(selectedAccount)&&health.connected){
    try{
     // The Durable Object is scoped to the account, not the local robot ID.
     // Validate ownership before querying an abandoned prior deployment.
     await this.deps.accounts.accountRisk(uid,selectedAccount);
     const target={uid,accountId:selectedAccount} as PropGrant;
     const state=await this.runtime(target,'status');
     return {...state,configured,connected:true,deployed:false,running:false,
      accountOccupied:state.running===true,uncertain:state.running===true,
      blockingBotId:state.grant?.botId||null,accountId:selectedAccount,
      error:state.pendingIntent?'Unresolved order on this account. Reconcile before deploying.':health.error};
    }catch(e){return {configured,connected:true,deployed:false,running:false,accountId:selectedAccount,events:[],statusUnavailable:true,error:e instanceof Error?e.message:'Could not verify account live status.'}}
   }
   return {configured,connected:health.connected,deployed:false,running:false,accountId:null,events:[],error:configured?'Connect a PropDAO account and authorize a deployment.':health.error||'Live runtime is not available.'};
  }
  if(!health.connected)return {configured:false,connected:false,deployed:true,running:false,uncertain:true,authorizationRevoked:Boolean(grant.revokedAt),accountId:grant.accountId,events:[],error:health.error};
  try{
   const state=await this.runtime(grant,'status');
   const matched=state.grant?.id===grant.id;
   let positions:any[]|null=null,closedTrades:any[]|null=null,pendingOrders:any[]|null=null,risk:any=null,accountError:string|undefined,brokerExposureVerified=false;
   if(matched){
    try{
     const account=await this.deps.accounts.accountRisk(uid,grant.accountId);
     risk={equity:account.risk.equity,roomUsd:account.risk.roomUsd,balance:account.risk.balance,breached:account.risk.breached};
     positions=account.positions.slice(0,50).map((p:any)=>({
      id:String(p.id||''),symbol:String(p.symbol||''),side:p.side,qty:Number(p.qty),
      entry:Number(p.entry),mark:Number(p.mark),unrealizedPnl:Number(p.unrealizedPnl),
      slPrice:p.slPrice, tpPrice:p.tpPrice,openedAt:Number(p.openedAt)
     }));
     // Expose provider-reported *resting orders* separately from uncertain
     // Durable Object order intents. This is a read-only account snapshot.
     pendingOrders=account.orders.slice(0,50).map((o:any)=>({
      id:String(o.id??o.orderId??''),symbol:String(o.symbol??''),side:o.side,
      qty:Number.isFinite(Number(o.qty??o.quantity))?Number(o.qty??o.quantity):null,
      price:Number.isFinite(Number(o.price??o.limitPrice))?Number(o.price??o.limitPrice):null,
      status:String(o.status??'UNKNOWN'),type:String(o.orderType??o.type??''),
      createdAt:Number.isFinite(Number(o.createdAt??o.timestamp))?Number(o.createdAt??o.timestamp):null
     }));
     // A successful broker account read, not Worker reachability, verifies exposure.
     brokerExposureVerified=true;
     closedTrades=await this.deps.accounts.recentTrades(uid,grant.accountId);
    }catch(e){accountError=e instanceof Error?e.message:'PropDAO account activity unavailable'}
   }
   return {...state,configured,connected:true,
    accountOccupied:state.running===true&&!matched,
    blockingBotId:!matched&&state.grant?.botId||null,
    uncertain:state.running===true&&(!configured||!matched||Boolean(grant.revokedAt)||Date.now()>=grant.expiresAt),
    deployed:matched,running:state.running===true&&configured&&matched&&!grant.revokedAt&&Date.now()<grant.expiresAt,
     paused:state.paused===true&&matched&&!grant.revokedAt&&Date.now()<grant.expiresAt,
     canResume:state.paused===true&&matched&&configured&&!state.pendingIntent&&!grant.revokedAt&&Date.now()<grant.expiresAt,
    accountId:grant.accountId,authorizationRevoked:Boolean(grant.revokedAt),grantExpiresAt:grant.expiresAt,codeHash:grant.codeHash,positions,pendingOrders,closedTrades,risk,accountError,
    brokerExposureVerified,brokerExposure:brokerExposureVerified?(positions?.length?'open':pendingOrders?.length?'pending':'flat'):'unknown',
    error:!matched&&state.pendingIntent?'This account has an unresolved order from another bot. Reconcile it before deploying.':health.error};

  }catch(e){return {configured:true,deployed:true,running:false,uncertain:true,authorizationRevoked:Boolean(grant.revokedAt),accountId:grant.accountId,events:[],error:e instanceof Error?e.message:'Worker unavailable. Order status is unknown.'}}
 }
 async assertDeletable(uid:string,botId:string){
  const grant=await this.grant(uid,botId);
  if(!grant)return;
  const state=await this.status(uid,botId);
  if(state.running||state.paused||state.uncertain||state.pendingIntent||state.statusUnavailable||state.accountOccupied)
   throw Error('Stop and reconcile this PropDAO bot before deleting its code.');
 }
 async market(uid:string,botId:string){
  const grant=await this.grant(uid,botId);
  if(!grant||Date.now()>=grant.expiresAt)throw Error('No PropDAO deployment available for this bot');
  const config=parseStrategyConfig(grant.code),tf=config.executionTimeframe;
  const interval:Record<string,string>={m1:'1m',m5:'5m',m15:'15m',m30:'30m',h1:'1h',h4:'4h'};
  const seconds:Record<string,number>={m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400};
  if(!interval[tf])throw Error('Unsupported live timeframe');
  const now=Date.now(),period=seconds[tf]*1000;
  const response=await this.request('https://api.hyperliquid.xyz/info',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({type:'candleSnapshot',req:{coin:grant.coin,interval:interval[tf],startTime:Math.floor(now/period)*period-150*period,endTime:now}}),
   signal:AbortSignal.timeout(9000)
  });
  if(!response.ok)throw Error('Hyperliquid live candles unavailable');
  const data=await response.json() as any;
  if(!Array.isArray(data))throw Error('Hyperliquid returned invalid live prices');
  const candles=data.map((x:any)=>({
   time:Number(x.t)/1000,open:Number(x.o),high:Number(x.h),low:Number(x.l),
   close:Number(x.c),volume:Number(x.v)
  })).filter((c:any)=>Number.isInteger(c.time)&&c.time>0&&c.time<=now/1000&&
   [c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&
   c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close))
   .sort((a:any,b:any)=>a.time-b.time).slice(-120);
  if(!candles.length)throw Error('No live market candles available');
  return {source:'Hyperliquid',symbol:grant.symbol,timeframe:tf,updatedAt:now,
   fresh:(now-candles[candles.length-1].time*1000)<Math.max(period,90000),candles};
 }
 async deploy(uid:string,botId:string,req:Request){
  const input=req.body;
  if(input?.confirm!=='I AUTHORIZE PROPDAO SIMULATED LIVE TRADING')throw Error('Explicit live trading authorization required.');
  if(!safeId(input?.accountId)||!Number.isFinite(Number(input?.riskUsd))||Number(input.riskUsd)<=0||Number(input.riskUsd)>5)throw Error('Choose an account and a trade risk of $0.01 to $5.');
  if(!(await this.health()).configured)throw Error('PropDAO Durable Object runtime is not ready. No orders were submitted.');
  const existing=await this.grant(uid,botId);
  if(existing){if(!existing.revokedAt&&Date.now()<existing.expiresAt)throw Error('Existing deployment authorization must be stopped and reconciled before replacement.');const old=await this.status(uid,botId);if(old.running||old.uncertain||old.paused||old.pendingIntent||old.statusUnavailable)throw Error('Stop and reconcile the current deployment before replacing it.')}
  const bot=await this.deps.bot(uid,botId,req);if(!bot||bot.venue!=='propdao')throw Error('Save a PropDAO strategy before deploying');
  const config=parseStrategyConfig(bot.code);
  const marketList=await this.deps.accounts.getPublicMarkets();
  const market=marketList.data.find((m:any)=>m.symbol===bot.asset);
  if(!market)throw Error('Bot market is not currently tradable on PropDAO');
  const account=await this.deps.accounts.accountRisk(uid,input.accountId);
  if(!['active','funded'].includes(account.account.status)||account.risk.breached||account.risk.roomUsd<=Number(input.riskUsd)*3)throw Error('PropDAO account does not have enough risk room');
  // Other bots can have exposure: independent deployments may start while
  // the provider's per-account order guard still prevents overlapping entries.
  if(config.timeframes.some((tf:string)=>!['m1','m5','m15','m30','h1','h4'].includes(tf)))throw Error('Live timeframe is unsupported');
  const leverage=Number(input.leverage??1);
  if(!Number.isFinite(leverage)||leverage<1||leverage>Number(market.maxLeverage))throw Error('Selected leverage exceeds allowed market limit');
  await this.consumeReview(uid,botId,input,bot,leverage);
  const now=Date.now();
  const grant:PropGrant={id:randomBytes(24).toString('hex'),uid,botId,...(this.deps.agents?{agentId:this.deps.agents.idFor(uid,botId)}:{}),accountId:input.accountId,symbol:bot.asset,coin:market.dex?`${market.dex}:${market.coin}`:market.coin,code:bot.code,codeHash:hash(bot.code),riskUsd:Number(input.riskUsd),leverage,issuedAt:now,expiresAt:now+7*24*3600_000,runtimeScope:'bot'};
  // Each new bot gets its own Durable Object; an unresolved order from the
  // legacy account-scoped runtime must still be reconciled before new entries.
  const legacy={...grant,runtimeScope:undefined};
  const legacyState=await this.runtime(legacy,'status');
  if(legacyState.pendingIntent)throw Error('Unresolved prior order on the legacy account runtime. Reconcile the affected older bot before deploying.');
  const lockState=await this.runtime({...grant,runtimeScope:'lock'},'status');
  if(lockState.accountLock?.intentId)
   throw Error('Another bot has an unresolved order on this account. Stop and reconcile that bot before starting new live orders.');
  const priorState=await this.runtime(grant,'status');
  if(priorState.pendingIntent)throw Error('Unresolved prior order on this PropDAO account. Use Reconcile pending order in Deploy after checking your PropDAO account.');
  if(priorState.running||priorState.paused)throw Error('This robot is already running. Stop it before deploying a new strategy version.');
  await this.deps.write(this.key(uid,botId),JSON.stringify(grant));
  try{await this.recordAgent(uid,botId,bot,{state:'deployment_pending',action:'deployment_authorized',grantId:grant.id,expiresAt:grant.expiresAt,codeHash:grant.codeHash,limits:{riskUsd:grant.riskUsd,leverage:grant.leverage},authorized:true})}
  catch(error){if(existing)await this.deps.write(this.key(uid,botId),JSON.stringify(existing));else if(this.deps.remove)await this.deps.remove(this.key(uid,botId));else await this.deps.write(this.key(uid,botId),JSON.stringify({...grant,revokedAt:Date.now()}));throw error}
  try{
   const result=await this.runtime(grant,'deploy',grant);
   // Deployment acknowledgement omits the grant identity. A status read must
   // establish which grant is running before the UI reports confirmation.
   const observed=await this.runtime(grant,'status',undefined,5000).catch(()=>null);
   const matched=observed?.grant?.id===grant.id;
   const state=matched&&observed.running===true?'running':matched&&observed.paused===true?'paused':'unknown';
   await this.recordAgent(uid,botId,bot,{state,action:state==='unknown'?'deployment_response_unverified':'deployment_confirmed',grantId:grant.id,expiresAt:grant.expiresAt,codeHash:grant.codeHash,limits:{riskUsd:grant.riskUsd,leverage:grant.leverage},authorized:true,error:state==='unknown'?'Deployment was accepted but its running state could not be verified.':undefined},true);
   return {...result,running:state==='running',paused:state==='paused',grant:matched?observed.grant:null,uncertain:state==='unknown'};
  }
  catch(e){
   // Roll back only definite Worker rejections. A lost response is ambiguous
   // and the new grant must remain available for reconciliation.
   const reason=e instanceof Error?e.message:'';
   if(/^(Unresolved prior order|Account already has a running robot|Account not ready for live trading|Invalid or expired deployment|Invalid deployment|Strategy identity mismatch|This account belongs to another identity|Live runtime is disabled)/.test(reason)){
    if(existing)await this.deps.write(this.key(uid,botId),JSON.stringify(existing));
    else if(this.deps.remove)await this.deps.remove(this.key(uid,botId));
    else await this.deps.write(this.key(uid,botId),JSON.stringify({...grant,revokedAt:Date.now()}));
    await this.recordAgent(uid,botId,bot,{state:'stopped',action:'deployment_rejected',grantId:existing?.id,expiresAt:existing?.expiresAt,authorized:false,error:reason},true);
   }else{
    // A timeout or malformed response is an unknown outcome. Keep the
    // existing grant for reconciliation and never retry the deployment.
    await this.recordAgent(uid,botId,bot,{state:'unknown',action:'deployment_outcome_unknown',grantId:grant.id,expiresAt:grant.expiresAt,codeHash:grant.codeHash,limits:{riskUsd:grant.riskUsd,leverage:grant.leverage},authorized:true,error:reason||'Deployment outcome is unknown.'},true);
   }
   throw e;
  }
 }
 async reconcile(uid:string,botId:string,req:Request){
  if(req.body?.confirm!=='I VERIFIED PROPDAO HAS NO OPEN ORDERS OR POSITIONS')
   throw Error('Check the PropDAO account, then explicitly confirm that no orders or positions remain.');
  const grant=await this.grant(uid,botId);
  const selectedAccount=req.body?.accountId;
  if(grant&&selectedAccount&&selectedAccount!==grant.accountId)
   throw Error('Selected account differs from the authorized deployment');
  if(!grant&&(typeof selectedAccount!=='string'||!safeId(selectedAccount)))
   throw Error('Select the PropDAO account whose pending order needs reconciliation');
  if(!grant)await this.deps.accounts.accountRisk(uid,selectedAccount);
  const g=grant||({uid,accountId:selectedAccount} as PropGrant);
  const state=await this.runtime(g,'status');
  if(state.running||state.paused)throw Error('Pause or stop the running robot before reconciling an unknown order.');
  if(!state.pendingIntent)return {reconciled:true,reason:'No pending order on this account',...state};
  return this.runtime(g,'reconcile',{confirm:req.body.confirm});
 }
 async beforeCredentialChange(uid:string){
  if(!this.deps.list)throw Error('Credential-change safety check unavailable');
  const prefix=`propdao-live/v1/${process.env.VERCEL_ENV||'development'}/${Buffer.from(uid).toString('base64url')}/`;
  const keys=await this.deps.list(prefix,101);
  if(keys.length>100)throw Error('Too many live grants to verify');
  for(const key of keys){
   const raw=await this.deps.read(key);if(!raw)continue;const g=JSON.parse(raw) as PropGrant;
   if(g.uid!==uid)throw Error('Live authorization ownership mismatch');
   if(g.expiresAt<Date.now())continue;
   const current=await this.status(uid,g.botId);
   if(current.running||current.paused||current.uncertain||!current.configured||current.accountOccupied||current.pendingIntent||current.statusUnavailable)throw Error('Stop and reconcile all PropDAO live robots before changing API keys');
   const live=await this.deps.accounts.accountRisk(uid,g.accountId);
   if(live.positions.length||live.orders.length)throw Error('Close or cancel PropDAO orders and positions before disconnecting');
  }
 }
 async pause(uid:string,botId:string,req?:Request){
  const g=await this.grant(uid,botId);if(!g||g.revokedAt||Date.now()>=g.expiresAt)throw Error('No active PropDAO authorization');
  const status=await this.status(uid,botId);if(status.uncertain||!status.configured||(!status.running&&!status.paused))throw Error('Only a running or already paused robot can be paused. Reauthorize stopped instances in Deploy.');
  const result=await this.runtime(g,'pause',{}),observed=await this.status(uid,botId);let bot:null|{asset:string;code:string;venue?:string;name?:string}=null;try{bot=await this.deps.bot(uid,botId,req as Request)}catch{}
  if(bot)await this.recordAgent(uid,botId,bot,{state:observed.uncertain?'unknown':observed.paused?'paused':observed.running?'running':'unknown',action:'pause_confirmed',grantId:g.id,expiresAt:g.expiresAt,authorized:true,error:observed.uncertain?'Pause state could not be verified.':undefined},true);
  return result;
 }
 async resume(uid:string,botId:string,req:Request){
  const g=await this.grant(uid,botId);if(!g||g.revokedAt||Date.now()>=g.expiresAt)throw Error('Prior authorization has ended. Open Deploy and authorize again.');
  const status=await this.status(uid,botId);if(!status.configured||!status.canResume||status.uncertain)throw Error('Robot cannot resume safely. Open Deploy or reconcile the account.');
  const bot=await this.deps.bot(uid,botId,req);
  if(!bot||bot.venue!=='propdao'||bot.asset!==g.symbol||hash(bot.code)!==g.codeHash)throw Error('Strategy changed since live authorization. Stop and deploy the updated version before restarting.');
  const account=await this.deps.accounts.accountRisk(uid,g.accountId);
  if(!['active','funded'].includes(account.account.status)||account.risk.breached||!Number.isFinite(account.risk.roomUsd)||account.risk.roomUsd<=g.riskUsd*3||account.positions.length||account.orders.length)throw Error('PropDAO account risk or exposure blocks resume.');
  const result=await this.runtime(g,'resume',{}),observed=await this.status(uid,botId);
  await this.recordAgent(uid,botId,bot,{state:observed.uncertain?'unknown':observed.running?'running':observed.paused?'paused':'unknown',action:'resume_confirmed',grantId:g.id,expiresAt:g.expiresAt,authorized:true,error:observed.uncertain?'Resume state could not be verified.':undefined},true);
  return result;
 }
 async stop(uid:string,botId:string,req?:Request){
  const g=await this.grant(uid,botId);
  if(!g)return {running:false,deployed:false,stopped:false,alreadyStopped:true,authorizationRevoked:true,runtimeStopped:false,uncertain:true,exposure:'unverified',error:'No active server grant. Worker and broker exposure have not been independently verified.'};
  // Revoke order permission first, even if Cloudflare cannot be contacted.
  await this.deps.write(this.key(uid,botId),JSON.stringify({...g,revokedAt:g.revokedAt||Date.now()}));
  let bot:null|{asset:string;code:string;venue?:string;name?:string}=null;try{bot=await this.deps.bot(uid,botId,req as Request)}catch{}
  if(bot)await this.recordAgent(uid,botId,bot,{state:'unknown',action:'stop_requested',grantId:g.id,expiresAt:g.expiresAt,authorized:false},true);
  try{
   const state=await this.runtime(g,'stop',{}),final=await this.runtime(g,'status');
   if(final.running!==false||final.paused===true){if(bot)await this.recordAgent(uid,botId,bot,{state:'unknown',action:'stop_response_unverified',grantId:g.id,expiresAt:g.expiresAt,authorized:false,error:'Worker did not verify that execution stopped.'},true);return {...final,stopped:false,uncertain:true,authorizationRevoked:true,runtimeStopped:false,exposure:'unverified',needsReconciliation:Boolean(final.pendingIntent),error:'New-order permission revoked but Worker stop not verified. Check broker exposure.'}}
   if(final.pendingIntent){if(bot)await this.recordAgent(uid,botId,bot,{state:'unknown',action:'stop_requires_reconciliation',grantId:g.id,expiresAt:g.expiresAt,authorized:false,error:'Worker stopped but an unresolved order needs reconciliation.'},true);return {...final,running:false,deployed:false,stopped:true,needsReconciliation:true,authorizationRevoked:true,runtimeStopped:true,exposure:'unverified'}}
   if(this.deps.remove)await this.deps.remove(this.key(uid,botId));
   if(bot)await this.recordAgent(uid,botId,bot,{state:'stopped',action:'stop_confirmed',grantId:g.id,expiresAt:g.expiresAt,authorized:false},true);
   return {...state,running:false,paused:false,deployed:false,stopped:true,authorizationRevoked:true,runtimeStopped:true,exposure:'unverified'};
  }catch(error){const reason=error instanceof Error?error.message:'Stop outcome unknown';if(bot)await this.recordAgent(uid,botId,bot,{state:'unknown',action:'stop_outcome_unknown',grantId:g.id,expiresAt:g.expiresAt,authorized:false,error:reason},true);return {running:false,deployed:true,stopped:false,uncertain:true,authorizationRevoked:true,runtimeStopped:false,accountId:g.accountId,needsReconciliation:true,exposure:'unverified',error:'New-order authorization revoked. Worker stop and any remaining exposure are unverified: '+reason}}
 }
 async provider(input:any){
  const {uid,botId,grantId,action,payload}=input??{};
  if(typeof uid!=='string'||!safeId(botId)||typeof grantId!=='string')throw Error('Invalid provider authorization');
  if(action==='reconcile'){
   if(typeof payload?.accountId!=='string'||!safeId(payload.accountId))
    throw Error('Reconciliation account identity is invalid');
   return this.deps.accounts.verifyFlatReconciliation(uid,payload.accountId,payload.pendingIntent);
  }
  const grant=await this.grant(uid,botId);if(!grant||grant.revokedAt||grant.id!==grantId||Date.now()>=grant.expiresAt)throw Error('Live authorization expired');
  if(action==='snapshot')return this.deps.accounts.accountRisk(uid,grant.accountId);
  if(action==='execute'){
   if(!this.configured())throw Error('Live execution disabled');
   if(payload?.symbol!==grant.symbol||payload?.intentId!==`tv-${grant.id}-${payload?.candleClose}`)throw Error('Order does not match authorized strategy');
   return this.deps.accounts.executeOrder(uid,grant.accountId,{symbol:grant.symbol,side:payload.side,price:payload.price,stop:payload.stop,target:payload.target,leverage:grant.leverage,riskUsd:grant.riskUsd,intentId:payload.intentId,quoteTime:payload.quoteTime});
  }
  throw Error('Unknown provider action');
 }
}
export function propDAOLiveRoutes(app:Express,deps:Dependencies){
 const service=new PropDAOLiveService(deps);
 const route=(fn:(uid:string,id:string,req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{res.setHeader('Cache-Control','no-store');const uid=await deps.uid(req,res);if(!uid)return;const id=String(req.params.botId);if(!safeId(id))return res.status(400).json({error:'Invalid bot ID'});try{return res.json(await fn(uid,id,req))}catch(e){return res.status(/Unresolved prior order|reconcil|open orders or positions|already running or paused/.test(e instanceof Error?e.message:'')?409:400).json({error:e instanceof Error?e.message:'PropDAO live request failed'})}};
 app.get('/api/venues/propdao/bots/:botId/live',route((uid,id,req)=>service.status(uid,id,typeof req.query.accountId==='string'?req.query.accountId:undefined)));
 app.get('/api/venues/propdao/bots/:botId/live/market',route((uid,id)=>service.market(uid,id)));
 app.post('/api/venues/propdao/bots/:botId/live/review',route((uid,id,req)=>deps.exclusive?deps.exclusive(uid,id,()=>service.review(uid,id,req)):service.review(uid,id,req)));
 app.post('/api/venues/propdao/bots/:botId/live',route((uid,id,req)=>{
  const work=()=>req.body?.action==='deploy'?service.deploy(uid,id,req):req.body?.action==='stop'?service.stop(uid,id,req):req.body?.action==='pause'?service.pause(uid,id,req):req.body?.action==='resume'?service.resume(uid,id,req):req.body?.action==='reconcile'?service.reconcile(uid,id,req):Promise.reject(Error('Unknown action'));
  return deps.exclusive?deps.exclusive(uid,id,work):work();
 }));
 app.post('/api/internal/propdao/provider',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const secret=process.env.PROPDAO_LIVE_INTERNAL_SECRET,header=req.header('authorization')||'';
  if(!secret||secret.length<32||header.length>512||!timingSafeEqual(Buffer.from(hash(header)),Buffer.from(hash(`Bearer ${secret}`))))return res.status(401).json({error:'Internal authorization required'});
  try{return res.json(await service.provider(req.body))}catch(e){return res.status(400).json({error:e instanceof Error?e.message:'Provider rejected request',notSubmitted:e instanceof PropDAONoSubmissionError})}
 });
 return service;
}
