import {ValrLiveAccount} from './valr-live-object';
export {ValrLiveAccount};
interface Env{ACCOUNTS:DurableObjectNamespace;VALR_LIVE_INTERNAL_SECRET:string}
export default {async fetch(req:Request,env:Env){
 const secret=env.VALR_LIVE_INTERNAL_SECRET,header=req.headers.get('Authorization')||'';
 if(!secret||secret.length<32||header.length>1024)return Response.json({error:'Internal authorization required'},{status:401});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const digest=(s:string)=>crypto.subtle.sign('HMAC',key,new TextEncoder().encode(s));const [a,b]=await Promise.all([digest(`Bearer ${secret}`),digest(header)]);let diff=0;const aa=new Uint8Array(a),bb=new Uint8Array(b);for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];if(diff)return Response.json({error:'Internal authorization required'},{status:401});
 const parts=new URL(req.url).pathname.split('/').filter(Boolean),id=parts[1],action=parts[2],uid=req.headers.get('X-TV-UID');
 if(parts.length!==3||parts[0]!=='live'||!/^[a-f0-9]{64}$/.test(id||'')||!['deploy','stop','status','reconcile'].includes(action)||!uid||uid.length>128)return Response.json({error:'Unknown live route'},{status:404});
 if((action==='status'&&req.method!=='GET')||(action!=='status'&&req.method!=='POST'))return new Response(null,{status:405});const body=req.method==='POST'?await req.text():undefined;if(body&&body.length>200000)return new Response(null,{status:413});
 if(action==='deploy'){let data;try{data=JSON.parse(body||'')}catch{return new Response(null,{status:400})}if(data.keyId!==id||data.uid!==uid)return Response.json({error:'Live account identity mismatch'},{status:403});}
 return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(id)).fetch(new Request(`https://account/${action}`,{method:req.method,headers:{'X-TV-UID':uid},...(body!==undefined?{body}:{})}));
}} satisfies ExportedHandler<Env>;
