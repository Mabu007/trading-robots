import {CodeWatch} from './code-watch-object';
export {CodeWatch};
type Env={WATCHES:DurableObjectNamespace;CODE_WATCH_INTERNAL_SECRET:string;CODE_WATCH_ENABLED:string};
async function authorized(header:string,secret:string){
 if(!secret||secret.length<32||header.length>512)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const [a,b]=await Promise.all([header,'Bearer '+secret].map(x=>crypto.subtle.sign('HMAC',key,new TextEncoder().encode(x))));
 return new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i]);
}
export default {async fetch(req:Request,env:Env){
 if(!(await authorized(req.headers.get('Authorization')||'',env.CODE_WATCH_INTERNAL_SECRET)))return Response.json({error:'Internal access required'},{status:401});
 const path=new URL(req.url).pathname;
 if(path==='/health'&&req.method==='GET')return Response.json({ready:env.CODE_WATCH_ENABLED==='true',runtime:'code-watch',version:1});
 const parts=path.split('/').filter(Boolean);
 if(parts.length!==3||parts[0]!=='watches'||!/^analysis-[a-z0-9_-]{8,110}$/.test(parts[1])||!['start','stop','status'].includes(parts[2]))return Response.json({error:'Unknown monitor route'},{status:404});
 const uid=req.headers.get('X-TV-UID');if(!uid||uid.length>150)return Response.json({error:'Missing owner identity'},{status:403});
 if(req.method!==(parts[2]==='status'?'GET':'POST'))return new Response(null,{status:405});
 if(env.CODE_WATCH_ENABLED!=='true'&&parts[2]==='start')return Response.json({error:'Read-only monitoring service not enabled'},{status:503});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(uid+':'+parts[1]));
 const id=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
 const stub=env.WATCHES.get(env.WATCHES.idFromName(id));
 const body=parts[2]==='start'?await req.text():undefined;
 if(body&&body.length>5000)return new Response(null,{status:413});
 return stub.fetch(new Request('https://watch/'+parts[2],{method:req.method,...(body!==undefined?{body}:{}),headers:{'X-TV-UID':uid}}));
}} satisfies ExportedHandler<Env>;
