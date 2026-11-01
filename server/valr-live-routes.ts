import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {ValrAccounts} from './valr-account.ts';
import {ValrExchange} from './valr-exchange.ts';
import {parseStrategyConfig} from '../src/strategy.ts';
import {LIVE_ACKNOWLEDGEMENT,validateLiveGrant,type LiveGrant} from '../shared/valr-live-authorization.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
type Storage={lockReady?:()=>boolean;exclusive?:<T>(uid:string,task:()=>Promise<T>)=>Promise<T>;read:(key:string)=>Promise<string|null>;write:(key:string,body:string)=>Promise<void>;remove:(key:string)=>Promise<void>};
type Dependencies=Storage&{uid:(req:Request,res:Response)=>Promise<string|null>;bot:(uid:string,id:string,req:Request)=>Promise<{asset:string;code:string}|null>;request?:typeof fetch};
export class ValrLiveService{
 private storage:Storage;private request:typeof fetch;readonly accounts:ValrAccounts;
 constructor(storage:Storage,request:typeof fetch=fetch){this.storage=storage;this.request=request;this.accounts=new ValrAccounts(storage,{request});}
 private path(uid:string){const env=process.env.VERCEL_ENV||'development';return `valr-live/v1/${env}/${Buffer.from(uid).toString('base64url')}/authorization.json`;}
 async exclusive<T>(uid:string,task:()=>Promise<T>){return this.storage.exclusive?this.storage.exclusive(uid,task):task()}
 private grantPath(uid:string,id:string){if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid live authorization ID');return this.path(uid).replace('authorization.json',`grants/${id}.json`)}
 async grant(uid:string){const raw=await this.storage.read(this.path(uid));if(!raw)return null;const g=JSON.parse(raw) as LiveGrant;if(g.uid!==uid)throw Error('Live authorization identity mismatch');return g;}
 enabled(){return (this.storage.lockReady?.()??process.env.VERCEL_ENV!=='production')&&process.env.VALR_LIVE_ENABLED==='true'&&process.env.VALR_PROTECTION_LINKAGE_VERIFIED==='true'&&Boolean(process.env.VALR_LIVE_RUNTIME_URL&&process.env.VALR_LIVE_INTERNAL_SECRET&&process.env.VALR_LIVE_INTERNAL_SECRET.length>=32);}
 private allowedKey(id:string){return (process.env.VALR_LIVE_ALLOWED_KEY_IDS||'').split(',').map(s=>s.trim()).includes(id);}
 async invoke(uid:string,keyId:string,action:string,body?:unknown){const base=process.env.VALR_LIVE_RUNTIME_URL,secret=process.env.VALR_LIVE_INTERNAL_SECRET;if(!base||!secret||secret.length<32)throw Error('Live runtime is not configured');const url=new URL(`/live/${keyId}/${action}`,base);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Live runtime requires HTTPS');const r=await this.request(url,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${secret}`,'X-TV-UID':uid,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});let data:any;try{data=await r.json()}catch{throw Error('Live runtime returned an invalid response')};if(!r.ok)throw Error(typeof data.error==='string'?data.error:'Live runtime unavailable');return data;}
 async status(uid:string,botId:string){
 const [g,credentials]=await Promise.all([this.grant(uid),this.accounts.load(uid)]);
 const configured=Boolean(process.env.VALR_LIVE_RUNTIME_URL&&(process.env.VALR_LIVE_INTERNAL_SECRET?.length||0)>=32),keyId=credentials?hash(credentials.apiKey):null;
 const checks=[{id:'locking',label:'Account change protection ready',ok:this.storage.lockReady?.()??process.env.VERCEL_ENV!=='production'},{id:'connection',label:'Connect a VALR API key',ok:Boolean(credentials)},{id:'runtime',label:'Live runtime configured',ok:configured},{id:'operator',label:'Exchange verification completed',ok:this.enabled()},{id:'account',label:'Dedicated VALR connection verified',ok:Boolean(keyId&&this.allowedKey(keyId))}];
 let runtime:any=null,error='';
 if(configured&&(g||keyId))try{runtime=await this.invoke(uid,g?.keyId||keyId!,'status');checks.push({id:'worker',label:'Live Worker verification completed',ok:runtime.readiness?.ready===true})}catch(e){error=e instanceof Error?e.message:'Live runtime unavailable';checks.push({id:'worker',label:'Live Worker reachable',ok:false})}
 const a=runtime?.authorization||(g?{id:g.id,botId:g.botId,pair:g.pair,codeHash:g.codeHash,expiresAt:g.expiresAt,limits:g.limits}:null);
 return {enabled:checks.every(c=>c.ok),checks,accountConnected:Boolean(credentials),deployed:Boolean(a&&a.botId===botId),accountBusy:Boolean(runtime?.state?.active||Object.values(runtime?.state?.bots||{}).some((b:any)=>b.running)),activeBotId:a?.botId||null,...(runtime||{}),...(a?{authorization:a}:{}),...(error?{runtimeError:error}:{})};
 }
 async beforeKeyChange(uid:string){const g=await this.grant(uid);if(!g)return;const status=await this.invoke(uid,g.keyId,'status');if(status.state?.active||Object.values(status.state?.bots||{}).some((b:any)=>b.running))throw Error('Stop and reconcile live trading before changing VALR credentials');if(!status.authorization&&Date.now()<g.issuedAt+60000)throw Error('Live deployment outcome is pending. Wait one minute and reconcile before changing credentials');}
 async deploy(uid:string,botId:string,bot:{asset:string;code:string},input:any){return this.exclusive(uid,async()=>{
 if(!this.enabled())throw Error('Live trading is disabled until the operator completes account verification');if(input?.approveLiveTrading!==true||input.acknowledgement!==LIVE_ACKNOWLEDGEMENT)throw Error('Explicit live trading authorization is required');
 await this.beforeKeyChange(uid);const credentials=await this.accounts.load(uid);if(!credentials)throw Error('Connect VALR before authorizing live trading');await this.accounts.inspect(credentials);const keyId=hash(credentials.apiKey);if(!this.allowedKey(keyId))throw Error('This VALR connection has not completed operator verification');
 const config=parseStrategyConfig(bot.code);const limits={allocation:String(input.allocation),riskBps:Number(input.riskBps),dailyLossBps:Number(input.dailyLossBps),maxSpreadBps:20,slippageBps:20,feeBps:0,maxPriceAgeMs:5000};
 const issuedAt=Date.now();const g:LiveGrant={id:randomBytes(32).toString('hex'),uid,botId,pair:bot.asset,code:bot.code,codeHash:hash(bot.code),keyId,issuedAt,expiresAt:issuedAt+86400000,limits};validateLiveGrant(g,Date.now());if(limits.riskBps>config.riskPercent*100)throw Error('Live risk exceeds strategy risk');
 // Persist before the runtime call: an ambiguous deployment must retain its
 // authorization marker so credentials cannot be disconnected underneath it.
 await this.storage.write(this.grantPath(uid,g.id),JSON.stringify(g));await this.storage.write(this.path(uid),JSON.stringify(g));return this.invoke(uid,keyId,'deploy',g);
 })}
 async action(uid:string,botId:string,action:string){const g=await this.grant(uid);if(!g||g.botId!==botId)throw Error('Live robot is not deployed');if(!['stop','reconcile'].includes(action))throw Error('Invalid live action');return this.invoke(uid,g.keyId,action,{});}
 async provider(uid:string,grantId:string,action:string,o:any){
 if(!/^[a-f0-9]{64}$/.test(grantId))throw Error('Invalid live authorization ID');const raw=await this.storage.read(this.grantPath(uid,grantId));const g=raw?JSON.parse(raw) as LiveGrant:await this.grant(uid);if(!g||g.id!==grantId||g.uid!==uid)throw Error('Live authorization is unavailable');const credentials=await this.accounts.load(uid);if(!credentials||hash(credentials.apiKey)!==g.keyId)throw Error('VALR connection changed; account reconciliation is required');const exchange=new ValrExchange(credentials,this.request);
 if(o?.pair!==g.pair)throw Error('Live market authorization mismatch');
 if(action==='snapshot'){await this.accounts.inspect(credentials);return exchange.snapshot(g.pair);}
 if(o?.botId!==g.botId)throw Error('Live bot authorization mismatch');
 if(action==='entry'){if(!this.enabled()||!this.allowedKey(g.keyId))throw Error('Live entries are disabled');validateLiveGrant(g,Date.now());await this.accounts.inspect(credentials);if(!Number.isSafeInteger(o.expiresAt)||Date.now()>o.expiresAt)throw Error('Live entry deadline expired');return exchange.limitBuy(g.pair,o.quantity,o.limitPrice,o.entryId);}
 if(action==='entrySummary')return exchange.orderSummary(o.entryId);
 if(action==='protection')return exchange.spotProtection(g.pair,o.protectableQuantity,o.stopLoss,o.takeProfit,o.protectionId);
 if(action==='protectionStatus')return exchange.protectionStatus(g.pair,o.protectionId,o.protectionOrderId);
 // If VALR does not carry the exact protective customer ID into a regular
 // exchange summary, this fails closed; it never guesses a child order ID.
 if(action==='exitSummary')return exchange.orderSummary(o.protectionId);
 throw Error('Unknown live provider action');
 }
}
export function valrLiveRoutes(app:Express,deps:Dependencies){const service=new ValrLiveService(deps,deps.request);
 app.post('/api/internal/valr/provider',async(req,res)=>{res.setHeader('Cache-Control','no-store');const secret=process.env.VALR_LIVE_INTERNAL_SECRET,header=req.header('authorization')||'';if(!secret||secret.length<32||header.length>1024||!timingSafeEqual(Buffer.from(hash(header)),Buffer.from(hash(`Bearer ${secret}`))))return res.status(401).json({error:'Internal authorization required'});try{const {uid,grantId,action,payload}=req.body||{};if(typeof uid!=='string'||uid.length>128||!uid||typeof grantId!=='string')throw Error('Invalid live identity');return res.json(await service.provider(uid,grantId,action,payload));}catch(e){return res.status(400).json({error:e instanceof Error?e.message:'Live provider failed'})}});
 const handle=(f:(uid:string,id:string,req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{res.setHeader('Cache-Control','no-store');const uid=await deps.uid(req,res);if(!uid)return;const id=String(req.params.id);if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))return res.status(400).json({error:'Invalid robot ID'});try{return res.json(await f(uid,id,req))}catch(e){return res.status(400).json({error:e instanceof Error?e.message:'Live request failed'})}};
 app.get('/api/valr/bots/:id/live',handle((uid,id)=>service.status(uid,id)));
 app.post('/api/valr/bots/:id/live',handle(async(uid,id,req)=>{if(req.body?.action!=='deploy')return service.action(uid,id,req.body?.action);const bot=await deps.bot(uid,id,req);if(!bot)throw Error('Save your robot before deploying');return service.deploy(uid,id,bot,req.body)}));return service;
}
