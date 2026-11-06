import {DurableObject} from 'cloudflare:workers';
import {getQuickJSWASMModule} from '@cf-wasm/quickjs/workerd';
import {evaluateStrategyInSandbox} from './strategy-sandbox';
import {parseStrategyConfig} from '../src/strategy';
import {TF_SECONDS} from '../shared/trading';
type Grant={id:string;uid:string;botId:string;accountId:string;symbol:string;symbolId:string;code:string;codeHash:string;riskPercent:number;issuedAt:number;expiresAt:number;environment:'demo'|'live';revokedAt?:number};
type Env={CTRADER_GATEWAY_SECRET:string;CTRADER_CONTROL_URL:string;CTRADER_DEMO_TRADING_ENABLED?:string;CTRADER_LIVE_TRADING_ENABLED?:string};
const hash=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
export class CTraderLiveBot extends DurableObject<Env>{
 private tail:Promise<unknown>=Promise.resolve();
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const task=this.tail.then(fn,fn);this.tail=task.catch(()=>{});return task}
 private async record(s:string){const events=(await this.ctx.storage.get<string[]>('events'))||[];events.push(new Date().toISOString()+' · '+s.slice(0,250));await this.ctx.storage.put('events',events.slice(-100))}
 private async state(){
  return {running:(await this.ctx.storage.get<boolean>('running'))===true,
   paused:(await this.ctx.storage.get<boolean>('paused'))===true,
   lastEvaluation:await this.ctx.storage.get('lastEvaluation'),
   lastOrder:await this.ctx.storage.get('lastOrder'),
   lastError:await this.ctx.storage.get('lastError'),
   pendingIntent:await this.ctx.storage.get('pendingIntent'),
   nextAlarm:await this.ctx.storage.getAlarm(),
   events:(await this.ctx.storage.get<string[]>('events'))||[]};
 }
 private enabled(g:Grant){return this.env[g.environment==='demo'?'CTRADER_DEMO_TRADING_ENABLED':'CTRADER_LIVE_TRADING_ENABLED']==='true'}
 private async provider(g:Grant,action:'snapshot'|'candles'|'execute'|'reconcile',payload?:unknown){
  const u=new URL('/api/internal/ctrader/provider',this.env.CTRADER_CONTROL_URL);
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&u.hostname==='127.0.0.1'))throw Error('Invalid protected cTrader API origin');
  const res=await fetch(u,{method:'POST',headers:{Authorization:'Bearer '+this.env.CTRADER_GATEWAY_SECRET,'Content-Type':'application/json'},
   body:JSON.stringify({uid:g.uid,botId:g.botId,grantId:g.id,action,payload}),signal:AbortSignal.timeout(22000)});
  const body=await res.json<any>();if(!res.ok)throw Error(String(body?.error||'cTrader provider is not available'));return body;
 }
 private async schedule(){
  const grant=await this.ctx.storage.get<Grant>('grant');
  if(!grant||!(await this.ctx.storage.get<boolean>('running'))){await this.ctx.storage.deleteAlarm();return}
  const config=parseStrategyConfig(grant.code),seconds=TF_SECONDS[config.executionTimeframe];
  if(!seconds)throw Error('Unsupported cTrader live timeframe');
  const now=Date.now(),period=seconds*1000;
  const next=(Math.floor((now-8000)/period)+1)*period+8000;
  await this.ctx.storage.setAlarm(Math.max(now+1000,Math.min(next,grant.expiresAt)));
 }
 async fetch(req:Request){return this.serial(async()=>{
  try{
   const action=new URL(req.url).pathname.slice(1),g=await this.ctx.storage.get<Grant>('grant');
   const uid=req.headers.get('X-TV-UID');
   if(g&&g.uid!==uid)return Response.json({error:'Trading bot ownership mismatch'},{status:403});
   if(action==='status'&&req.method==='GET')return Response.json({grant:g?{botId:g.botId,accountId:g.accountId,symbol:g.symbol,expiresAt:g.expiresAt,environment:g.environment}:null,...await this.state()});
   if(req.method!=='POST')return new Response(null,{status:405});
   const input=await req.json<any>();
   if(action==='deploy'){
    const next=input as Grant;
    if(!next?.uid||next.uid!==uid||!next.botId||!next.accountId||!next.code||!next.symbolId||!next.codeHash||!next.id||
     !Number.isSafeInteger(next.issuedAt)||!Number.isSafeInteger(next.expiresAt)||
     next.issuedAt>Date.now()+5000||Date.now()-next.issuedAt>60000||next.expiresAt>next.issuedAt+24*3600000||next.expiresAt<=Date.now()||
     !['demo','live'].includes(next.environment))throw Error('Invalid or expired trading grant');
    if(!this.enabled(next)||await hash(next.code)!==next.codeHash)throw Error('cTrader execution authorization is not enabled or source changed');
    if(g&&(await this.ctx.storage.get<boolean>('running')||await this.ctx.storage.get<boolean>('paused')))throw Error('This robot already has a deployment');
    if(await this.ctx.storage.get('pendingIntent'))throw Error('Unresolved previous cTrader order blocks new deployment');
    const config=parseStrategyConfig(next.code);
    if(config.timeframes.some((tf:string)=>!['m1','m5','m15','m30','h1','h4'].includes(tf)))throw Error('Unsupported cTrader timeframe');
    const account=await this.provider(next,'snapshot');
    if(account.positions?.length||account.orders?.length||account.accessRights!==0)throw Error('Broker account has open exposure or restricted permissions');
    await this.ctx.storage.put('grant',next);await this.ctx.storage.put('running',true);await this.ctx.storage.put('paused',false);
    await this.ctx.storage.delete('lastError');await this.record('cTrader '+next.environment.toUpperCase()+' deployed · '+next.symbol);
    await this.schedule();return Response.json({...await this.state()});
   }
   if(!g||g.uid!==uid)throw Error('No authorized cTrader bot');
   if(action==='stop'){
    await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);await this.ctx.storage.deleteAlarm();
    await this.record('Stopped new orders. Existing broker positions remain protected and must be reconciled.');
    return Response.json({...await this.state()});
   }
   if(action==='pause'){
    await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',true);await this.ctx.storage.deleteAlarm();
    await this.record('Paused new orders. Existing positions remain open with broker-side protection.');
    return Response.json({...await this.state()});
   }
   if(action==='reconcile'){
    const state=await this.provider(g,'reconcile');
    const pending=await this.ctx.storage.get<any>('pendingIntent');
    if(pending&&state.intent?.status==='PROTECTED'&&state.intent.clientOrderId===pending.clientOrderId)await this.ctx.storage.delete('pendingIntent');
    await this.record('Broker account reconciliation · '+(state.blocked?'exposure/intent still tracked':'no unresolved broker intent'));
    return Response.json({...await this.state(),broker:state});
   }
   if(action==='resume'){
    if(g.revokedAt||Date.now()>g.expiresAt||!this.enabled(g)||await this.ctx.storage.get('pendingIntent'))throw Error('Cannot resume until authorized and all order intents reconciled');
    if((await this.ctx.storage.get<boolean>('paused'))!==true)throw Error('Only a paused robot can resume');
    const account=await this.provider(g,'snapshot');
    if(account.positions?.length||account.orders?.length||account.accessRights!==0)throw Error('cTrader exposure or access rights prohibit resume');
    await this.ctx.storage.put('paused',false);await this.ctx.storage.put('running',true);
    await this.record('Resumed cTrader bot with broker state checks');await this.schedule();
    return Response.json({...await this.state()});
   }
   throw Error('Unknown bot action');
  }catch(e){return Response.json({error:e instanceof Error?e.message:'cTrader robot error'},{status:400})}
 })}
 async alarm(){return this.serial(async()=>{
  const grant=await this.ctx.storage.get<Grant>('grant');
  if(!grant||!(await this.ctx.storage.get<boolean>('running')))return;
  try{
   if(grant.revokedAt||Date.now()>grant.expiresAt||!this.enabled(grant)){await this.ctx.storage.put('running',false);await this.record('Authorization expired. New trades stopped.');return}
   if(await this.ctx.storage.get('pendingIntent'))throw Error('Previous live order unresolved; new entries blocked');
   const config=parseStrategyConfig(grant.code),period=TF_SECONDS[config.executionTimeframe],close=Math.floor((Date.now()/1000-7)/period)*period;
   const marker='lastProcessed:'+grant.id;
   if((await this.ctx.storage.get<number>(marker)||0)>=close)return;
   const broker=await this.provider(grant,'snapshot');
   if(broker.positions?.length||broker.orders?.length){await this.ctx.storage.put(marker,close);await this.record('Broker exposure present. New entries skipped.');return}
   if(broker.accessRights!==0)throw Error('cTrader account permissions changed; entries halted');
   const datasets:Record<string,any[]>={};
   for(const tf of config.timeframes){
    const reply=await this.provider(grant,'candles',{timeframe:tf,end:close});
    if(!Array.isArray(reply.candles)||reply.candles.length<30)throw Error('No reliable cTrader '+tf+' candle history');
    datasets[tf]=reply.candles;
   }
   const execution=datasets[config.executionTimeframe],last=execution.at(-1);
   if(!last||last.time+period!==close)throw Error('Latest closed cTrader candle is missing; refusing entry');
   const vm=await getQuickJSWASMModule();
   const decisions=evaluateStrategyInSandbox(vm,grant.code,datasets,config as any) as any[];
   const decision=decisions.at(-1);
   await this.ctx.storage.put(marker,close);
   await this.ctx.storage.put('lastEvaluation',{time:Date.now(),candleClose:close,action:decision?.action||'WAIT'});
   await this.record('Candle '+new Date(close*1000).toISOString()+' · signal '+(decision?.action||'WAIT'));
   if(decision?.action!=='BUY'&&decision?.action!=='SELL'){await this.ctx.storage.delete('lastError');return}
   if(Date.now()-close*1000>30000)throw Error('cTrader signal was too late for safe execution');
   const stop=Number(decision.stopLoss),target=Number(decision.takeProfit);
   if(!(stop>0&&target>0))throw Error('Signal does not include valid protective prices');
   const clientOrderId='tv-'+(await hash(grant.id+':'+close)).slice(0,30);
   await this.ctx.storage.put('pendingIntent',{clientOrderId,symbol:grant.symbol,side:decision.action,stop,target,createdAt:Date.now()});
   const out=await this.provider(grant,'execute',{candleClose:close,side:decision.action,stop,target,symbolId:grant.symbolId});
   if(out.filled!==true||out.protected!==true||out.clientOrderId!==clientOrderId)throw Error('Broker did not confirm the protected order identity');
   await this.ctx.storage.put('lastOrder',{...out,confirmedAt:Date.now()});
   await this.ctx.storage.delete('pendingIntent');await this.ctx.storage.delete('lastError');
   await this.record('Broker confirmed '+decision.action+' '+grant.symbol+' · position '+out.positionId+' protected');
  }catch(e){
   await this.ctx.storage.put('running',false);await this.ctx.storage.put('paused',false);
   const message=e instanceof Error?e.message:'cTrader live execution failed';
   await this.ctx.storage.put('lastError',message);await this.record('Execution halted · '+message);
  }finally{await this.schedule()}
 })}
}
