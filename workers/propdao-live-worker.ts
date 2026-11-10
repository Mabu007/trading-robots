import {PropDAOLiveBot} from './propdao-live-object';
export {PropDAOLiveBot};
type Env={BOTS:DurableObjectNamespace;PROPDAO_LIVE_INTERNAL_SECRET:string;PROPDAO_LIVE_ENABLED:string};
async function authorized(header:string,secret:string){
 if(!secret||secret.length<32||header.length>512)return false;
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const [a,b]=await Promise.all([`Bearer ${secret}`,header].map(s=>crypto.subtle.sign('HMAC',k,new TextEncoder().encode(s))));
 let diff=0;const x=new Uint8Array(a),y=new Uint8Array(b);for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
 return diff===0;
}
export default {async fetch(req:Request,env:Env){
 if(!(await authorized(req.headers.get('Authorization')||'',env.PROPDAO_LIVE_INTERNAL_SECRET)))return Response.json({error:'Internal authorization required'},{status:401});
 if(new URL(req.url).pathname==='/health'&&req.method==='GET')return Response.json({ready:Boolean(env.PROPDAO_LIVE_INTERNAL_SECRET&&env.PROPDAO_LIVE_INTERNAL_SECRET.length>=32&&env.PROPDAO_LIVE_ENABLED==='true'),runtime:'propdao-durable-object',version:2});
 const parts=new URL(req.url).pathname.split('/').filter(Boolean);
 if(parts.length!==3||parts[0]!=='live'||!/^[a-f0-9]{64}$/.test(parts[1])||!['deploy','stop','status','ledger','pause','resume','reconcile'].includes(parts[2]))return Response.json({error:'Unknown live route'},{status:404});
 const uid=req.headers.get('X-TV-UID');if(!uid||uid.length>128)return Response.json({error:'Missing user identity'},{status:403});
 if(req.method!==(parts[2]==='status'||parts[2]==='ledger'?'GET':'POST'))return new Response(null,{status:405});
 const body=req.method==='POST'?await req.text():undefined;
 if(body&&body.length>200000)return new Response(null,{status:413});
 return env.BOTS.get(env.BOTS.idFromName(parts[1])).fetch(new Request(`https://bot/${parts[2]}`,{method:req.method,headers:{'X-TV-UID':uid},...(body===undefined?{}:{body})}));
}} satisfies ExportedHandler<Env>;
