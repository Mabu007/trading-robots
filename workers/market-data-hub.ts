/* One global DO per Hyperliquid network: cross-instance cache, pacing and fanout.
   This Worker is intentionally PUBLIC MARKET DATA ONLY: no user data, accounts or orders. */
type Env={MARKET_HUB:DurableObjectNamespace};
type Item={expires:number;body:string};
type Budget={epoch:number;used:number;blockedUntil:number};
type Subscription={type:string;coin?:string;interval?:string;dex?:string};
type WsClient=WebSocket & {serializeAttachment(value:unknown):void;deserializeAttachment():unknown};
const upstream='https://api.hyperliquid.xyz/info', wsUrl='wss://api.hyperliquid.xyz/ws';
const identifier=/^[A-Za-z0-9@._:/-]{1,64}$/, dex=/^[A-Za-z0-9_-]{0,24}$/;
const intervals=new Set(['1m','3m','5m','15m','30m','1h','2h','4h','8h','12h','1d','3d','1w','1M']);
const types=new Set(['perpDexs','meta','metaAndAssetCtxs','spotMeta','spotMetaAndAssetCtxs','allMids','l2Book','recentTrades','candleSnapshot','fundingHistory']);
function valid(body:any):boolean{
 if(!body||typeof body!=='object'||Array.isArray(body)||!types.has(body.type))return false;
 if(body.dex!==undefined&&(typeof body.dex!=='string'||!dex.test(body.dex)))return false;
 if(body.coin!==undefined&&(typeof body.coin!=='string'||!identifier.test(body.coin)||body.coin.includes('..')))return false;
 if(['l2Book','recentTrades','fundingHistory'].includes(body.type)&&!body.coin)return false;
 if(body.type==='candleSnapshot'){
  const r=body.req;
  if(!r||typeof r.coin!=='string'||!identifier.test(r.coin)||!intervals.has(r.interval)||!Number.isSafeInteger(r.startTime)||!Number.isSafeInteger(r.endTime)||r.endTime<=r.startTime||r.coin.includes('..')||r.endTime-r.startTime>1000*60*60*24*7)return false;
 }
 if(body.type==='fundingHistory'&&(!Number.isSafeInteger(body.startTime)||body.endTime!==undefined&&(!Number.isSafeInteger(body.endTime)||body.endTime<body.startTime||body.endTime-body.startTime>1000*60*60*24*7)))return false;
 return true;
}
function weight(body:any){
 if(body.type==='l2Book'||body.type==='allMids')return 2;
 if(body.type==='candleSnapshot'){
  const ms:{[s:string]:number}={'1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'2h':7200000,'4h':14400000,'8h':28800000,'12h':43200000,'1d':86400000,'3d':259200000,'1w':604800000,'1M':2592000000};
  return Math.min(120,20+Math.ceil((body.req.endTime-body.req.startTime)/ms[body.req.interval]/60));
 }
 return body.type==='recentTrades'||body.type==='fundingHistory'?60:20;
}
function ttl(body:any){
 if(body.type==='l2Book')return 450;
 if(body.type==='recentTrades')return 700;
 if(body.type==='allMids')return 500;
 if(body.type==='candleSnapshot')return 3000;
 if(body.type==='metaAndAssetCtxs'||body.type==='spotMetaAndAssetCtxs')return 2000;
 if(body.type==='fundingHistory')return 12000;
 return 30000;
}
function subKey(sub:Subscription){return JSON.stringify(sub);}
function validateSub(raw:any):Subscription|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const type=raw.type;
 if(!['allMids','l2Book','trades','candle','activeAssetCtx','bbo'].includes(type))return null;
 if(type==='allMids')return raw.dex===undefined||raw.dex===''?{type:'allMids'}:null; // dex-specific allMids responses have no guaranteed discriminator
 if(typeof raw.coin!=='string'||!identifier.test(raw.coin)||raw.coin.includes('..'))return null;
 if(type==='candle'){if(!intervals.has(raw.interval))return null;return {type,coin:raw.coin,interval:raw.interval};}
 return {type,coin:raw.coin};
}
export class MarketDataHub {
 private state:DurableObjectState;
 private cache=new Map<string,Item>();
 private running=new Map<string,Promise<Response>>();
 private active=0;
 private upstream:WebSocket|null=null;private reconnectDelay=1000;private nextConnectAt=0;private lastEvent=0;
 private subscriptions=new Map<string,{subscription:Subscription;count:number}>();
 constructor(state:DurableObjectState,_env:Env){
  this.state=state;
  for(const ws of state.getWebSockets() as WsClient[]){
   const subs=ws.deserializeAttachment();
   if(!Array.isArray(subs))continue;
   for(const sub of subs){const v=validateSub(sub);if(v)this.bump(v,1);}
  }
  if(this.subscriptions.size)this.schedule();
 }
 private schedule(){void this.state.storage.setAlarm(Math.max(Date.now()+1000,Math.min(Date.now()+20000,this.nextConnectAt||Date.now()+20000)));}
 private bump(sub:Subscription,delta:number){
  const key=subKey(sub),old=this.subscriptions.get(key);
  const next=(old?.count??0)+delta;
  if(next<=0){this.subscriptions.delete(key);if(old&&this.upstream?.readyState===1)this.upstream.send(JSON.stringify({method:'unsubscribe',subscription:sub}));}
  else {this.subscriptions.set(key,{subscription:sub,count:next});if(!old&&this.upstream?.readyState===1)this.upstream.send(JSON.stringify({method:'subscribe',subscription:sub}));}
 }
 private async reserve(cost:number):Promise<{retry:number;reason:string}|null>{
  return this.state.storage.transaction(async tx=>{
   const now=Date.now();
   const prior=await tx.get<Budget>('provider-budget');
   const epoch=prior&&now-prior.epoch<60000&&now>=prior.epoch?prior.epoch:now;
   const used=prior&&epoch===prior.epoch?prior.used:0;
   const blockedUntil=prior?.blockedUntil??0;
   if(now<blockedUntil)return {retry:Math.max(1,Math.ceil((blockedUntil-now)/1000)),reason:'Provider backoff'};
   if(used+cost>650)return {retry:Math.max(1,Math.ceil((60000-(now-epoch))/1000)),reason:'Shared provider rate budget exhausted'};
   await tx.put<Budget>('provider-budget',{epoch,used:used+cost,blockedUntil});
   return null;
  });
 }
 private async blockUpstream(wait:number){
  await this.state.storage.transaction(async tx=>{
   const current=await tx.get<Budget>('provider-budget');
   const now=Date.now(),until=now+Math.max(1000,Math.min(60000,wait));
   await tx.put<Budget>('provider-budget',{
    epoch:current?.epoch??now,used:current?.used??0,blockedUntil:Math.max(current?.blockedUntil??0,until)
   });
  });
 }
 private sendStatus(state:string){
  const message=JSON.stringify({channel:'tvStatus',data:{state,receivedAt:Date.now(),source:'Hyperliquid public WebSocket'}});
  for(const ws of this.state.getWebSockets())if(ws.readyState===1)try{ws.send(message);}catch{}
 }
 private connect(){
  if(!this.subscriptions.size||Date.now()<this.nextConnectAt||this.upstream&&[0,1].includes(this.upstream.readyState))return;
  try {
   const socket=new WebSocket(wsUrl);this.upstream=socket;
   socket.addEventListener('open',()=>{
    this.reconnectDelay=1000;this.nextConnectAt=0;this.lastEvent=Date.now();
    for(const item of this.subscriptions.values())socket.send(JSON.stringify({method:'subscribe',subscription:item.subscription}));
    this.sendStatus('connected');
   });
   socket.addEventListener('message',(event:MessageEvent)=>{
    this.lastEvent=Date.now();
    try {
     const data=JSON.parse(String(event.data));const channel=data.channel;
     if(channel==='subscriptionResponse'||channel==='pong')return;
     const coin=channel==='trades'?data.data?.[0]?.coin:channel==='candle'?data.data?.s:data.data?.coin;
     for(const client of this.state.getWebSockets() as WsClient[]){
      if(client.readyState!==1)continue;
      const subs=client.deserializeAttachment();if(!Array.isArray(subs))continue;
      if(subs.some((sub:Subscription)=>sub.type===channel&&(
       channel==='allMids'||sub.coin===coin)&&(
       channel!=='candle'||sub.interval===data.data?.i)))try{client.send(JSON.stringify(data));}catch{}
     }
    }catch{}
   });
   socket.addEventListener('close',()=>{if(this.upstream===socket){this.upstream=null;this.nextConnectAt=Date.now()+this.reconnectDelay;this.reconnectDelay=Math.min(60000,this.reconnectDelay*2);this.sendStatus('reconnecting');this.schedule();}});
   socket.addEventListener('error',()=>{if(this.upstream===socket){try{socket.close();}catch{} this.upstream=null;this.nextConnectAt=Date.now()+this.reconnectDelay;this.reconnectDelay=Math.min(60000,this.reconnectDelay*2);this.sendStatus('upstream-error');this.schedule();}});
  }catch{this.upstream=null;this.nextConnectAt=Date.now()+this.reconnectDelay;this.reconnectDelay=Math.min(60000,this.reconnectDelay*2);this.schedule();}
 }
 async alarm(){
  if(!this.subscriptions.size){this.upstream?.close();this.upstream=null;return;}
  if(this.upstream?.readyState===1){
   if(this.lastEvent&&Date.now()-this.lastEvent>90000){this.upstream.close();this.upstream=null;this.nextConnectAt=Date.now()+this.reconnectDelay;this.sendStatus('stale');}
   else try{this.upstream.send(JSON.stringify({method:'ping'}));}catch{}
  }
  this.connect();this.schedule();
 }
 webSocketMessage(ws:WsClient,message:string|ArrayBuffer){
  if(typeof message!=='string'||message.length>1024){ws.close(1008,'Invalid subscription');return;}
  let data:any;try{data=JSON.parse(message);}catch{ws.close(1008,'Invalid JSON');return;}
  if(!['subscribe','unsubscribe'].includes(data.method)){ws.close(1008,'Read-only subscriptions only');return;}
  const sub=validateSub(data.subscription);if(!sub){ws.send(JSON.stringify({error:'Unsupported public subscription'}));return;}
  const subs=(ws.deserializeAttachment()??[]) as Subscription[];
  if(!Array.isArray(subs)){ws.close(1008,'Invalid client state');return;}
  const key=subKey(sub),exists=subs.some(x=>subKey(x)===key);
  if(data.method==='subscribe'&&!exists){
   if(subs.length>=12||this.subscriptions.size>=200){ws.send(JSON.stringify({error:'Subscription capacity reached'}));return;}
   ws.serializeAttachment([...subs,sub]);this.bump(sub,1);
  }else if(data.method==='unsubscribe'&&exists){ws.serializeAttachment(subs.filter(x=>subKey(x)!==key));this.bump(sub,-1);}
  ws.send(JSON.stringify({channel:'subscriptionResponse',data:{method:data.method,subscription:sub}}));
  this.connect();this.schedule();
 }
 webSocketClose(ws:WsClient){this.closeClient(ws);}
 webSocketError(ws:WsClient){this.closeClient(ws);}
 private closeClient(ws:WsClient){const subs=ws.deserializeAttachment();if(Array.isArray(subs))for(const sub of subs){const v=validateSub(sub);if(v)this.bump(v,-1);}try{ws.close();}catch{}}
 async fetch(request:Request):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(path==='/v1/ws'){
   if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')return new Response('Expected WebSocket',{status:426});
   if(this.state.getWebSockets().length>=128)return new Response('Too many clients',{status:429});
   const pair=new WebSocketPair(),client=pair[0],server=pair[1] as WsClient;
   this.state.acceptWebSocket(server);server.serializeAttachment([]);
   this.connect();this.schedule();
   return new Response(null,{status:101,webSocket:client,headers:request.headers.get('sec-websocket-protocol')?.includes('tv-market-v1')?{'Sec-WebSocket-Protocol':'tv-market-v1'}:{}});
  }
  if(path!=='/v1/info'||request.method!=='POST')return new Response('Not found',{status:404});
  const serialized=await request.text();
  if(serialized.length>1024)return new Response('Invalid request',{status:413});
  let body:any;try{body=JSON.parse(serialized);}catch{return new Response('Invalid JSON',{status:400});}
  if(!valid(body))return Response.json({error:'Unsupported public market-data request'},{status:400});
  const key=JSON.stringify(body),now=Date.now(),hit=this.cache.get(key);
  if(hit&&hit.expires>now)return new Response(hit.body,{headers:{'content-type':'application/json','x-tv-market-cache':'HIT'}});
  const pending=this.running.get(key);if(pending)return (await pending).clone();
  if(this.active>=8||this.running.size>=48)return Response.json({error:'Shared provider concurrency limit'},{status:503,headers:{'Retry-After':'2'}});
  this.active++;
  const task=(async():Promise<Response>=>{
   try{
    const limit=await this.reserve(weight(body));
    if(limit)return Response.json({error:limit.reason},{status:429,headers:{'Retry-After':String(limit.retry)}});
    const response=await fetch(upstream,{method:'POST',headers:{'content-type':'application/json'},body:serialized,signal:AbortSignal.timeout(10000)});
    if(!response.ok){
     if(response.status===429||response.status===503){
      const header=response.headers.get('retry-after');
      const retry=header===null?NaN:Number(header);
      const date=header===null?NaN:Date.parse(header);
      const wait=Number.isFinite(retry)&&retry>0?retry*1000:Number.isFinite(date)?date-Date.now():3000;
      await this.blockUpstream(wait);
     }
     return Response.json({error:'Hyperliquid upstream HTTP '+response.status},{status:response.status,headers:response.headers.get('retry-after')?{'Retry-After':response.headers.get('retry-after')!}:{}});
    }
    const text=await response.text();if(text.length>2_500_000)throw Error('Provider payload exceeds limit');
    JSON.parse(text);this.cache.set(key,{body:text,expires:Date.now()+ttl(body)});
    while(this.cache.size>128)this.cache.delete(this.cache.keys().next().value!);
    return new Response(text,{headers:{'content-type':'application/json','x-tv-market-cache':'MISS'}});
   }catch{return Response.json({error:'Market data temporarily unavailable'},{status:502});}
   finally{this.active--;this.running.delete(key);}
  })();
  this.running.set(key,task);
  return (await task).clone();
 }
}

