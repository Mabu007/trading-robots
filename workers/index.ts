import { DurableObject } from 'cloudflare:workers';
import { RobotRuntime,AccountRuntime,type Deployment,type ExecutionJob,type DurableStore } from './runtime-core';
import { getQuickJSWASMModule } from '@cf-wasm/quickjs/workerd';
import { evaluateStrategyInSandbox } from './strategy-sandbox';
import { TF_SECONDS } from '../shared/trading';
import { parseStrategyConfig } from '../src/strategy';
interface Env { STRATEGY_ISOLATION_VERIFIED:string; ROBOTS:DurableObjectNamespace;ACCOUNTS:DurableObjectNamespace;DATA:R2Bucket;SIGNALS:Queue<ExecutionJob>;TRADING_INTERNAL_SECRET:string;CONTROL_API_URL:string;CTRADER_GATEWAY_URL:string;DEMO_TRADING_ENABLED:string; }
const json=(v:unknown,status=200)=>Response.json(v,{status});
async function rpc(env:Env,target:'control'|'gateway',action:string,body:any){const base=target==='control'?env.CONTROL_API_URL:env.CTRADER_GATEWAY_URL;if(!base||!env.TRADING_INTERNAL_SECRET)throw Error(`${target} is not configured`);const r=await fetch(new URL(target==='control'?`/api/internal/trading/${action}`:`/rpc/${action}`,base),{method:'POST',headers:{Authorization:`Bearer ${env.TRADING_INTERNAL_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});const d=await r.json<any>();if(!r.ok)throw Error(d.error||`${target} unavailable`);return d;}
const storage=(ctx:DurableObjectState):DurableStore=>({get:key=>ctx.storage.get(key),put:(key,value)=>ctx.storage.put(key,value),putMany:entries=>ctx.storage.put(entries),setAlarm:time=>ctx.storage.setAlarm(time),deleteAlarm:()=>ctx.storage.deleteAlarm()});
const id=(value:string)=>/^[A-Za-z0-9_-]{1,100}$/.test(value);
async function hash(code:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code)))).map(v=>v.toString(16).padStart(2,'0')).join('');}
class SerializedObject extends DurableObject<Env> {private tail:Promise<any>=Promise.resolve();protected serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.tail.then(fn,fn);this.tail=next.catch(()=>{});return next;}}
export class Robot extends SerializedObject {
  private runtime:RobotRuntime;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.runtime=new RobotRuntime(storage(ctx),{
    now:()=>Date.now(),evaluate:(d,cutoff)=>this.evaluate(d,cutoff),
    prepareFanout:async signal=>{
      await rpc(env,'control','signal',{signal});const {subscribers}=await rpc(env,'control','subscribers',{botId:signal.botId});const targets=subscribers.map((s:any)=>({uid:s.uid,accountId:s.accountId}));
      const key=`runtime-signals/${signal.id}.json`;await env.DATA.put(key,JSON.stringify({signal,targets}));return key;
    },
    sendFanout:async(key,cursor)=>{const object=await env.DATA.get(key);if(!object)throw Error('Signal outbox is missing');const data=await object.json<any>();if(data.signal.expiresAt<Date.now())return {done:true,next:data.targets.length};const batch=data.targets.slice(cursor,cursor+100).map((s:any)=>({body:{...s,signal:data.signal}}));if(batch.length)await env.SIGNALS.sendBatch(batch);return {next:cursor+batch.length,done:cursor+batch.length>=data.targets.length};}
  });}
  async fetch(req:Request){return this.serial(async()=>{try{const action=new URL(req.url).pathname.split('/').at(-1)!;if(action==='status')return json({...await this.runtime.status(),demoExecutionEnabled:this.env.DEMO_TRADING_ENABLED==='true'});if(req.method!=='POST')return json({error:'POST required'},405);if(action==='deploy'||action==='update'){
      const d=await req.json<any>();if(!id(d.botId)||!id(d.version)||!d.codeKey||!d.ownerUid)throw Error('Invalid deployment');return json(await this.runtime.deploy(d));
    }return json(await this.runtime.control(action));}catch(e){return json({error:e instanceof Error?e.message:'Runtime operation failed'},400);}});}
  async alarm(){return this.serial(()=>this.runtime.alarm());}
  private async evaluate(d:Deployment,cutoff:number){
    const code=await this.env.DATA.get(d.codeKey);if(!code)throw Error('Pinned strategy version is missing');const source=await code.text();if(await hash(source)!==d.version)throw Error('Pinned strategy digest mismatch');
    const datasets:Record<string,any[]>={};let total=0;
    for(const tf of d.strategy.timeframes){const key=`runtime-history/${d.botId}/${d.version}/${tf}.json`,previous=await this.env.DATA.get(key),rows=previous?await previous.json<any[]>():[],from=rows.length?(rows.at(-1).time+TF_SECONDS[tf])*1000:d.replayFrom[tf];let merged=rows;
      if(from<cutoff){const loaded=await rpc(this.env,'gateway','candles',{uid:d.sourceUid,accountId:d.sourceAccountId,symbolId:d.sourceSymbolId,timeframe:tf,from,to:cutoff});const map=new Map(rows.map(c=>[c.time,c]));for(const c of loaded.candles){if(![c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||c.high<c.low||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))throw Error('Invalid broker candles');map.set(c.time,c);}merged=[...map.values()].sort((a,b)=>a.time-b.time);await this.env.DATA.put(key,JSON.stringify(merged));}
      datasets[tf]=merged.filter(c=>(c.time+TF_SECONDS[tf])*1000<=cutoff);total+=datasets[tf].length;if(total>50000)throw Error('Replay safety limit reached. Stop and deploy a new validated version.');
    }
    const quick=await getQuickJSWASMModule();
    const decisions=evaluateStrategyInSandbox(quick,source,datasets,d.strategy);
    const last=datasets[d.strategy.executionTimeframe].at(-1);if(!last)throw Error('No completed execution candle');return {decision:decisions.at(-1),reference:last.close,candleClose:(last.time+TF_SECONDS[d.strategy.executionTimeframe])*1000};
  }
}
export class Account extends SerializedObject {
  private runtime:AccountRuntime;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.runtime=new AccountRuntime(storage(ctx),{
    now:()=>Date.now(),eligible:async job=>{if(env.DEMO_TRADING_ENABLED!=='true')throw Error('Demo execution operator gate is disabled');const data=await rpc(env,'control','eligible',{uid:job.uid,botId:job.signal.botId,version:job.signal.version,signalId:job.signal.id,candleClose:job.signal.candleClose});const symbolId=data.broker.mappings?.[job.signal.symbol];if(!symbolId||data.subscription.accountId!==job.accountId||data.broker.accountId!==job.accountId)throw Error('Account or symbol mapping changed');return {risk:data.subscription.risk,symbolId};},
    snapshot:(job,symbolId)=>rpc(env,'gateway','snapshot',{uid:job.uid,accountId:job.accountId,symbolId}),margin:async(job,order)=>(await rpc(env,'gateway','margin',{uid:job.uid,accountId:job.accountId,order})).margin,
    submit:(job,order,risk)=>rpc(env,'gateway','submit',{uid:job.uid,accountId:job.accountId,order,signal:job.signal,risk}),reconcile:(job,clientOrderId,since)=>rpc(env,'gateway','reconcile',{uid:job.uid,accountId:job.accountId,clientOrderId,since}),
    record:record=>rpc(env,'control','execution',{uid:record.uid,botId:record.botId,record}).then(()=>{})
  });}
  async fetch(req:Request){return this.serial(async()=>{try{const data=await req.json<any>();if(new URL(req.url).pathname.endsWith('/reconcile'))return json(await this.runtime.reconcilePending(data.uid));if(new URL(req.url).pathname.endsWith('/manage')){const result=await rpc(this.env,'gateway','manage',data);return json(result);}return json(await this.runtime.execute(data));}catch(e){return json({error:e instanceof Error?e.message:'Execution failed'},503);}});}
}
export default {
  async fetch(request:Request,env:Env){
    if(!env.TRADING_INTERNAL_SECRET||request.headers.get('Authorization')!==`Bearer ${env.TRADING_INTERNAL_SECRET}`)return json({error:'Internal authorization required'},401);
    const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean);try{
      if(parts[0]==='bots'&&id(parts[1])&&parts[2]){
        if(['deploy','update'].includes(parts[2])){
          if(env.STRATEGY_ISOLATION_VERIFIED!=='true')throw Error('Strategy deployment awaits production isolation verification (CPU limits and blocked outbound access).');
          if(request.method!=='POST')return json({error:'POST required'},405);const data=await request.json<any>();if(data.botId!==parts[1]||typeof data.code!=='string'||data.code.length>180000)throw Error('Invalid strategy payload');const strategy=parseStrategyConfig(data.code);if(!/export\s+function\s+onCandle\s*\(/.test(data.code))throw Error('Missing canonical strategy export');const version=await hash(data.code);if(version!==data.version)throw Error('Strategy digest mismatch');
          const codeKey=`runtime-code/${parts[1]}/${version}.js`;await env.DATA.put(codeKey,data.code);const now=Date.now(),replayFrom=Object.fromEntries(strategy.timeframes.map((tf:string)=>[tf,Math.floor(now/(TF_SECONDS[tf]*1000))*TF_SECONDS[tf]*1000-1000*TF_SECONDS[tf]*1000]));
          const payload={...data,generation:crypto.randomUUID(),code:undefined,codeKey,strategy,replayFrom};return env.ROBOTS.get(env.ROBOTS.idFromName(parts[1])).fetch(new Request(`https://robot/${parts[2]}`,{method:'POST',body:JSON.stringify(payload)}));
        }
        return env.ROBOTS.get(env.ROBOTS.idFromName(parts[1])).fetch(new Request(`https://robot/${parts[2]}`,{method:request.method,...(request.method==='POST'?{body:'{}'}:{})}));
      }
      if(parts[0]==='accounts'&&['manage','reconcile'].includes(parts[2])&&request.method==='POST'){const data=await request.json<any>();if(typeof data.uid!=='string'||!data.uid||parts[2]==='manage'&&data.confirmed!==true)throw Error('Invalid customer management request');return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(data.uid)).fetch(new Request(`https://account/${parts[2]}`,{method:'POST',body:JSON.stringify(data)}));}
      return json({error:'Unknown runtime route'},404);
    }catch(e){return json({error:e instanceof Error?e.message:'Runtime request failed'},400);}
  },
  async queue(batch:MessageBatch<ExecutionJob>,env:Env){await Promise.all(batch.messages.map(async message=>{try{const j=message.body;if(!j.uid||!j.accountId||!j.signal?.id||!id(j.signal.botId))throw Error('Invalid execution job');const response=await env.ACCOUNTS.get(env.ACCOUNTS.idFromName(j.uid)).fetch(new Request('https://account/execute',{method:'POST',body:JSON.stringify(j)}));if(!response.ok)throw Error('Account execution pending');const outcome=await response.json<any>();if(outcome.state==='unknown'||outcome.state==='submitting')throw Error('Broker acknowledgement requires reconciliation');message.ack();}catch{message.retry({delaySeconds:30});}}));}
} satisfies ExportedHandler<Env,ExecutionJob>;
