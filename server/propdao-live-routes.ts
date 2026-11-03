import {createHash,timingSafeEqual,randomBytes} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {parseStrategyConfig} from '../src/strategy.ts';
import {PropDAOAccounts} from './propdao-account.ts';

type Storage={read:(key:string)=>Promise<string|null>;write:(key:string,value:string)=>Promise<void>;list?:(prefix:string,limit:number)=>Promise<string[]>};
type Dependencies=Storage&{uid:(req:Request,res:Response)=>Promise<string|null>;bot:(uid:string,id:string,req:Request)=>Promise<{asset:string;code:string;venue?:string}|null>;accounts:PropDAOAccounts;request?:typeof fetch};
export type PropGrant={id:string;uid:string;botId:string;accountId:string;symbol:string;coin:string;code:string;codeHash:string;riskUsd:number;leverage:number;issuedAt:number;expiresAt:number;revokedAt?:number};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const safeId=(value:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(value);
export class PropDAOLiveService{
 private request:typeof fetch;
 private readonly deps:Dependencies;
 constructor(deps:Dependencies){this.deps=deps;this.request=deps.request??fetch}
 private key(uid:string,botId:string){return `propdao-live/v1/${process.env.VERCEL_ENV||'development'}/${Buffer.from(uid).toString('base64url')}/${botId}.json`}
 private async grant(uid:string,botId:string):Promise<PropGrant|null>{const raw=await this.deps.read(this.key(uid,botId));if(!raw)return null;const g=JSON.parse(raw) as PropGrant;if(g.uid!==uid||g.botId!==botId)throw Error('Live authorization ownership mismatch');return g}
 private configured(){return Boolean(process.env.PROPDAO_LIVE_ENABLED==='true'&&process.env.PROPDAO_LIVE_RUNTIME_URL&&process.env.PROPDAO_LIVE_INTERNAL_SECRET&&process.env.PROPDAO_LIVE_INTERNAL_SECRET.length>=32)}
 private async runtime(g:PropGrant,action:'deploy'|'stop'|'status'|'pause'|'resume',body?:unknown){
  const base=process.env.PROPDAO_LIVE_RUNTIME_URL,secret=process.env.PROPDAO_LIVE_INTERNAL_SECRET;
  if(!base||!secret||secret.length<32)throw Error('PropDAO Durable Object runtime is not configured');
  const url=new URL(`/live/${hash(g.uid+':'+g.accountId)}/${action}`,base);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Live runtime requires HTTPS');
  const response=await this.request(url,{method:action==='status'?'GET':'POST',headers:{Authorization:`Bearer ${secret}`,'X-TV-UID':g.uid,'Content-Type':'application/json'},...(action==='status'?{}:{body:JSON.stringify(body??{})}),signal:AbortSignal.timeout(20000)});
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
 async status(uid:string,botId:string){
  const grant=await this.grant(uid,botId);const health=await this.health();const configured=health.configured;
  if(!grant)return {configured,connected:health.connected,deployed:false,running:false,accountId:null,events:[],error:configured?'Connect a PropDAO account and authorize a deployment.':health.error||'Live runtime is not available.'};
  if(!health.connected)return {configured:false,connected:false,deployed:true,running:false,uncertain:true,accountId:grant.accountId,events:[],error:health.error};
  try{
   const state=await this.runtime(grant,'status');
   const matched=state.grant?.id===grant.id;
   let positions:any[]=[],closedTrades:any[]=[],risk:any=null,accountError:string|undefined;
   if(matched){
    try{
     const account=await this.deps.accounts.accountRisk(uid,grant.accountId);
     risk={equity:account.risk.equity,roomUsd:account.risk.roomUsd,balance:account.risk.balance,breached:account.risk.breached};
     positions=account.positions.slice(0,50).map((p:any)=>({
      id:String(p.id||''),symbol:String(p.symbol||''),side:p.side,qty:Number(p.qty),
      entry:Number(p.entry),mark:Number(p.mark),unrealizedPnl:Number(p.unrealizedPnl),
      slPrice:p.slPrice, tpPrice:p.tpPrice,openedAt:Number(p.openedAt)
     }));
     closedTrades=await this.deps.accounts.recentTrades(uid,grant.accountId);
    }catch(e){accountError=e instanceof Error?e.message:'PropDAO account activity unavailable'}
   }
   return {...state,configured,connected:true,
    uncertain:state.running===true&&(!configured||!matched||Boolean(grant.revokedAt)||Date.now()>=grant.expiresAt),
    deployed:matched,running:state.running===true&&configured&&matched&&!grant.revokedAt&&Date.now()<grant.expiresAt,
     paused:state.paused===true&&matched&&!grant.revokedAt&&Date.now()<grant.expiresAt,
     canResume:state.paused===true&&matched&&configured&&!state.pendingIntent&&!grant.revokedAt&&Date.now()<grant.expiresAt,
    accountId:grant.accountId,positions,closedTrades,risk,accountError,
    error:health.error};

  }catch(e){return {configured:true,deployed:true,running:false,uncertain:true,accountId:grant.accountId,events:[],error:e instanceof Error?e.message:'Worker unavailable. Order status is unknown.'}}
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
  if(existing){const old=await this.status(uid,botId);if(old.running||old.uncertain)throw Error('Stop and reconcile the current deployment before replacing it.')}
  const bot=await this.deps.bot(uid,botId,req);if(!bot||bot.venue!=='propdao')throw Error('Save a PropDAO strategy before deploying');
  const config=parseStrategyConfig(bot.code);
  const marketList=await this.deps.accounts.getPublicMarkets();
  const market=marketList.data.find((m:any)=>m.symbol===bot.asset);
  if(!market)throw Error('Bot market is not currently tradable on PropDAO');
  const account=await this.deps.accounts.accountRisk(uid,input.accountId);
  if(!['active','funded'].includes(account.account.status)||account.risk.breached||account.risk.roomUsd<=Number(input.riskUsd)*3)throw Error('PropDAO account does not have enough risk room');
  if(account.positions.length||account.orders.length)throw Error('Resolve all existing positions and resting orders before deploying');
  if(config.timeframes.some((tf:string)=>!['m1','m5','m15','m30','h1','h4'].includes(tf)))throw Error('Live timeframe is unsupported');
  const leverage=Number(input.leverage??1);
  if(!Number.isFinite(leverage)||leverage<1||leverage>Number(market.maxLeverage))throw Error('Selected leverage exceeds allowed market limit');
  const now=Date.now();
  const grant:PropGrant={id:randomBytes(24).toString('hex'),uid,botId,accountId:input.accountId,symbol:bot.asset,coin:market.dex?`${market.dex}:${market.coin}`:market.coin,code:bot.code,codeHash:hash(bot.code),riskUsd:Number(input.riskUsd),leverage,issuedAt:now,expiresAt:now+7*24*3600_000};
  await this.deps.write(this.key(uid,botId),JSON.stringify(grant));
  return this.runtime(grant,'deploy',grant);
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
   if(current.running||current.paused||current.uncertain||!current.configured)throw Error('Stop and reconcile all PropDAO live robots before changing API keys');
   const live=await this.deps.accounts.accountRisk(uid,g.accountId);
   if(live.positions.length||live.orders.length)throw Error('Close or cancel PropDAO orders and positions before disconnecting');
  }
 }
 async pause(uid:string,botId:string){
  const g=await this.grant(uid,botId);if(!g||g.revokedAt||Date.now()>=g.expiresAt)throw Error('No active PropDAO authorization');
  const status=await this.status(uid,botId);if(status.uncertain||!status.configured||(!status.running&&!status.paused))throw Error('Only a running or already paused robot can be paused. Reauthorize stopped instances in Deploy.');
  return this.runtime(g,'pause',{});
 }
 async resume(uid:string,botId:string,req:Request){
  const g=await this.grant(uid,botId);if(!g||g.revokedAt||Date.now()>=g.expiresAt)throw Error('Prior authorization has ended. Open Deploy and authorize again.');
  const status=await this.status(uid,botId);if(!status.configured||!status.canResume||status.uncertain)throw Error('Robot cannot resume safely. Open Deploy or reconcile the account.');
  const bot=await this.deps.bot(uid,botId,req);
  if(!bot||bot.venue!=='propdao'||bot.asset!==g.symbol||hash(bot.code)!==g.codeHash)throw Error('Strategy changed since live authorization. Stop and deploy the updated version before restarting.');
  const account=await this.deps.accounts.accountRisk(uid,g.accountId);
  if(!['active','funded'].includes(account.account.status)||account.risk.breached||!Number.isFinite(account.risk.roomUsd)||account.risk.roomUsd<=g.riskUsd*3||account.positions.length||account.orders.length)throw Error('PropDAO account risk or exposure blocks resume.');
  return this.runtime(g,'resume',{});
 }
 async stop(uid:string,botId:string){const g=await this.grant(uid,botId);if(!g)throw Error('No authorized PropDAO deployment');await this.deps.write(this.key(uid,botId),JSON.stringify({...g,revokedAt:Date.now()}));return this.runtime(g,'stop',{});}
 async provider(input:any){
  const {uid,botId,grantId,action,payload}=input??{};
  if(typeof uid!=='string'||!safeId(botId)||typeof grantId!=='string')throw Error('Invalid provider authorization');
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
 const route=(fn:(uid:string,id:string,req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{res.setHeader('Cache-Control','no-store');const uid=await deps.uid(req,res);if(!uid)return;const id=String(req.params.botId);if(!safeId(id))return res.status(400).json({error:'Invalid bot ID'});try{return res.json(await fn(uid,id,req))}catch(e){return res.status(400).json({error:e instanceof Error?e.message:'PropDAO live request failed'})}};
 app.get('/api/venues/propdao/bots/:botId/live',route((uid,id)=>service.status(uid,id)));
 app.get('/api/venues/propdao/bots/:botId/live/market',route((uid,id)=>service.market(uid,id)));
 app.post('/api/venues/propdao/bots/:botId/live',route((uid,id,req)=>req.body?.action==='deploy'?service.deploy(uid,id,req):req.body?.action==='stop'?service.stop(uid,id):req.body?.action==='pause'?service.pause(uid,id):req.body?.action==='resume'?service.resume(uid,id,req):Promise.reject(Error('Unknown action'))));
 app.post('/api/internal/propdao/provider',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const secret=process.env.PROPDAO_LIVE_INTERNAL_SECRET,header=req.header('authorization')||'';
  if(!secret||secret.length<32||header.length>512||!timingSafeEqual(Buffer.from(hash(header)),Buffer.from(hash(`Bearer ${secret}`))))return res.status(401).json({error:'Internal authorization required'});
  try{return res.json(await service.provider(req.body))}catch(e){return res.status(400).json({error:e instanceof Error?e.message:'Provider rejected request'})}
 });
 return service;
}
