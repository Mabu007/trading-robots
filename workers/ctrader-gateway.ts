import {DurableObject} from 'cloudflare:workers';

// Spotware JSON WebSocket: port 5036, NOT the protobuf port 5035.
// One named Durable Object per environment keeps connections shared across users.
type Env={CTRADER_GATEWAY_SECRET:string;CTRADER_CLIENT_ID:string;CTRADER_SECRET_KEY:string;GATEWAYS:DurableObjectNamespace;CTRADER_TRADING_ENABLED?:string};
type Reply={payloadType:number;payload?:Record<string,any>;clientMsgId?:string};
const READ_ONLY=new Set([2149,2114,2116,2121,2124,2133,2137,2139,2145,2112]);
const RESPONSES:Record<number,number>={2149:2150,2114:2115,2116:2117,2121:2122,2124:2125,2133:2134,2137:2138,2139:2140,2145:2146,2112:2113,2175:2176};
const encode=(v:unknown)=>JSON.stringify(v);
function internalAuth(header:string,secret:string){return secret.length>=32&&header.length<500&&header===`Bearer ${secret}`;}
export class CTraderGateway extends DurableObject<Env>{
 private ws:WebSocket|null=null;
 private connecting:Promise<void>|null=null;
 private authenticated=new Set<string>();
 private authenticating=new Map<string,Promise<void>>();
 private waiters=new Map<string,{resolve:(v:Reply)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private heartbeat:ReturnType<typeof setInterval>|null=null;
 private sequence=0;
 private nextHistoryAt=0;
 private environment:'demo'|'live'='demo';
 private failPending(message:string){for(const [id,p] of this.waiters){clearTimeout(p.timer);p.reject(new Error(message));this.waiters.delete(id)}this.authenticated.clear();this.authenticating.clear();}
 private close(message:string){if(this.heartbeat){clearInterval(this.heartbeat);this.heartbeat=null}this.failPending(message);this.ws=null;this.connecting=null;}
 private async connect(environment:'demo'|'live'){
  if(this.ws?.readyState===WebSocket.OPEN)return;
  if(this.connecting)return this.connecting;
  this.environment=environment;
  this.connecting=(async()=>{
   const ws=new WebSocket(`wss://${environment}.ctraderapi.com:5036`);
   await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('cTrader WebSocket connection timed out')),12000);
    ws.addEventListener('open',()=>{clearTimeout(timeout);resolve()},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('cTrader WebSocket connection failed'))},{once:true});
   });
   this.ws=ws;
   ws.addEventListener('message',(event:MessageEvent)=>{
    let reply:Reply;try{reply=JSON.parse(String(event.data))}catch{return}
    if(reply.payloadType===2147||reply.payloadType===2164){const account=String(reply.payload?.ctidTraderAccountId||'');for(const name of [...this.authenticated])if(!account||name.startsWith(account+':'))this.authenticated.delete(name);return}
    const id=String(reply.clientMsgId||'');
    const waiter=this.waiters.get(id);if(!waiter)return;
    clearTimeout(waiter.timer);this.waiters.delete(id);
    if(reply.payloadType===2142||reply.payloadType===50)waiter.reject(Error('cTrader: '+String(reply.payload?.errorCode||reply.payload?.description||'request rejected')));
    else waiter.resolve(reply);
   });
   ws.addEventListener('close',()=>{if(this.ws===ws)this.close('cTrader disconnected. Request state is uncertain; reconcile before submitting orders.')});
   ws.addEventListener('error',()=>{if(this.ws===ws)this.close('cTrader socket error. Request state is uncertain.')});
   this.heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN){try{ws.send(encode({payloadType:51,clientMsgId:'hb-'+Date.now(),payload:{}}))}catch{this.close('Heartbeat send failed')}}},10000);
   await this.send(2100,{clientId:this.env.CTRADER_CLIENT_ID,clientSecret:this.env.CTRADER_SECRET_KEY},2101);
  })();
  try{await this.connecting}catch(e){this.close('cTrader authentication failed');throw e}finally{this.connecting=null}
 }
 private async send(payloadType:number,payload:Record<string,any>,expected:number){
  if(!this.ws||this.ws.readyState!==WebSocket.OPEN)throw Error('cTrader connection is not active');
  const clientMsgId='tv-'+Date.now().toString(36)+'-'+(++this.sequence).toString(36);
  return new Promise<Reply>((resolve,reject)=>{
   const timer=setTimeout(()=>{this.waiters.delete(clientMsgId);reject(Error('cTrader response timeout'))},16000);
   this.waiters.set(clientMsgId,{resolve,reject,timer});
   try{this.ws!.send(encode({clientMsgId,payloadType,payload}))}catch(e){clearTimeout(timer);this.waiters.delete(clientMsgId);reject(Error('cTrader send failed'))}
  }).then(reply=>{if(reply.payloadType!==expected)throw Error('Unexpected cTrader response type '+reply.payloadType);return reply});
 }
 private async account(accountId:string,token:string){
  const fingerprint=accountId+':'+token;
  if(this.authenticated.has(fingerprint))return;
  const existing=this.authenticating.get(fingerprint);if(existing)return existing;
  const promise=this.send(2102,{ctidTraderAccountId:accountId,accessToken:token},2103).then(()=>{this.authenticated.add(fingerprint)});
  this.authenticating.set(fingerprint,promise);
  try{await promise}finally{this.authenticating.delete(fingerprint)}
 }
 async fetch(req:Request){
  if(req.method!=='POST')return Response.json({error:'POST required'},{status:405});
  try{
   const {environment,payloadType,payload,accountId,accessToken}=await req.json<any>();
   if(environment!=='demo'&&environment!=='live')throw Error('Invalid environment');
   if(!READ_ONLY.has(payloadType))throw Error('Trading requests are not enabled on the data gateway');
   if(!accessToken||typeof accessToken!=='string'||accessToken.length>4096)throw Error('Missing account token');
   if(payloadType!==2149&&(!/^[0-9]{1,24}$/.test(String(accountId))||String(payload?.ctidTraderAccountId)!==String(accountId)))throw Error('Account ID mismatch');
   if(this.ws&&this.environment!==environment)throw Error('Incorrect gateway environment');
   await this.connect(environment);
   if(payloadType!==2149)await this.account(String(accountId),accessToken);
   const params=payloadType===2149?{accessToken}:payload;
   if(payloadType===2137||payloadType===2145){const now=Date.now(),delay=Math.max(0,this.nextHistoryAt-now);this.nextHistoryAt=Math.max(now,this.nextHistoryAt)+250;if(delay)await new Promise<void>(resolve=>setTimeout(resolve,delay));}
   const reply=await this.send(payloadType,params,RESPONSES[payloadType]);
   return Response.json({payload:reply.payload||{}},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:e instanceof Error?e.message:'cTrader gateway request failed'},{status:502})}
 }
}
export default {async fetch(req:Request,env:Env){
 if(!internalAuth(req.headers.get('Authorization')||'',env.CTRADER_GATEWAY_SECRET))return new Response('Unauthorized',{status:401});
 if(new URL(req.url).pathname==='/health')return Response.json({ready:Boolean(env.CTRADER_CLIENT_ID&&env.CTRADER_SECRET_KEY),runtime:'ctrader-json-gateway',tradingEnabled:false});
 if(new URL(req.url).pathname!=='/rpc'||req.method!=='POST')return Response.json({error:'Unknown route'},{status:404});
 const input=await req.text();if(input.length>35000)return new Response('Too large',{status:413});
 let requested:any;try{requested=JSON.parse(input)}catch{return new Response('Malformed JSON',{status:400})}
 if(requested.environment!=='demo'&&requested.environment!=='live')return new Response('Invalid environment',{status:400});
 return env.GATEWAYS.get(env.GATEWAYS.idFromName('ctrader-'+requested.environment)).fetch(new Request('https://gateway/request',{method:'POST',body:input,headers:{'Content-Type':'application/json'}}));
}} satisfies ExportedHandler<Env>;
