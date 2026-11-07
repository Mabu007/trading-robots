import {MarketDataHub} from './market-data-hub.ts';
export {MarketDataHub};
import {verifyStreamProtocol} from './market-data-stream-auth.ts';
type Env={MARKET_HUB:DurableObjectNamespace; MARKET_DATA_INTERNAL_SECRET:string};
async function verify(header:string,secret:string){
 if(!secret||secret.length<32||header.length>512)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const [a,b]=await Promise.all([header,'Bearer '+secret].map(v=>crypto.subtle.sign('HMAC',key,new TextEncoder().encode(v))));
 return new Uint8Array(a).every((n,i)=>n===new Uint8Array(b)[i]);
}
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(path==='/health'&&request.method==='GET')return Response.json({service:'trading-vibes-shared-market-data',version:3,ready:Boolean(env.MARKET_DATA_INTERNAL_SECRET?.length>=32),noTrading:true});
 const authorized=await verify(request.headers.get('authorization')||'',env.MARKET_DATA_INTERNAL_SECRET);
 const streamAllowed=path==='/v1/ws'&&await verifyStreamProtocol(request.headers.get('sec-websocket-protocol')||'',env.MARKET_DATA_INTERNAL_SECRET);
 if(!authorized&&!streamAllowed)return Response.json({error:'Internal or signed stream authorization required'},{status:401});
 if(!['/v1/info','/v1/ws'].includes(path))return new Response('Not found',{status:404});
 const stub=env.MARKET_HUB.get(env.MARKET_HUB.idFromName(¶»§q«^