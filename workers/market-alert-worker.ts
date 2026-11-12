import {DurableObject} from 'cloudflare:workers';
import {biquoteSnapshot} from '../shared/biquote';
import {ALERT_TF,emptyRuleState,evaluateAlert,validateAlertRule,type AlertRule,type RuleState} from '../shared/market-alerts';
type Env={ALERTS:DurableObjectNamespace;ALERT_SECRET:string;ALERT_CONTROL_URL:string;MARKET_ALERTS_ENABLED:string};
type Config={uid:string;id:string;revision:string;rule:AlertRule};
export class MarketAlert extends DurableObject<Env>{
 private tail:Promise<unknown>=Promise.resolve();
 private serial<T>(work:()=>Promise<T>){const p=this.tail.then(work,work);this.tail=p.catch(()=>{});return p}
 private async status(){return {config:await this.ctx.storage.get('config'),running:await this.ctx.storage.get('running')===true,state:await this.ctx.storage.get('state'),error:await this.ctx.storage.get('error')||null,events:await this.ctx.storage.get('events')||[],nextAlarm:await this.ctx.storage.getAlarm(),gap:await this.ctx.storage.get('gap')||null,lastCheck:await this.ctx.storage.get('lastCheck')||null};}
 async fetch(req:Request){return this.serial(async()=>{
  const action=new URL(req.url).pathname.slice(1),uid=req.headers.get('X-TV-UID'),config=await this.ctx.storage.get<Config>('config');
  if(config&&config.uid!==uid)return Response.json({error:'Wrong owner'},{status:403});
  if(action==='status')return Response.json(await this.status());
  if(action==='snapshot'){const {symbol,timeframe}=await req.json<any>();const cached=await this.ctx.storage.get<any>('feed');if(cached&&cached.symbol===symbol&&cached.timeframe===timeframe&&Date.now()-cached.checkedAt<10000)return Response.json(cached);const data=await biquoteSnapshot(symbol,timeframe);await this.ctx.storage.put('feed',data);return Response.json(data);}
  if(action==='start'){
   const c=await req.json<Config>();validateAlertRule(c.rule);
   if(c.uid!==uid||!/^[-\w]{1,128}$/.test(c.id)||!/^[a-f0-9]{64}$/.test(c.revision)||c.rule.expiresAt<=Date.now()/1000)throw Error('Invalid alert authorization');
   if(config?.revision!==c.revision&&await this.ctx.storage.get('running')===true)throw Error('Pause before changing alert rules');
   if(config?.revision!==c.revision){await this.ctx.storage.put('state',emptyRuleState());await this.ctx.storage.put('events',[]);}
   await this.ctx.storage.put('config',c);await this.ctx.storage.put('running',true);await this.ctx.storage.setAlarm(Date.now()+1000);
  }else if(action==='pause'||action==='delete'){await this.ctx.storage.put('running',false);await this.ctx.storage.setAlarm(Date.now()+1000);}
  else throw Error('Unknown alert action');return Response.json(await this.status());
 })}
 async alarm(){return this.serial(async()=>{
  const c=await this.ctx.storage.get<Config>('config');if(!c)return;
  try{
   if(await this.ctx.storage.get('running')!==true)return;
   if(c.rule.expiresAt<=Date.now()/1000){await this.ctx.storage.put('running',false);return;}
   // Shared upstream read per symbol/timeframe, across all alert owners.
   const feed=this.env.ALERTS.get(this.env.ALERTS.idFromName('feed:'+c.rule.symbol+':'+c.rule.timeframe));
   const response=await feed.fetch(new Request('https://alert/snapshot',{method:'POST',body:JSON.stringify({symbol:c.rule.symbol,timeframe:c.rule.timeframe})}));
   if(!response.ok)throw Error('BiQuote unavailable; conditions may have been missed.');const data=await response.json<any>();
   const state=await this.ctx.storage.get<RuleState>('state')||emptyRuleState();
   const latest=data.bars.at(-1)?.time,gap=state.lastBar&&latest-state.lastBar>ALERT_TF[c.rule.timeframe];
   if(gap){state.stage=0;state.stageStarted=0;state.latched=[];await this.ctx.storage.put('gap',{at:Date.now(),reason:'Feed interrupted; intermediate conditions may have been missed. Stages reset.'});}
   const evaluated=evaluateAlert(c.rule,state,data.bars,Date.now()/1000);
   const events=await this.ctx.storage.get<any[]>('events')||[];
   if(events.filter(e=>e.delivery==='pending').length>=100)throw Error('Delivery backlog full; monitoring suspended until pending messages recover.');
   for(const e of evaluated.events)events.push({...e,id:c.revision+':'+e.key,delivery:'pending',attempts:0,revision:c.revision});
   // Commit state and outbox together before any external effect.
   await this.ctx.storage.put({state:evaluated.state,events:[...events.filter(e=>e.delivery==='pending'),...events.filter(e=>e.delivery!=='pending').slice(-100)],lastCheck:Date.now(),error:gap?'Feed recovered; intermediate conditions may have been missed.':null});
   if(evaluated.state.finished)await this.ctx.storage.put('running',false);
  }catch(e){await this.ctx.storage.put('error',e instanceof Error?e.message:'Market unavailable');}
  finally{
   const events=await this.ctx.storage.get<any[]>('events')||[];
   for(const event of events.filter(e=>e.delivery==='pending').slice(0,3)){
    try{const r=await fetch(new URL('/api/internal/market-alert-event',this.env.ALERT_CONTROL_URL),{method:'POST',headers:{Authorization:'Bearer '+this.env.ALERT_SECRET,'Content-Type':'application/json'},body:JSON.stringify({uid:c.uid,id:c.id,revision:c.revision,event}),signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('Delivery service unavailable');const result=await r.json<any>();event.delivery=result.delivery;event.messageId=result.messageId||null;}
    catch{event.attempts++;event.lastError='Delivery service unavailable; retry scheduled.';}
   }
   await this.ctx.storage.put('events',[...events.filter(e=>e.delivery==='pending'),...events.filter(e=>e.delivery!=='pending').slice(-100)]);
   if(await this.ctx.storage.get('running')===true||events.some(e=>e.delivery==='pending')){const period=ALERT_TF[c.rule.timeframe]*1000;await this.ctx.storage.setAlarm(Math.max(Date.now()+30000,(Math.floor(Date.now()/period)+1)*period+5000));}
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
 const body=req.method==='POST'?await req.text():undefined;if(body&&body.length>16000)return new Response(null,{status:413});
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(uid+':'+id));const name=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return env.ALERTS.get(env.ALERTS.idFromName(name)).fetch(new Request('https://alert/'+action,{method:req.method,headers:{'X-TV-UID':uid},...(body?{body}:{})}));
 }catch{return Response.json({error:'Alert runtime unavailable'},{status:503});}
}} satisfies ExportedHandler<Env>;
