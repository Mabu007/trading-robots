import {BiQuoteStream} from './biquote-stream';
import {getQuickJSWASMModule} from '@cf-wasm/quickjs/workerd';
import {evaluateStrategyInSandbox} from './strategy-sandbox';
import {parseStrategyConfig} from '../src/strategy';
import {DurableObject} from 'cloudflare:workers';
import {biquoteSnapshot} from '../shared/biquote';
import {ALERT_TF,emptyRuleState,evaluateAlert,validateAlertRule,evaluateTick,type TickState,type AlertRule,type RuleState} from '../shared/market-alerts';
type Env={ALERTS:DurableObjectNamespace;ALERT_SECRET:string;ALERT_CONTROL_URL:string;MARKET_ALERTS_ENABLED:string};
type Config={uid:string;id:string;revision:string;rule:AlertRule;strategySource?:{code:string;config:any}};
export class MarketAlert extends DurableObject<Env>{
 private stream:BiQuoteStream|null=null;
 private tail:Promise<unknown>=Promise.resolve();
 private serial<T>(work:()=>Promise<T>){const p=this.tail.then(work,work);this.tail=p.catch(()=>{});return p}
 private async status(){const config=await this.ctx.storage.get<Config>('config'),lastCheck=await this.ctx.storage.get<number>('lastCheck'),startedAt=await this.ctx.storage.get<number>('startedAt');const dataStatus=config?.rule.basis==='live-price'?(lastCheck&&Date.now()-lastCheck<=30000?'fresh':startedAt&&Date.now()-startedAt<=30000?'waiting':'unavailable'):'candle-close';return {dataStatus,config:await this.ctx.storage.get('config'),running:await this.ctx.storage.get('running')===true,state:await this.ctx.storage.get('state'),error:await this.ctx.storage.get('error')||null,events:await this.ctx.storage.get('events')||[],nextAlarm:await this.ctx.storage.getAlarm(),gap:await this.ctx.storage.get('gap')||null,lastCheck:await this.ctx.storage.get('lastCheck')||null};}
 async fetch(req:Request){return this.serial(async()=>{
  const action=new URL(req.url).pathname.slice(1),uid=req.headers.get('X-TV-UID'),config=await this.ctx.storage.get<Config>('config');
  if(config&&config.uid!==uid)return Response.json({error:'Wrong owner'},{status:403});
  if(action==='status')return Response.json(await this.status());
  if(action==='subscribe'){const config=await req.json<any>();const subscribers=await this.ctx.storage.get<Record<string,string>>('subscribers')||{};subscribers[config.actor]=config.uid;await this.ctx.storage.put('subscribers',subscribers);await this.ctx.storage.put('streamSymbol',config.symbol);await this.ensureStream(config.symbol);await this.ctx.storage.setAlarm(Date.now()+15000);return Response.json({ready:true});}
  if(action==='unsubscribe'){const input=await req.json<any>(),subscribers=await this.ctx.storage.get<Record<string,string>>('subscribers')||{};delete subscribers[input.actor];await this.ctx.storage.put('subscribers',subscribers);return Response.json({ready:true});}
  if(action==='tick'){if(!config||await this.ctx.storage.get('running')!==true)return Response.json({ignored:true});const quote=await req.json<any>();const previous=await this.ctx.storage.get<TickState>('tickState')||{previous:null,lastTime:0,engine:emptyRuleState()};if(previous.lastTime&&quote.timestamp-previous.lastTime>30000){previous.previous=null;await this.ctx.storage.put('gap',{reason:'Tick stream recovered; intermediate touches may have been missed.'});}const out=evaluateTick(config.rule,previous,quote,Date.now());const events=await this.ctx.storage.get<any[]>('events')||[];if(events.filter(e=>e.delivery==='pending').length>=100){await this.ctx.storage.put('running',false);await this.ctx.storage.put('error','Notification backlog reached limit; pause acknowledged.');return Response.json({backlog:true});}for(const e of out.events)events.push({...e,id:config.revision+':'+e.key,delivery:'pending',revision:config.revision,attempts:0});await this.ctx.storage.put({tickState:out.state,events:[...events.filter(e=>e.delivery==='pending'),...events.filter(e=>e.delivery!=='pending').slice(-100)],lastCheck:Date.now()});if(out.state.engine.finished)await this.ctx.storage.put('running',false);const nextAlarm=await this.ctx.storage.getAlarm();if(!nextAlarm||nextAlarm>Date.now()+1000)await this.ctx.storage.setAlarm(Date.now()+1000);return Response.json({ready:true});}
  if(action==='snapshot'){const {symbol,timeframe}=await req.json<any>();const cached=await this.ctx.storage.get<any>('feed');if(cached&&cached.symbol===symbol&&cached.timeframe===timeframe&&Date.now()-cached.checkedAt<10000)return Response.json(cached);const data=await biquoteSnapshot(symbol,timeframe);await this.ctx.storage.put('feed',data);return Response.json(data);}
  if(action==='start'){
   const c=await req.json<Config>();validateAlertRule(c.rule);
   if(c.uid!==uid||!/^[-\w]{1,128}$/.test(c.id)||!/^[a-f0-9]{64}$/.test(c.revision)||c.rule.expiresAt<=Date.now()/1000)throw Error('Invalid alert authorization');
   if(config?.revision!==c.revision&&await this.ctx.storage.get('running')===true)throw Error('Pause before changing alert rules');
   if(config?.revision!==c.revision){await this.ctx.storage.put('state',emptyRuleState());await this.ctx.storage.put('events',[]);}
   if(c.strategySource){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(c.strategySource.code));const sha=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');if(sha!==c.rule.strategy?.sourceHash)throw Error('Strategy source hash mismatch');parseStrategyConfig(c.strategySource.code);}
   if(c.rule.basis==='live-price'){const tickState=await this.ctx.storage.get<TickState>('tickState');if(tickState)await this.ctx.storage.put('tickState',{...tickState,previous:null});}await this.ctx.storage.put('startedAt',Date.now());await this.ctx.storage.put('config',c);await this.ctx.storage.put('running',true);await this.ctx.storage.setAlarm(Date.now()+1000);
  }else if(action==='pause'||action==='delete'){await this.ctx.storage.put('running',false);if(config?.rule.basis==='live-price'){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(config.uid+':'+config.id));const actor=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');await this.env.ALERTS.get(this.env.ALERTS.idFromName('ticks:'+config.rule.symbol)).fetch(new Request('https://feed/unsubscribe',{method:'POST',body:JSON.stringify({actor})}));}await this.ctx.storage.setAlarm(Date.now()+1000);}
  else throw Error('Unknown alert action');return Response.json(await this.status());
 })}
 private async ensureStream(symbol:string){this.stream??=new BiQuoteStream(this.ctx,async tick=>{const subscribers=await this.ctx.storage.get<Record<string,string>>('subscribers')||{};const timestamp=Date.parse(tick.timestamp);if(tick.stale===true||tick.marketState==='closed'||!Number.isFinite(timestamp)||Date.now()-timestamp>15000||!(tick.bid>0&&tick.ask>=tick.bid))return;await Promise.allSettled(Object.keys(subscribers).map(actor=>this.env.ALERTS.get(this.env.ALERTS.idFromName(actor)).fetch(new Request('https://alert/tick',{method:'POST',headers:{'X-TV-UID':subscribers[actor]},body:JSON.stringify({mid:(Number(tick.bid)+Number(tick.ask))/2,timestamp})}))));});await this.stream.connect(symbol);}
 async alarm(){return this.serial(async()=>{
  const symbol=await this.ctx.storage.get<string>('streamSymbol');if(symbol){const subscribers=await this.ctx.storage.get<Record<string,string>>('subscribers')||{};if(Object.keys(subscribers).length){try{await this.ensureStream(symbol);this.stream?.ping();}finally{await this.ctx.storage.setAlarm(Date.now()+15000);}}else this.stream?.close();return;}
  const c=await this.ctx.storage.get<Config>('config');if(!c)return;
  try{
   if(await this.ctx.storage.get('running')!==true)return;
   if(c.rule.expiresAt<=Date.now()/1000){await this.ctx.storage.put('running',false);return;}
   if(c.rule.basis==='live-price'){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(c.uid+':'+c.id));const actor=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');const feed=this.env.ALERTS.get(this.env.ALERTS.idFromName('ticks:'+c.rule.symbol));const res=await feed.fetch(new Request('https://alert/subscribe',{method:'POST',body:JSON.stringify({actor,uid:c.uid,symbol:c.rule.symbol})}));if(!res.ok)throw Error('Tick stream unavailable');return;}
   // Shared upstream read per symbol/timeframe, across all alert owners.
   const feed=this.env.ALERTS.get(this.env.ALERTS.idFromName('feed:'+c.rule.symbol+':'+c.rule.timeframe));
   const response=await feed.fetch(new Request('https://alert/snapshot',{method:'POST',body:JSON.stringify({symbol:c.rule.symbol,timeframe:c.rule.timeframe})}));
   if(!response.ok)throw Error('BiQuote unavailable; conditions may have been missed.');const data=await response.json<any>();
   const state=await this.ctx.storage.get<RuleState>('state')||emptyRuleState();
   const latest=data.bars.at(-1)?.time,gap=state.lastBar&&latest-state.lastBar>ALERT_TF[c.rule.timeframe];
   if(gap){state.stage=0;state.stageStarted=0;state.latched=[];await this.ctx.storage.put('gap',{at:Date.now(),reason:'Feed interrupted; intermediate conditions may have been missed. Stages reset.'});}
   const datasets:Record<string,any[]>={[c.rule.timeframe]:data.bars};
   const timeframes:string[]=c.strategySource?parseStrategyConfig(c.strategySource.code).timeframes:c.rule.conditions.map(x=>x.timeframe||c.rule.timeframe);
   for(const timeframe of [...new Set(timeframes)]){if(datasets[timeframe])continue;const stub=this.env.ALERTS.get(this.env.ALERTS.idFromName('feed:'+c.rule.symbol+':'+timeframe));const r=await stub.fetch(new Request('https://alert/snapshot',{method:'POST',body:JSON.stringify({symbol:c.rule.symbol,timeframe})}));if(!r.ok)throw Error('Higher timeframe unavailable');const result=await r.json<any>();datasets[timeframe]=result.bars;}
   let evaluationRule=c.rule,decision:any=null;if(c.strategySource){const config=parseStrategyConfig(c.strategySource.code);decision=(evaluateStrategyInSandbox(await getQuickJSWASMModule(),c.strategySource.code,datasets,config) as any[]).at(-1);evaluationRule={...c.rule,conditions:[{id:'c1',kind:'above',value:decision?.action==='BUY'||decision?.action==='SELL'?0:Number.MAX_VALUE}]};}
   const evaluated=evaluateAlert(evaluationRule,decision?{...state,latched:[]}:state,data.bars,Date.now()/1000,datasets);if(decision)for(const event of evaluated.events){event.matched=['strategy:'+decision.action];Object.assign(event,{reason:decision.reason,checks:decision.checks});}
   const events=await this.ctx.storage.get<any[]>('events')||[];
   if(events.filter(e=>e.delivery==='pending').length>=100)throw Error('Delivery backlog full; monitoring suspended until pending messages recover.');
   for(const e of evaluated.events)events.push({...e,id:c.revision+':'+e.key,delivery:'pending',attempts:0,revision:c.revision});
   // Commit state and outbox together before any external effect.
   await this.ctx.storage.put({state:evaluated.state,events:[...events.filter(e=>e.delivery==='pending'),...events.filter(e=>e.delivery!=='pending').slice(-100)],lastCheck:Date.now(),error:gap?'Feed recovered; intermediate conditions may have been missed.':null});
   if(evaluated.state.finished)await this.ctx.storage.put('running',false);
  }catch(e){await this.ctx.storage.put('error',e instanceof Error?e.message:'Market unavailable');}
  finally{
   if(c.rule.basis==='live-price'&&await this.ctx.storage.get('running')!==true){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(c.uid+':'+c.id));const actor=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');try{await this.env.ALERTS.get(this.env.ALERTS.idFromName('ticks:'+c.rule.symbol)).fetch(new Request('https://feed/unsubscribe',{method:'POST',body:JSON.stringify({actor})}));}catch{await this.ctx.storage.put('error','Tick stream unsubscribe unconfirmed');}}
   const events=await this.ctx.storage.get<any[]>('events')||[];
   for(const event of events.filter(e=>e.delivery==='pending').slice(0,3)){
    try{const r=await fetch(new URL('/api/internal/market-alert-event',this.env.ALERT_CONTROL_URL),{method:'POST',headers:{Authorization:'Bearer '+this.env.ALERT_SECRET,'Content-Type':'application/json'},body:JSON.stringify({uid:c.uid,id:c.id,revision:c.revision,event}),signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('Delivery service unavailable');const result=await r.json<any>();event.delivery=result.delivery;event.messageId=result.messageId||null;}
    catch{event.attempts++;event.lastError='Delivery service unavailable; retry scheduled.';}
   }
   await this.ctx.storage.put('events',[...events.filter(e=>e.delivery==='pending'),...events.filter(e=>e.delivery!=='pending').slice(-100)]);
   if(await this.ctx.storage.get('running')===true||events.some(e=>e.delivery==='pending')){const period=c.rule.basis==='live-price'?15000:ALERT_TF[c.rule.timeframe]*1000;await this.ctx.storage.setAlarm(Math.max(Date.now()+(c.rule.basis==='live-price'?15000:30000),(Math.floor(Date.now()/period)+1)*period+5000));}
  }
 })}
}
export default {async fetch(req:Request,env:Env){
 try{
 const secret=env.ALERT_SECRET||'';if(secret.length<32||req.headers.get('Authorization')!=='Bearer '+secret)return new Response('Unauthorized',{status:401});
 if(new URL(req.url).pathname==='/health')return Response.json({ready:env.MARKET_ALERTS_ENABLED==='true',runtime:'market-alerts',version:1});
 const [,id,action]=new URL(req.url).pathname.split('/');const uid=req.headers.get('X-TV-UID');
 if(!uid||uid.length>128||!/^[-\w]{1,128}$/.test(id)||!['start','pause','delete','status'].includes(action))return new Response('Invalid route',{status:400});
 if(action==='start'&&env.MARKET_ALERTS_ENABLED!=='true')return new Response('Monitoring disabled',{status:503});
 if(req.method!==(action==='status'?'GET':'POST'))return new Response(null,{status:405});
 const body=req.method==='POST'?await req.text():undefined;if(body&&body.length>220000)return new Response(null,{status:413});
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(uid+':'+id));const name=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return env.ALERTS.get(env.ALERTS.idFromName(name)).fetch(new Request('https://alert/'+action,{method:req.method,headers:{'X-TV-UID':uid},...(body?{body}:{})}));
 }catch{return Response.json({error:'Alert runtime unavailable'},{status:503});}
}} satisfies ExportedHandler<Env>;
