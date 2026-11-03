import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {parseStrategyConfig} from '../src/strategy.ts';
import type {CTraderService} from './ctrader.ts';

type Storage={read:(key:string)=>Promise<string|null>;write:(key:string,value:string)=>Promise<void>;list:(prefix:string,limit:number)=>Promise<string[]>};
type Dependencies=Storage&{
 uid:(req:Request,res:Response)=>Promise<string|null>;
 bot:(uid:string,id:string,req:Request)=>Promise<{asset:string;code:string;venue:string}|null>;
 broker:CTraderService;
 request?:typeof fetch;
};
type Grant={id:string;uid:string;botId:string;accountId:string;symbol:string;symbolId:string;code:string;codeHash:string;
 riskPercent:number;maxDailyLossPercent:number;maxDrawdownPercent:number;maxSpreadPercent:number;
 maxSlippagePrice:number;roundTripCommissionPerUnit:number;environment:'demo'|'live';issuedAt:number;expiresAt:number;revokedAt?:number};
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const idOk=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
function stage(){return process.env.VERCEL_ENV||'development'}
function enabled(env:'demo'|'live'){return process.env[env==='demo'?'CTRADER_DEMO_TRADING_ENABLED':'CTRADER_LIVE_TRADING_ENABLED']==='true'}
export class CTraderLiveService{
 private request:typeof fetch;
 constructor(private deps:Dependencies){this.request=deps.request||fetch}
 private grantKey(uid:string,id:string){return 'ctrader-live/v1/'+stage()+'/'+Buffer.from(uid).toString('base64url')+'/'+id+'.json'}
 private async grant(uid:string,id:string){const raw=await this.deps.read(this.grantKey(uid,id));if(!raw)return null;
  const g=JSON.parse(raw) as Grant;if(g.uid!==uid||g.botId!==id)throw Error('cTrader grant ownership mismatch');return g}
 private runtimeReady(){return Boolean(process.env.CTRADER_GATEWAY_URL&&process.env.CTRADER_GATEWAY_SECRET&&process.env.CTRADER_GATEWAY_SECRET.length>=32)}
 private async worker(grant:Grant,action:'deploy'|'pause'|'resume'|'stop'|'status',payload?:unknown){
  if(!this.runtimeReady())throw Error('cTrader Durable Object gateway is not configured');
  const url=new URL('/bots/'+digest(grant.uid+':'+grant.accountId+':'+grant.botId)+'/'+action,process.env.CTRADER_GATEWAY_URL);
  const res=await this.request(url,{method:action==='status'?'GET':'POST',
   headers:{Authorization:'Bearer '+process.env.CTRADER_GATEWAY_SECRET,'X-TV-UID':grant.uid,'Content-Type':'application/json'},
   ...(action==='status'?{}:{body:JSON.stringify(payload||{})}),signal:AbortSignal.timeout(18000)});
  const json=await res.json() as any;if(!res.ok)throw Error(json.error||'cTrader worker rejected request');return json;
 }
 async health(){
  if(!this.runtimeReady())return {configured:false,error:'Cloudflare cTrader gateway URL or secret is not configured'};
  try{
   const response=await this.request(new URL('/health',process.env.CTRADER_GATEWAY_URL),{headers:{Authorization:'Bearer '+process.env.CTRADER_GATEWAY_SECRET},signal:AbortSignal.timeout(9000)});
   const data=await response.json() as any;
   if(!response.ok||data.ready!==true)throw Error('cTrader broker gateway is not ready');
   return {configured:true,gateway:data,connected:true};
  }catch(e){return {configured:false,error:e instanceof Error?e.message:'cTrader worker unreachable'}};
 }
 async status(uid:string,id:string){
  const g=await this.grant(uid,id),health=await this.health();
  if(!g)return {configured:health.configured,connected:Boolean(health.connected),deployed:false,running:false,paused:false,
   accountsReady:false,events:[],error:health.error||'Connect cTrader and authorize a bot'};
  if(!health.configured)return {configured:false,deployed:true,running:false,uncertain:true,accountId:g.accountId,error:health.error,events:[]};
  try{
   const worker=await this.worker(g,'status');
   const [risk,history]=await Promise.all([this.deps.broker.snapshot(uid,g.accountId),this.deps.broker.reconcile(uid,g.accountId)]);
   const positions=risk.positions.map((p:any)=>({
    id:String(p.positionId),positionId:String(p.positionId),symbol:String(p.tradeData?.symbolId)===g.symbolId?g.symbol:'Symbol '+String(p.tradeData?.symbolId||'?'),
    side:p.tradeData?.tradeSide===1?'BUY':p.tradeData?.tradeSide===2?'SELL':'UNKNOWN',
    qty:Number(p.tradeData?.volume||0)/100,entry:Number(p.price||0),
    slPrice:p.stopLoss===undefined?null:Number(p.stopLoss),tpPrice:p.takeProfit===undefined?null:Number(p.takeProfit),
    openedAt:Number(p.tradeData?.openTimestamp||0),label:p.tradeData?.label||'',commission:Number(p.commission||0),
    usedMargin:Number(p.usedMargin||0),protected:Number(p.stopLoss)>0&&Number(p.takeProfit)>0
   }));
   const closedTrades=(history.trades||[]).map((t:any)=>({...t,id:String(t.positionId),symbol:String(t.symbolId)===g.symbolId?g.symbol:'Symbol '+String(t.symbolId||'?'),
    side:'—',qty:Number(t.filledVolume||0)/100,openedAt:Number(t.openedAt||0),closedAt:Number(t.closedAt||0)}));
   return {...worker,configured:enabled(g.environment),connected:true,deployed:true,accountId:g.accountId,
    environment:g.environment,expiresAt:g.expiresAt,positions,orders:risk.orders,closedTrades,
    brokerIntent:history.intent,brokerBlocked:history.blocked,brokerRisk:history.ledger,
    balance:risk.balance,isLive:risk.isLive,broker:risk.broker,
    uncertain:Boolean(worker.pendingIntent&&worker.pendingIntent.status!=='PROTECTED')||Boolean(history.requiresOperator)};
  }catch(e){return {configured:false,deployed:true,running:false,uncertain:true,accountId:g.accountId,
   error:e instanceof Error?e.message:'Broker status uncertain; inspect cTrader before resuming',events:[]}}
 }
 async deploy(uid:string,id:string,req:Request){
  const input=req.body||{},accountId=String(input.accountId||'');
  if(input.confirm!=='I AUTHORIZE CTRADER AUTOMATED TRADING'||!/^[0-9]{1,24}$/.test(accountId))throw Error('Explicit cTrader account authorization required');
  const riskPercent=Number(input.riskPercent),maxDailyLossPercent=Number(input.maxDailyLossPercent||2),
   maxDrawdownPercent=Number(input.maxDrawdownPercent||5),maxSpreadPercent=Number(input.maxSpreadPercent||0.15),
   maxSlippagePrice=Number(input.maxSlippagePrice||0.1),roundTripCommissionPerUnit=Number(input.roundTripCommissionPerUnit||0);
  if(!Number.isFinite(riskPercent)||riskPercent<=0||riskPercent>1||
    !Number.isFinite(maxDailyLossPercent)||maxDailyLossPercent<=0||maxDailyLossPercent>5||
    !Number.isFinite(maxDrawdownPercent)||maxDrawdownPercent<=0||maxDrawdownPercent>10||
    !Number.isFinite(maxSpreadPercent)||maxSpreadPercent<=0||maxSpreadPercent>0.25||
    !Number.isFinite(maxSlippagePrice)||maxSlippagePrice<=0||
    !Number.isFinite(roundTripCommissionPerUnit)||roundTripCommissionPerUnit<0)throw Error('Invalid risk or transaction cost allowance');
  const bot=await this.deps.bot(uid,id,req);
  if(!bot||bot.venue!=='ctrader')throw Error('Save a cTrader bot before deploying');
  const config=parseStrategyConfig(bot.code);
  if(config.timeframes.some(tf=>!['m1','m5','m15','m30','h1','h4'].includes(tf)))throw Error('Unsupported cTrader live timeframe');
  const details=await this.deps.broker.list(uid),account=details.accounts.find(x=>x.ctidTraderAccountId===accountId);
  if(!account||details.scope!=='trading')throw Error('Authorize this broker account with full cTrader trading scope');
  const environment=account.isLive?'live':'demo';
  if(!enabled(environment))throw Error(environment==='live'?'Real-account cTrader trading has not passed operator enablement':'Demo cTrader execution is not enabled');
  if(!(await this.health()).configured)throw Error('cTrader gateway is not deployed or authenticated');
  const snap=await this.deps.broker.snapshot(uid,accountId);
  if(snap.positions.length||snap.orders.length||snap.accessRights!==0)throw Error('Account has open positions/pending orders or restricted permissions');
  const markets=await this.deps.broker.markets(uid,accountId);
  if(!markets.markets.some(m=>m.symbol===bot.asset))throw Error('Bot symbol is not traded by this broker account');
  const found=markets.markets.find(m=>m.symbol===bot.asset);
  if(!found)throw Error('cTrader symbol was not discovered');
  const previous=await this.grant(uid,id);
  if(previous){const current:any=await this.status(uid,id);if(current.running||current.paused||current.uncertain)throw Error('Existing cTrader bot must be stopped and reconciled first')}
  const now=Date.now();
  const grant:Grant={id:randomBytes(18).toString('hex'),uid,botId:id,accountId,symbol:bot.asset,symbolId:found.symbolId,
   code:bot.code,codeHash:digest(bot.code),riskPercent,maxDailyLossPercent,maxDrawdownPercent,maxSpreadPercent,
   maxSlippagePrice,roundTripCommissionPerUnit,environment,issuedAt:now,expiresAt:now+24*3600_000};
  await this.deps.write(this.grantKey(uid,id),JSON.stringify(grant));
  return this.worker(grant,'deploy',grant);
 }
 async control(uid:string,id:string,action:'pause'|'resume'|'stop'|'reconcile',req:Request){
  const g=await this.grant(uid,id);if(!g)throw Error('No cTrader deployment');
  if(action==='resume'){
   if(g.revokedAt||Date.now()>=g.expiresAt||!enabled(g.environment))throw Error('cTrader trading authorization expired or disabled');
   const bot=await this.deps.bot(uid,id,req);
   if(!bot||bot.code!==g.code||bot.asset!==g.symbol||digest(bot.code)!==g.codeHash)throw Error('Live strategy changed. Stop and authorize a new deployment');
  }
  if(action==='stop')await this.deps.write(this.grantKey(uid,id),JSON.stringify({...g,revokedAt:Date.now()}));
  return this.worker(g,action);
 }
 async market(uid:string,id:string){
  const g=await this.grant(uid,id);if(!g)throw Error('No authorized cTrader bot');
  const config=parseStrategyConfig(g.code),tf=config.executionTimeframe;
  const seconds:Record<string,number>={m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400};
  const period=seconds[tf];if(!period)throw Error('Unsupported live market timeframe');
  const end=Math.floor(Date.now()/(period*1000))*period;
  const count=Math.min(180,Math.floor(30*86400/period));
  const data=await this.deps.broker.candles(uid,{accountId:g.accountId,asset:g.symbol,timeframe:tf,
    from:new Date((end-count*period)*1000).toISOString(),to:new Date(end*1000).toISOString()});
  return {source:data.source,symbol:g.symbol,timeframe:tf,updatedAt:Date.now(),candles:data.candles,
   fresh:Boolean(data.candles.length&&end-data.candles[data.candles.length-1].time===period)};
 }
 async beforeDisconnect(uid:string){
  const prefix='ctrader-live/v1/'+stage()+'/'+Buffer.from(uid).toString('base64url')+'/';
  const keys=await this.deps.list(prefix,101);if(keys.length>100)throw Error('Cannot verify all cTrader live bots');
  for(const path of keys){const raw=await this.deps.read(path);if(!raw)continue;const g=JSON.parse(raw) as Grant;
   if(g.uid!==uid)throw Error('Live credential ownership mismatch');
   const state:any=await this.status(uid,g.botId);
   if(state.running||state.paused||state.uncertain)throw Error('Stop and reconcile all cTrader bots before disconnecting the broker');
   const account=await this.deps.broker.snapshot(uid,g.accountId);
   if(account.positions.length||account.orders.length)throw Error('Resolve cTrader positions and orders before disconnecting');
  }
 }
 async provider(input:any){
  const {uid,botId,grantId,action,payload}=input||{};
  if(typeof uid!=='string'||!idOk(botId)||typeof grantId!=='string')throw Error('Invalid internal cTrader authorization');
  const g=await this.grant(uid,botId);
  if(!g||g.id!==grantId)throw Error('cTrader authorization mismatch');
  if(action==='snapshot'){await this.deps.broker.reconcile(uid,g.accountId);return this.deps.broker.snapshot(uid,g.accountId)}
  if(action==='reconcile')return this.deps.broker.reconcile(uid,g.accountId);
  if(action==='candles'){
   const tf=String(payload?.timeframe||''),end=Number(payload?.end);
   const seconds:Record<string,number>={m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400};
   if(!seconds[tf]||!Number.isSafeInteger(end)||end>Math.floor(Date.now()/1000)+2||end<Math.floor(Date.now()/1000)-172800)throw Error('Invalid live candle window');
   const period=seconds[tf],count=Math.min(260,Math.floor(35*86400/period));
   return this.deps.broker.candles(uid,{accountId:g.accountId,asset:g.symbol,timeframe:tf,
    from:new Date((end-count*period)*1000).toISOString(),to:new Date(end*1000).toISOString()});
  }
  if(action==='execute'){
   if(g.revokedAt||Date.now()>=g.expiresAt||!enabled(g.environment))throw Error('Live order authorization revoked or expired');
   const marker=Number(payload?.candleClose),side=payload?.side;
   if(!Number.isSafeInteger(marker)||marker<=0||!['BUY','SELL'].includes(side)||!Number.isFinite(Number(payload?.stop))||!Number.isFinite(Number(payload?.target)))throw Error('Invalid strategy order signal');
   const plan={symbolId:g.symbolId,side,stop:Number(payload.stop),target:Number(payload.target),
     riskPercent:g.riskPercent,maxDailyLossPercent:g.maxDailyLossPercent,maxDrawdownPercent:g.maxDrawdownPercent,
     maxSpreadPercent:g.maxSpreadPercent,maxSlippagePrice:g.maxSlippagePrice,
     roundTripCommissionPerUnit:g.roundTripCommissionPerUnit,
     clientOrderId:'tv-'+digest(g.id+':'+marker).slice(0,30)};
   const markets=await this.deps.broker.markets(uid,g.accountId),found=markets.markets.find(m=>m.symbol===g.symbol);
   if(!found||found.symbolId!==plan.symbolId)throw Error('Order market differs from the authorized broker symbol');
   return this.deps.broker.execute(uid,g.accountId,plan);
  }
  throw Error('Unknown cTrader provider action');
 }
}
export function ctraderLiveRoutes(app:Express,deps:Dependencies){
 const service=new CTraderLiveService(deps);
 const route=(fn:(uid:string,id:string,req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','no-store');const uid=await deps.uid(req,res);if(!uid)return;
  const id=String(req.params.botId);if(!idOk(id))return res.status(400).json({error:'Invalid robot ID'});
  try{return res.json(await fn(uid,id,req))}catch(e){return res.status(400).json({error:e instanceof Error?e.message:'cTrader live request failed'})}};
 app.get('/api/venues/ctrader/bots/:botId/live',route((uid,id)=>service.status(uid,id)));
 app.get('/api/venues/ctrader/bots/:botId/live/market',route((uid,id)=>service.market(uid,id)));
 app.post('/api/venues/ctrader/bots/:botId/live',route((uid,id,req)=>req.body?.action==='deploy'?service.deploy(uid,id,req):
   ['pause','resume','stop','reconcile'].includes(req.body?.action)?service.control(uid,id,req.body.action,req):Promise.reject(Error('Unknown cTrader live action'))));
 app.post('/api/internal/ctrader/provider',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const secret=process.env.CTRADER_GATEWAY_SECRET,header=req.header('Authorization')||'';
  const expected='Bearer '+secret;
  if(!secret||secret.length<32||header.length!==expected.length||
   !timingSafeEqual(Buffer.from(header),Buffer.from(expected)))return res.status(401).json({error:'Internal authorization required'});
  try{return res.json(await service.provider(req.body))}catch(e){return res.status(400).json({error:e instanceof Error?e.message:'cTrader provider failed'})}
 });
 return service;
}
