import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import type {OpenRouterAccounts} from './openrouter-account.ts';
type Pending={uid:string;state:string;verifier:string;model:string;expires:number};
const cookieName='tv_openrouter_pkce';
function key(){const raw=Buffer.from(process.env.AI_CREDENTIAL_ENCRYPTION_KEY||'','base64');if(raw.length!==32)throw Error('Encryption is not configured');return raw}
export function sealOAuth(value:Pending){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(cookieName));return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64url')}
export function openOAuth(value:string,uid:string,state:string):Pending{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid authorization');const raw=Buffer.from(value,'base64url');if(raw.length<29||raw.toString('base64url')!==value)throw Error('Invalid authorization');const cipher=createDecipheriv('aes-256-gcm',key(),raw.subarray(0,12));cipher.setAAD(Buffer.from(cookieName));cipher.setAuthTag(raw.subarray(-16));const pending=JSON.parse(Buffer.concat([cipher.update(raw.subarray(12,-16)),cipher.final()]).toString()) as Pending;if(pending.uid!==uid||pending.state!==state||pending.expires<=Date.now())throw Error('Invalid authorization');return pending}
export function openRouterOAuthRoutes(app:Express,accounts:OpenRouterAccounts,authenticate:(req:Request,res:Response)=>Promise<string|null>,request:typeof fetch=fetch){
 const options={httpOnly:true,secure:process.env.NODE_ENV!=='test',sameSite:'lax' as const,path:'/api/openrouter',maxAge:600000};
 app.post('/api/openrouter/oauth/start',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');const uid=await authenticate(req,res);if(!uid)return;
  try{
   const origin=new URL(process.env.APP_URL||'');if(origin.protocol!=='https:')throw Error('HTTPS app origin required');
   const model=req.body?.model;if(!(await accounts.models()).some(m=>m.id===model))return res.status(400).json({error:'Choose an available model first.'});
   const pending={uid,model,state:randomBytes(32).toString('base64url'),verifier:randomBytes(48).toString('base64url'),expires:Date.now()+600000};
   const callback=new URL('/?openrouter_callback=1',origin.origin);
   const url=new URL('https://openrouter.ai/auth');url.searchParams.set('callback_url',callback.href);url.searchParams.set('state',pending.state);url.searchParams.set('code_challenge',createHash('sha256').update(pending.verifier).digest('base64url'));url.searchParams.set('code_challenge_method','S256');url.searchParams.set('key_label','Trading Vibes');
   res.cookie(cookieName,sealOAuth(pending),options);return res.json({url:url.href});
  }catch{return res.status(503).json({error:'OpenRouter sign-in is not configured for this environment. Use manual key entry.'})}
 });
 app.post('/api/openrouter/oauth/complete',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');const uid=await authenticate(req,res);if(!uid)return;
  const cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  res.clearCookie(cookieName,options);
  try{
   const {code,state}=req.body||{};if(!cookie||typeof code!=='string'||code.length>2048||typeof state!=='string')throw Error();
   const pending=openOAuth(cookie,uid,state);
   // Provider authorization codes are single-use. Never retry the exchange.
   const response=await request('https://openrouter.ai/api/v1/auth/keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,code_verifier:pending.verifier,code_challenge_method:'S256'}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error();const body=await response.json() as any;
   return res.json(await accounts.connect(uid,body.key,pending.model));
  }catch{return res.status(400).json({error:'OpenRouter authorization expired or failed. Start a new connection.'})}
 });
}
