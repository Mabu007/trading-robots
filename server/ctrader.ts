import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import type {Express,Request,Response} from 'express';
type R2={read:(path:string)=>Promise<string|null>;write:(path:string,data:string)=>Promise<void>;remove:(path:string)=>Promise<void>};
type Account={ctidTraderAccountId:string;isLive:boolean;brokerTitleShort?:string;traderLogin?:string};
type Stored={accessToken:string;refreshToken:string;expiresAt:number;scope:'accounts'|'trading';accounts:Account[]};
const SHA=(s:string)=>createHash('sha256').update(s).digest('hex');
const TIMEFRAMES:Record<string,{period:number;seconds:number}>={m1:{period:1,seconds:60},m5:{period:5,seconds:300},m15:{period:7,seconds:900},m30:{period:8,seconds:1800},h1:{period:9,seconds:3600},h4:{period:10,seconds:14400},d1:{period:12,seconds:86400}};
const ACCOUNT=/^[0-9]{1,24}$/;
const SYMBOL=/^[A-Za-z0-9._/-]{1,64}$/;
const dayMs=86400000;
function stage(){return process.env.VERCEL_ENV||'development'}
function root(uid:string){return 'ctrader-credentials/v1/'+stage()+'/'+Buffer.from(uid).toString('base64url')+'.json'}
function key(){const value=process.env.CTRADER_CREDENTIAL_ENCRYPTION_KEY||'';const key=Buffer.from(value,'base64');if(key.length!==32||key.toString('base64')!==value)throw Error('CTRADER_CREDENTIAL_ENCRYPTION_KEY must contain 32 base64-encoded random bytes');return key}
function encrypt(uid:string,stored:Stored){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from('trading-vibes:ctrader:v1:'+uid));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(stored),'utf8'),cipher.final()]);return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')})}
function decrypt(uid:string,data:string):Stored{try{const c=JSON.parse(data);if(c.v!==1)throw Error('version');const cipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(c.iv,'base64'));cipher.setAAD(Buffer.from('trading-vibes:ctrader:v1:'+uid));cipher.setAuthTag(Buffer.from(c.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(c.data,'base64')),cipher.final()]).toString('utf8'))}catch{throw Error('Cannot decrypt cTrader account; reconnect your broker')}}
export function normalizeCTraderTrendbars(rows:any[],digits=5){
 const factor=10**5,precision=10**Math.max(0,Math.min(10,Number(digits)||5)),seen=new Map<number,any>();
 for(const b of rows){
  const time=Number(b.utcTimestampInMinutes)*60,low=Number(b.low);
  const open=(low+Number(b.deltaOpen??0))/factor,high=(low+Number(b.deltaHigh??0))/factor,close=(low+Number(b.deltaClose??0))/factor;
  const candle={time,open:Math.round(open*precision)/precision,high:Math.round(high*precision)/precision,low:Math.round(low/factor*precision)/precision,close:Math.round(close*precision)/precision,volume:Number(b.volume??0)};
  if(!Number.isSafeInteger(time)||time<=0||Object.values(candle).some(n=>!Number.isFinite(n))||candle.low<=0||candle.high<Math.max(candle.open,candle.close)||candle.low>Math.min(candle.open,candle.close))throw Error('Broker supplied malformed trendbars');
  if(seen.has(time)){if(JSON.stringify(seen.get(time))!==JSON.stringify(candle))throw Error('Conflicting broker candles at same timestamp');continue}
  seen.set(time,candle);
 }
 return [...seen.values()].sort((a,b)=>a.time-b.time);
}
export class CTraderService{
 constructor(private store:R2,private request:typeof fetch=fetch){}
 private async load(uid:string){const raw=await this.store.read(root(uid));return raw?decrypt(uid,raw):null}
 private async save(uid:string,record:Stored){await this.store.write(root(uid),encrypt(uid,record))}
 private async token(uid:string){
  let record=await this.load(uid);if(!record)throw Error('Connect a cTrader account first');
  if(record.expiresAt-Date.now()>48*3600_000)return record;
  const data=await this.exchange({grant_type:'refresh_token',refresh_token:record.refreshToken});
  record={...record,accessToken:data.accessToken,refreshToken:data.refreshToken,expiresAt:Date.now()+Number(data.expiresIn)*1000};await this.save(uid,record);return record;
 }
 private async exchange(query:Record<string,string>){
  const id=process.env.CTRADER_CLIENT_ID,secret=process.env.CTRADER_SECRET_KEY;
  if(!id||!secret)throw Error('cTrader application credentials are not configured');
  const url=new URL('https://openapi.ctrader.com/apps/token');
  for(const [k,v] of Object.entries({...query,client_id:id,client_secret:secret}))url.searchParams.set(k,v);
  const response=await this.request(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  const data=await response.json() as any;
  if(!response.ok||data.errorCode||!data.accessToken||!data.refreshToken||!Number.isFinite(Number(data.expiresIn)))throw Error('cTrader token exchange failed; reconnect the broker');
  return data;
 }
 private async rpc(record:Stored,environment:'demo'|'live',payloadType:number,payload:Record<string,any>,accountId?:string){
  if(!process.env.CTRADER_GATEWAY_URL||!process.env.CTRADER_GATEWAY_SECRET||process.env.CTRADER_GATEWAY_SECRET.length<32)throw Error('cTrader history gateway is not configured');
  const response=await this.request(new URL('/rpc',process.env.CTRADER_GATEWAY_URL),{method:'POST',headers:{Authorization:'Bearer '+process.env.CTRADER_GATEWAY_SECRET,'Content-Type':'application/json'},body:JSON.stringify({environment,payloadType,payload,accountId,accessToken:record.accessToken}),signal:AbortSignal.timeout(28000)});
  const data=await response.json() as any;
  if(!response.ok)throw Error(typeof data.error==='string'?data.error:'cTrader gateway unavailable');
  if(!data.payload||typeof data.payload!=='object')throw Error('Malformed cTrader gateway response');
  return data.payload;
 }
 async oauthStart(uid:string,scope:'accounts'|'trading'){
  const redirect=process.env.CTRADER_REDIRECT_URI,id=process.env.CTRADER_CLIENT_ID;
  if(!id||!redirect||!redirect.startsWith('https://'))throw Error('cTrader OAuth redirect not configured');
  const nonce=randomBytes(24).toString('base64url');
  await this.store.write('ctrader-oauth/v1/'+SHA(nonce),JSON.stringify({uid,scope,expiresAt:Date.now()+10*60000}));
  const url=new URL('https://id.ctrader.com/my/settings/openapi/grantingaccess/');
  url.searchParams.set('client_id',id);url.searchParams.set('redirect_uri',redirect);url.searchParams.set('scope',scope);url.searchParams.set('product','web');
  return {url:url.toString(),nonce};
 }
 async oauthCallback(nonce:string,code:string){
  const path='ctrader-oauth/v1/'+SHA(nonce),raw=await this.store.read(path);
  if(!raw)throw Error('OAuth session expired; start broker connection again');
  await this.store.remove(path);
  const session=JSON.parse(raw);
  if(!session.uid||session.expiresAt<Date.now()||!['accounts','trading'].includes(session.scope))throw Error('Expired OAuth session');
  const data=await this.exchange({grant_type:'authorization_code',code,redirect_uri:process.env.CTRADER_REDIRECT_URI||''});
  const provisional:Stored={accessToken:data.accessToken,refreshToken:data.refreshToken,expiresAt:Date.now()+Number(data.expiresIn)*1000,scope:session.scope,accounts:[]};
  const accounts=await this.rpc(provisional,'demo',2149,{accessToken:data.accessToken});
  if(!Array.isArray(accounts.ctidTraderAccount))throw Error('cTrader did not return authorized accounts');
  provisional.accounts=accounts.ctidTraderAccount.map((a:any)=>({ctidTraderAccountId:String(a.ctidTraderAccountId),isLive:a.isLive===true,brokerTitleShort:String(a.brokerTitleShort||'').slice(0,100),traderLogin:String(a.traderLogin||'')})).filter((a:Account)=>ACCOUNT.test(a.ctidTraderAccountId));
  if(!provisional.accounts.length)throw Error('No cTrader accounts were authorized');
  await this.save(session.uid,provisional);
 }
 async list(uid:string){const s=await this.load(uid);return {connected:Boolean(s),accounts:s?.accounts||[],scope:s?.scope||null,gatewayConfigured:Boolean(process.env.CTRADER_GATEWAY_URL&&process.env.CTRADER_GATEWAY_SECRET)}}
 private async owned(uid:string,accountId:unknown){
  if(!ACCOUNT.test(String(accountId)))throw Error('Select a valid cTrader account');
  const s=await this.token(uid),a=s.accounts.find(x=>x.ctidTraderAccountId===String(accountId));
  if(!a)throw Error('This cTrader account was not authorized');
  return {s,a,environment:a.isLive?'live' as const:'demo' as const};
 }
 async markets(uid:string,accountId:unknown){
  const {s,a,environment}=await this.owned(uid,accountId);
  const data=await this.rpc(s,environment,2114,{ctidTraderAccountId:a.ctidTraderAccountId,includeArchivedSymbols:false},a.ctidTraderAccountId);
  if(!Array.isArray(data.symbol))throw Error('Broker symbol discovery returned invalid data');
  return {markets:data.symbol.filter((x:any)=>x.enabled!==false&&SYMBOL.test(String(x.symbolName||''))).map((x:any)=>({symbol:String(x.symbolName),symbolId:String(x.symbolId),timeframes:Object.keys(TIMEFRAMES)})),accountId:a.ctidTraderAccountId,broker:a.brokerTitleShort,environment};
 }
 private async symbol(uid:string,accountId:unknown,name:unknown){
  if(typeof name!=='string'||!SYMBOL.test(name))throw Error('Select a valid broker market');
  const scope=await this.owned(uid,accountId),market=await this.markets(uid,accountId),found=market.markets.find((x:{symbol:string;symbolId:string})=>x.symbol===name);
  if(!found)throw Error('Market is not available on your broker account');
  const full=await this.rpc(scope.s,scope.environment,2116,{ctidTraderAccountId:scope.a.ctidTraderAccountId,symbolId:[found.symbolId]},scope.a.ctidTraderAccountId);
  const meta=Array.isArray(full.symbol)?full.symbol.find((x:any)=>String(x.symbolId)===found.symbolId):null;
  if(!meta)throw Error('Broker symbol specifications are unavailable');
  return {...scope,found,meta};
 }
 private archivePrefix(environment:string,accountId:string,symbolId:string,tf:string){
  return ['ctrader-history','v1',environment,SHA(accountId).slice(0,24),symbolId,tf].join('/');
 }
 private async trendbars(scope:Awaited<ReturnType<CTraderService['owned']>>,symbolId:string,tf:string,start:number,end:number,depth=0):Promise<any[]>{
  const data=await this.rpc(scope.s,scope.environment,2137,{ctidTraderAccountId:scope.a.ctidTraderAccountId,symbolId,period:TIMEFRAMES[tf].period,fromTimestamp:start,toTimestamp:end-1,count:4000},scope.a.ctidTraderAccountId);
  if(data.trendbar!==undefined&&!Array.isArray(data.trendbar))throw Error('Broker returned an invalid candle page');
  if(data.hasMore===true){
   if(depth>8||end-start<2*TIMEFRAMES[tf].seconds*1000)throw Error('Broker history pagination cannot be resolved');
   const split=Math.floor(((start+end)/2)/(TIMEFRAMES[tf].seconds*1000))*(TIMEFRAMES[tf].seconds*1000);
   if(split<=start||split>=end)throw Error('Broker history pagination did not advance');
   const left=await this.trendbars(scope,symbolId,tf,start,split,depth+1),right=await this.trendbars(scope,symbolId,tf,split,end,depth+1);
   return [...left,...right];
  }
  return data.trendbar||[];
 }
 async candles(uid:string,input:any){
  const asset=String(input?.asset||''),tf=String(input?.timeframe||''),from=Date.parse(String(input?.from||'')),to=Date.parse(String(input?.to||'')),accountId=input?.accountId;
  if(!TIMEFRAMES[tf])throw Error('Unsupported cTrader timeframe');
  if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to||to>Date.now()+60000||to-from>36*dayMs)throw Error('Choose a valid cTrader date range of up to 36 days');
  const {s,a,environment,found,meta}=await this.symbol(uid,accountId,asset),now=Date.now();
  const periodMs=TIMEFRAMES[tf].seconds*1000;
  const firstDay=Math.floor(from/dayMs),lastDay=Math.floor((to-1)/dayMs),all:any[]=[];
  let cacheDays=0,downloadedDays=0;
  for(let day=firstDay;day<=lastDay;day++){
   const start=day*dayMs,end=start+dayMs,cacheable=end<now-periodMs&&start>=now-90*dayMs;
   const name=this.archivePrefix(environment,a.ctidTraderAccountId,found.symbolId,tf)+'/'+new Date(start).toISOString().slice(0,10)+'.json';
   let candles:any[]|null=null;
   if(cacheable){const raw=await this.store.read(name);if(raw){try{const data=JSON.parse(raw);if(data.schema===1&&data.accountId===a.ctidTraderAccountId&&data.symbolId===found.symbolId&&data.tf===tf&&Array.isArray(data.candles)){candles=data.candles;cacheDays++}}catch{}}}
   if(!candles){
    const trendbars=await this.trendbars({s,a,environment},found.symbolId,tf,start,Math.min(end,now));
    candles=normalizeCTraderTrendbars(trendbars,Number(meta.digits??5)).filter(c=>c.time*1000>=start&&c.time*1000<Math.min(end,now));
    if(cacheable){await this.store.write(name,JSON.stringify({schema:1,accountId:a.ctidTraderAccountId,symbolId:found.symbolId,tf,candles,source:'cTrader Open API',fetchedAt:now}));}
    downloadedDays++;
   }
   all.push(...candles.filter(c=>c.time*1000>=from&&c.time*1000<to&&c.time*1000+periodMs<=now));
  }
  const candles=[...new Map(all.map(c=>[c.time,c])).values()].sort((x,y)=>x.time-y.time);
  const observedGaps=candles.slice(1).reduce((n,c,i)=>n+(c.time-candles[i].time>TIMEFRAMES[tf].seconds?1:0),0);
  return {asset,accountId:a.ctidTraderAccountId,timeframe:tf,candles,source:`cTrader ${a.brokerTitleShort||environment} · broker-specific R2 M1 archive`,cacheDays,downloadedDays,observedGaps,symbol:{symbolId:found.symbolId,digits:meta.digits,lotSize:meta.lotSize,minVolume:meta.minVolume,maxVolume:meta.maxVolume,stepVolume:meta.stepVolume,commission:meta.commission}};
 }
 async warm(uid:string,input:any){
  const cursor=Number(input?.cursor??0),days=Math.min(3,Math.max(1,Number(input?.days??2)));
  if(!Number.isInteger(cursor)||cursor<0||cursor>=90)throw Error('Invalid warmup cursor');
  const midnight=Math.floor(Date.now()/dayMs)*dayMs;
  const from=new Date(midnight-(Math.min(90,cursor+days))*dayMs).toISOString();
  const to=new Date(midnight-cursor*dayMs).toISOString();
  const result=await this.candles(uid,{...input,from,to,timeframe:'m1'});
  return {cursor:Math.min(90,cursor+days),totalDays:90,done:cursor+days>=90,cacheDays:result.cacheDays,downloadedDays:result.downloadedDays,source:result.source};
 }
 async disconnect(uid:string){await this.store.remove(root(uid))}
}
export function ctraderRoutes(app:Express,store:R2,uid:(req:Request,res:Response)=>Promise<string|null>){
 const service=new CTraderService(store);
 const handle=(fn:(id:string,req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','no-store');const id=await uid(req,res);if(!id)return;
  try{return res.json(await fn(id,req))}catch(e){return res.status(400).json({error:e instanceof Error?e.message:'cTrader request failed'})}
 };
 app.get('/api/venues/ctrader/oauth/start',handle(async(id,req)=>{
  const scope=req.query.scope==='trading'?'trading':'accounts',start=await service.oauthStart(id,scope);
  (req.res as Response).setHeader('Set-Cookie',`tv_ctrader_oauth=${start.nonce}; HttpOnly; Secure; SameSite=Lax; Path=/api/brokers/ctrader/callback; Max-Age=600`);
  return {url:start.url};
 }));
 app.get('/api/brokers/ctrader/callback',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Set-Cookie','tv_ctrader_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/brokers/ctrader/callback; Max-Age=0');
  try{
   const nonce=(req.headers.cookie||'').match(/(?:^|;\\s*)tv_ctrader_oauth=([^;]+)/)?.[1]||'';
   const code=String(req.query.code||'');
   if(!/^[A-Za-z0-9_-]{20,100}$/.test(nonce)||!code||code.length>4096)throw Error('OAuth callback validation failed');
   await service.oauthCallback(nonce,code);
   return res.redirect(303,'/?ctrader=connected');
  }catch{return res.redirect(303,'/?ctrader=failed')}
 });
 app.get('/api/venues/ctrader/accounts',handle(id=>service.list(id)));
 app.get('/api/venues/ctrader/markets',handle((id,req)=>service.markets(id,req.query.accountId)));
 app.post('/api/venues/ctrader/candles',handle((id,req)=>service.candles(id,req.body)));
 app.post('/api/venues/ctrader/cache/warm',handle((id,req)=>service.warm(id,req.body)));
 app.post('/api/venues/ctrader/disconnect',handle(async(id)=>{await service.disconnect(id);return {connected:false}}));
 return service;
}
