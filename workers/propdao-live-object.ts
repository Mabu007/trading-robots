import {DurableObject} from 'cloudflare:workers';
import {getQuickJSWASMModule} from '@cf-wasm/quickjs/workerd';
import {evaluateStrategyInSandbox} from './strategy-sandbox';
import {parseStrategyConfig} from '../src/strategy';
import {TF_SECONDS} from '../shared/trading';
type Grant={id:string;uid:string;botId:string;accountId:string;symbol:string;coin:string;code:string;codeHash:string;riskUsd:number;leverage:number;issuedAt:number;expiresAt:number};
type Status={running:boolean;paused:boolean;lastError?:string;lastEvaluation?:any;lastOrder?:any;lastAccount?:any;events:string[]};
const interval:Record<string,string>={m1:'1m',m5:'5m',m15:'15m',m30:'30m',h1:'1h',h4:'4h',d1:'1d'};
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(v=>v.toString(16).padStart(2,'0')).join('')}
export class PropDAOLiveBot extends DurableObject<any>{
 private tail:Promise<unknown>=Promise.resolve();
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.tail.then(fn,fn);this.tail=next.catch(()=>{});return next}
 private async state():Promise<Status>{return {running:(await this.ctx.storage.get<boolean>('running'))===true,paused:(await this.ctx.storage.get<boolean>('paused'))===true,lastError:await this.ctx.storage.get<string>('lastError'),lastEvaluation:await this.ctx.storage.get('lastEvaluation'),lastOrder:await this.ctx.storage.get('lastOrder'),lastAccount:await this.ctx.storage.get('lastAccount'),events:(await this.ctx.storage.get<string[]>('events'))||[]};}
 private async record(message:string){const events=(await this.ctx.storage.get<string[]>('events'))||[];events.push(`${new Date().toISOString()} · ${message.slice(0,240)}`);await this.ctx.storage.put('events',events.slice(-100));}
 private async provider(grant:Grant,action:string,payload?:unknown){
  const origin=this.env.PROPDAO_CONTROL_URL;
  const url=new URL('/api/internal/propdao/provider',origin);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Invalid control origin');
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${this.env.PROPDAO_LIVE_INTERNAL_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({uid:grant.uid,botId:grant.botId,grantId:grant.id,action,payload}),signal:AbortSignal.timeout(16000)});
  const data=await response.json<any>();
  if(!response.ok)throw Error(data?.error||'Live provider unavailable');
  return data;
 }
 private async candles(grant:Grant,timeframe:string,cutoff:number){
  const duration=TF_SECONDS[timeframe],end=Math.floor(cutoff/duration)*duration,from=(end-210*duration)*1000;
  if(!duration||!interval[timeframe])throw Error('Unsupported live timeframe');
  const response=await fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'candleSnapshot',req:{coin:grant.coin,interval:interval[timeframe],startTime:from,endTime:end*1000-1}}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Hyperliquid live market data unavailable');
  const rows=await response.json<any>();
  if(!Array.isArray(rows))throw Error('Invalid Hyperliquid candles');
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
 private async schedule(){
  const grant=await this.ctx.storage.get<Grant>('grant');
  if(!grant||!(await this.ctx.storage.get<boolean>('running'))){await this.ctx.storage.deleteAlarm();return}
  const timeframe=parseStrategyConfig(grant.code).executionTimeframe,period=TF_SECONDS[timeframe]*1000,now=Date.now();
  const next=(Math.floor((now-6000)/period)+1)*period+6000;
  await this.ctx.storage.setAlarm(Math.max(now+1000,Math.min(next,grant.expiresAt)));
 }
 async fetch(req:Request){return this.serial(async()=>{try{
  const action=new URL(req.url).pathname.slice(1),existing=await this.ctx.storage.get<Grant>('grant');
  if(existing&&existing.uid!==req.headers.get('X-TV-UID'))return Response.json({error:'Deployment ownership mismatch'},{status:403});
  if(action==='status'&&req.method==='GET')return Response.json({grant:existing?{id:existing.id,botId:existing.botId,accountId:existing.accountId,symbol:existing.symbol,expiresAt:existing.expiresAt}:null,...await this.state(),nextAlarm:await this.ctx.storage.getAlarm(),pendingIntent:await this.ctx.storage.get('pendingIntent')});
  if(req.method!=='POST')return Response.json({error:'POST required'},{status:405});
  const input=await req.json<any>();
  if(action==='deploy'){
   if(this.env.PROPDAO_LIVE_ENABLED!=='true'||!this.env.PROPDAO_LIVE_INTERNAL_SECRET)throw Error('Live runtime is disabled');
   const grant=input as Grant;
   if(!grant?.uid||grant.uid!==req.headers.get('X-TV-UID')||!grant.id||!grant.botId||!grant.code||!Number.isFinite(grant.issuedAt)||!Number.isFinite(grant.expiresAt)||grant.issuedAt>Date.now()+5000||grant.expiresAt>grant.issuedAt+7*24*3600_000||Date.now()>grant.issuedAt+60000||Date.now()>=grant.expiresAt)throw Error('Invalid or expired deployment');
   if(await hash(grant.code)!==grant.codeHash)throw Error('Strategy identity mismatch');
   if(existing?.uid&&existing.uid!==grant.uid)throw Error('This account belongs to another identity');
   if(existing&&(await this.ctx.storage.get<boolean>('running')))throw Error('Account already has a running robot');
   if(await this.ctx.storage.get('pendingIntent'))throw Error('Unresolved prior order. Operator reconciliation required before redeployment.');
   parseStrategyConfig(grant.code);
   const account=await this.provider(grant,'snapshot');
   if(!['active','funded'].includes(account.account?.status)||account.risk?.breached||account.positions?.length||account.orders?.length)throw Error('Account not ready for live trading');
   await this.ctx.storage.put('grant',grant);await this.ctx.storage.put('running',true);await this.ctx.storage.put('paused',false);await this.ctx.storage.delete('lastError');
   await this.record(`Deployed ${grant.symbol} · risk $${grant.riskUsd} · simulated funds`);
   await this.schedule();return Response.json({running:true,events:(await this.state()).events});
  }
  if(!existing||existing.uid!==req.headers.get('X-TV-UID'))throw Error('No authorized deployment');
  if(action==='stop'){await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);await this.ctx.storage.deleteAlarm();await this.record('Stopped automatic entries. Existing positions remain with PropDAO.');return Response.json({running:false,events:(await this.state()).events})}
  if(action==='pause'){await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',true);await this.ctx.storage.deleteAlarm();await this.record('Paused automatic entries. Existing positions remain with PropDAO.');return Response.json({running:false,paused:true,events:(await this.state()).events})}
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
  const grant=await this.ctx.storage.get<Grant>('grant');if(!grant||!(await this.ctx.storage.get<boolean>('running')))return;
  try{
   if(Date.now()>=grant.expiresAt){await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);await this.record('Authorization expired. New entries stopped.');return;}
   if(this.env.PROPDAO_LIVE_ENABLED!=='true')throw Error('Worker operator disabled entries');
   const config=parseStrategyConfig(grant.code),period=TF_SECONDS[config.executionTimeframe],close=Math.floor((Date.now()/1000-5)/period)*period,marker=`evaluation:${grant.id}`;
   if((await this.ctx.storage.get<number>(marker)||0)>=close)return;
   if(await this.ctx.storage.get('pendingIntent'))throw Error('Unresolved order intent. Reconcile the PropDAO account before resuming.');
   const account=await this.provider(grant,'snapshot');
   await this.ctx.storage.put('lastAccount',{time:Date.now(),equity:account.risk?.equity,roomUsd:account.risk?.roomUsd,positions:account.positions?.length??0,orders:account.orders?.length??0,accountStatus:account.account?.status});
   if(account.risk?.breached||!['active','funded'].includes(account.account?.status)){await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);await this.record('Account ineligible or risk breached. Trading stopped.');return}
   if(account.positions?.length||account.orders?.length){await this.ctx.storage.put(marker,close);await this.record('Existing position/order; awaiting reconciliation and skipping entry.');return}
   const data:Record<string,any[]>={};
   for(const tf of config.timeframes)data[tf]=await this.candles(grant,tf,close);
   const execution=data[config.executionTimeframe];
   const vm=await getQuickJSWASMModule();
   const decisions=evaluateStrategyInSandbox(vm,grant.code,data,config as any) as any[];
   const decision=decisions.at(-1);
   await this.ctx.storage.put(marker,close);
   await this.ctx.storage.put('lastEvaluation',{time:Date.now(),candleClose:close,action:decision?.action||'WAIT'});
   await this.record(`Candle ${config.executionTimeframe.toUpperCase()} · ${new Date(close*1000).toISOString()} · signal ${decision?.action||'WAIT'}`);
   if(decision?.action!=='BUY'&&decision?.action!=='SELL'){await this.ctx.storage.delete('lastError');return;}
   const last=execution.at(-1);
   if(!last||last.time+period!==close||Date.now()-close*1000>25000)throw Error('Live candle too old for order entry');
   const stop=Number(decision.stopLoss),target=Number(decision.takeProfit);
   if(!Number.isFinite(stop)||!Number.isFinite(target)||stop<=0||target<=0)throw Error('Missing protective stop or target');
   const intentId=`tv-${grant.id}-${close}`;
   await this.ctx.storage.put('pendingIntent',{intentId,createdAt:Date.now(),symbol:grant.symbol,side:decision.action,stop,target});
   const order=await this.provider(grant,'execute',{symbol:grant.symbol,side:decision.action,price:last.close,stop,target,quoteTime:Date.now(),candleClose:close,intentId});
   if(order.filled!==true&&order.filled!==false)throw Error('Provider did not confirm a fill outcome');
   if(order.filled===true&&order.protected!==true)throw Error('Fill has no confirmed protective bracket');
   await this.ctx.storage.put('lastOrder',{time:Date.now(),intentId,quantity:order.quantity,plannedLoss:order.plannedLoss,protected:order.protected===true,providerStatus:order.providerStatus||(order.filled?'PROTECTED_FILL':'CANCELLED_UNFILLED')});
   await this.ctx.storage.delete('pendingIntent');
   await this.record(order.filled?`Protected fill ${decision.action} ${grant.symbol} · ${intentId}`:`Unfilled entry cancelled ${grant.symbol} · ${intentId}`);
   await this.ctx.storage.delete('lastError');
  }catch(e){const error=e instanceof Error?e.message:'Live evaluation failed';
   const transient=!(await this.ctx.storage.get('pendingIntent')) &&
    /Latest closed market candle missing|Recent live candles contain gaps|Hyperliquid live market data unavailable|Invalid Hyperliquid candles|Could not reach PropDAO|PropDAO rate limit reached|PropDAO account request failed|Live provider unavailable/.test(error);
   if(transient){
    const previous=await this.ctx.storage.get<string>('lastError');
    await this.ctx.storage.put('lastError','Market data paused · '+error);
    if(previous!=='Market data paused · '+error)await this.record('Awaiting valid market data · '+error);
   }else{
    await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);await this.ctx.storage.put('lastError',error);
    await this.record('Execution halted · '+error);
   }
  }finally{await this.schedule()}
 })}
}
