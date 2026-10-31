import { ValrPaper } from './valr-paper-object';
export { ValrPaper };

interface Env { PAPER:DurableObjectNamespace; VALR_PAPER_INTERNAL_SECRET:string; STRATEGY_ISOLATION_VERIFIED:string }
const json=(body:unknown,status=200)=>Response.json(body,{status});
async function authorized(header:string|null,secret:string){
 if(!secret||secret.length<32||!header||header.length>1024||!header.startsWith('Bearer '))return false;
 const enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const [expected,actual]=await Promise.all([crypto.subtle.sign('HMAC',key,enc.encode(secret)),crypto.subtle.sign('HMAC',key,enc.encode(header.slice(7)))]);
 const a=new Uint8Array(expected),b=new Uint8Array(actual);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export default {
 async fetch(request:Request,env:Env){
  if(!await authorized(request.headers.get('Authorization'),env.VALR_PAPER_INTERNAL_SECRET))return json({error:'Internal authorization required'},401);
  const parts=new URL(request.url).pathname.split('/').filter(Boolean),id=parts[1],action=parts[2];
  if(parts.length!==3||parts[0]!=='paper'||!/^[a-f0-9]{64}$/.test(id||'')||!['deploy','start','stop','status','reset'].includes(action))return json({error:'Unknown paper route'},404);
  if((action==='status'&&request.method!=='GET')||(action!=='status'&&request.method!=='POST'))return json({error:'Invalid method'},405);
  if(action==='deploy'&&env.STRATEGY_ISOLATION_VERIFIED!=='true')return json({error:'Paper deployment awaits strategy isolation verification.'},503);
  const body=request.method==='POST'?await request.text():undefined;if(body&&body.length>200_000)return json({error:'Paper request is too large'},413);
  return env.PAPER.get(env.PAPER.idFromName(id)).fetch(new Request(`https://paper/${action}`,{method:request.method,...(body!==undefined?{body}:{})}));
 }
} satisfies ExportedHandler<Env>;
