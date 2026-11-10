import { validatePropDAORisk } from '../shared/propdao-risk.ts';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Express, Request, Response as ExpressResponse } from 'express';

type Storage={read:(key:string)=>Promise<string|null>;write:(key:string,value:string)=>Promise<void>;remove:(key:string)=>Promise<void>};
const validKey=(v:unknown):v is string=>typeof v==='string' && /^pd_live_[A-Za-z0-9_-]{1,240}$/.test(v);
const validId=(v:unknown):v is string=>typeof v==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
function secret(v:string|undefined){if(!v||!/^[A-Za-z0-9+/]{43}=$/.test(v))throw Error('PropDAO credential encryption is not configured.');const k=Buffer.from(v,'base64');if(k.length!==32||k.toString('base64')!==v)throw Error('PropDAO credential encryption is not configured.');return k}
function path(uid:string){const env=process.env.VERCEL_ENV==='production'?'production':process.env.VERCEL_ENV==='preview'?'preview':'development';return `propdao-credentials/v1/${env}/${Buffer.from(uid).toString('base64url')}.json`}
/** An error verified to happen before any order HTTP submission. */
export class PropDAONoSubmissionError extends Error { readonly notSubmitted = true; }
export class PropDAOAccounts {
 private storage:Storage; private request:typeof fetch; private key:()=>string|undefined;
 constructor(storage:Storage,request:typeof fetch=fetch,key:()=>string|undefined=()=>process.env.PROPDAO_CREDENTIAL_ENCRYPTION_KEY){this.storage=storage;this.request=request;this.key=key}
 private async get(apiKey:string,endpoint:string):Promise<any>{
  let response:Response;try{response=await this.request(`https://app.propdao.finance/api/v1${endpoint}`,{headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)})}catch{throw Error('Could not reach PropDAO.')}
  if(!response.ok)throw Error(response.status===429?'PropDAO rate limit reached. Retry later.':response.status===401?'PropDAO rejected the API key.':'PropDAO account request failed.');
  try{return await response.json()}catch{throw Error('PropDAO returned invalid account data.')}
 }
 private async load(uid:string):Promise<string|null>{const raw=await this.storage.read(path(uid));if(!raw)return null;try{const v=JSON.parse(raw);if(v.version!==1)throw Error();const d=createDecipheriv('aes-256-gcm',secret(this.key()),Buffer.from(v.iv,'base64'));d.setAAD(Buffer.from(`trading-vibes:propdao:v1:${uid}`));d.setAuthTag(Buffer.from(v.tag,'base64'));const result=Buffer.concat([d.update(Buffer.from(v.ciphertext,'base64')),d.final()]).toString('utf8');if(!validKey(result))throw Error();return result}catch{throw Error('Unable to decrypt PropDAO credentials. Reconnect your account.')}}
 private async accounts(apiKey:string){const body=await this.get(apiKey,'/accounts');if(!Array.isArray(body?.accounts)||body.accounts.length>1000||body.accounts.some((a:any)=>!validId(a?.account_id)||typeof a.status!=='string'))throw Error('PropDAO returned invalid account data.');return body.accounts.map((a:any)=>({accountId:a.account_id,status:a.status,challenge:a.challenge??null}));}
 async connect(uid:string,apiKey:unknown){if(!validKey(apiKey))throw Error('Enter a valid PropDAO API key.');const encryptionKey=secret(this.key()),accounts=await this.accounts(apiKey);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);cipher.setAAD(Buffer.from(`trading-vibes:propdao:v1:${uid}`));const ciphertext=Buffer.concat([cipher.update(apiKey,'utf8'),cipher.final()]);await this.storage.write(path(uid),JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));return {connected:true,simulated:true,accounts};}
 async list(uid:string){const key=await this.load(uid);return key?{connected:true,simulated:true,accounts:await this.accounts(key)}:{connected:false,simulated:true,accounts:[]};}
 async snapshot(uid:string,id:unknown){if(!validId(id))throw Error('Choose a valid PropDAO account.');const key=await this.load(uid);if(!key)throw Error('Connect a PropDAO API key first.');const owned=(await this.accounts(key)).find((a:any)=>a.accountId===id);if(!owned)throw Error('PropDAO account not found.');const encoded=encodeURIComponent(id);const [state,risk,positions,orders]=await Promise.all([this.get(key,`/accounts/${encoded}`),this.get(key,`/accounts/${encoded}/risk`),this.get(key,`/accounts/${encoded}/positions`),this.get(key,`/accounts/${encoded}/orders`)]);if(!state||typeof state!=='object'||!risk||typeof risk.breached!=='boolean'||!['equity','floor','roomUsd'].every(f=>typeof risk[f]==='number'&&Number.isFinite(risk[f]))||!Array.isArray(positions?.data)||!Array.isArray(orders?.data))throw Error('PropDAO returned invalid account data.');return {simulated:true,account:owned,state,risk,positions:positions.data,orders:orders.data,executionEnabled:false};}
 async accountRisk(uid:string,id:string){
  if(!validId(id))throw Error('Invalid PropDAO account');
  const key=await this.load(uid);if(!key)throw Error('Connect your PropDAO key first');
  const account=(await this.accounts(key)).find((a:any)=>a.accountId===id);
  if(!account)throw Error('PropDAO account not found');
  const suffix=`/accounts/${encodeURIComponent(id)}`;
  const [risk,positions,orders]=await Promise.all([this.get(key,suffix+'/risk'),this.get(key,suffix+'/positions'),this.get(key,suffix+'/orders')]);
  if(typeof risk?.equity!=='number'||!Number.isFinite(risk.equity)||!Number.isFinite(risk.roomUsd)||typeof risk.breached!=='boolean'||!Array.isArray(positions?.data)||!Array.isArray(orders?.data))throw Error('PropDAO live account state is invalid');
  return {account,risk,positions:positions.data,orders:orders.data};
 }
 async executeOrder(uid:string,id:string,input:{symbol:string;side:'BUY'|'SELL';price:number;stop:number;target:number;leverage:number;riskUsd:number;intentId:string;quoteTime:number}){
  let submissionStarted=false;
  try{
  if(!validId(id)||!/^[A-Z0-9]{2,40}$/.test(input.symbol)||!['BUY','SELL'].includes(input.side)||!/^[a-zA-Z0-9_-]{10,128}$/.test(input.intentId))throw Error('Invalid live order intent');
  if(!Number.isFinite(input.quoteTime)||Math.abs(Date.now()-input.quoteTime)>25000)throw Error('Market quote is stale');
  const [live,markets]=await Promise.all([this.accountRisk(uid,id),this.getPublicMarkets()]);
  if(live.positions.length||live.orders.length)throw Error('Account has open positions or resting orders. Reconcile before a new entry');
  const market=markets.data.find((m:any)=>m.symbol===input.symbol);
  if(!market||!Number.isFinite(market.lotStep)||!Number.isFinite(market.maxLeverage))throw Error('Unsupported PropDAO trading market');
  const fee=Number(markets.fees?.taker);
  const risk=Math.min(Number(input.riskUsd),live.risk.roomUsd*0.2);
  if(!Number.isFinite(risk)||risk<=0||risk>10)throw Error('Invalid live trade risk budget');
  if(!Number.isFinite(input.price)||!Number.isFinite(input.stop)||!Number.isFinite(input.target)||input.price<=0||input.stop<=0||input.target<=0||!Number.isFinite(input.leverage))throw Error('Invalid live order prices');
  if(input.side==='BUY'?input.target<=input.price:input.target>=input.price)throw Error('Target must be on profitable side');
  if(input.side==='BUY'?input.stop>=input.price:input.stop<=input.price)throw Error('Stop must be on the losing side of the reference price');
  // Bound entry price to 0.10% using a GTC limit. PropDAO rejects limit+IOC.
  // A resting remainder requires reconciliation; never treat submission as a fill.
  // Size from that adverse limit, not the stale candle-close reference quote.
  const maxEntry=Number((input.price*(input.side==='BUY'?1.001:0.999)).toPrecision(12));
  if(input.side==='BUY'?input.target<=maxEntry:input.target>=maxEntry)throw Error('Take profit must remain beyond the worst allowed entry fill');
  const lossPerUnit=Math.abs(maxEntry-input.stop)+(maxEntry+input.stop)*fee;
  const marginPerUnit=maxEntry/input.leverage;
  if(!Number.isFinite(lossPerUnit)||lossPerUnit<=0||!Number.isFinite(marginPerUnit)||marginPerUnit<=0)throw Error('Invalid market size');
  const maxQty=Math.min(risk/lossPerUnit,live.risk.equity/marginPerUnit);
  const qty=Number((Math.floor(maxQty/market.lotStep+1e-9)*market.lotStep).toPrecision(12));
  const verdict=validatePropDAORisk({status:live.account.status,breached:live.risk.breached,roomUsd:live.risk.roomUsd,availableMargin:live.risk.equity,side:input.side,entry:maxEntry,stop:input.stop,quantity:qty,lotStep:market.lotStep,leverage:input.leverage,maxLeverage:market.maxLeverage,takerFeeRate:fee,userRiskLimitUsd:risk});
  if(!verdict.ok)throw Error(verdict.reason);
  const apiKey=await this.load(uid);if(!apiKey)throw Error('Credentials unavailable');
  submissionStarted=true;
  const response=await this.request(`https://app.propdao.finance/api/v1/accounts/${encodeURIComponent(id)}/orders`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({symbol:input.symbol,side:input.side,qty,leverage:input.leverage,orderType:'limit',tif:'gtc',limitPrice:maxEntry,sl:input.stop,tp:input.target,intentId:input.intentId}),signal:AbortSignal.timeout(15000)});
  let body:any;try{body=await response.json()}catch{throw Error('PropDAO order response is ambiguous; reconcile by intentId before retrying')};
  if(!response.ok)throw Error(typeof body?.error==='string'?body.error:'PropDAO rejected live order');
  const base=`https://app.propdao.finance/api/v1/accounts/${encodeURIComponent(id)}`;
  const fetchPositions=async()=>{
   const positions=await this.get(apiKey,`/accounts/${encodeURIComponent(id)}/positions`);
   if(!Array.isArray(positions?.data))throw Error('Unable to reconcile PropDAO order protection');
   return positions.data;
  };
  const protectedPrice=(actual:unknown,expected:number)=>typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-expected)<=Math.max(0.01,Math.abs(expected)*0.000001);
  const isProtected=(position:any)=>protectedPrice(position.slPrice,input.stop)&&protectedPrice(position.tpPrice,input.target);
  // Never cancel another user's/manual order. Require the response ID or intentId.
  const entryOrders=await this.get(apiKey,`/accounts/${encodeURIComponent(id)}/orders`);
  if(!Array.isArray(entryOrders?.data))throw Error('Unable to reconcile PropDAO resting orders');
  const responseOrderId=body?.orderId??body?.order?.id??body?.id;
  let cancelledUnfilled=false;
  if(entryOrders.data.length){
   if(entryOrders.data.length!==1)throw Error('More than one resting order; manual reconciliation required');
   const resting=entryOrders.data[0],restingId=String(resting?.id??'');
   const linked=resting?.intentId===input.intentId||(typeof responseOrderId==='string'&&responseOrderId===restingId);
   const aligned=resting?.symbol===input.symbol&&resting?.side===input.side&&Number(resting?.qty)>0;
   if(!validId(restingId)||!linked||!aligned||!['PENDING','PARTIALLY_FILLED'].includes(resting.status))
    throw Error('Resting order is not linked to the entry intent; manual reconciliation required');
   const cancel=await this.request(`${base}/orders/${encodeURIComponent(restingId)}`,{
    method:'DELETE',headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},signal:AbortSignal.timeout(12000)
   });
   if(!cancel.ok)throw Error('Unable to cancel remaining entry order; manual reconciliation required');
   const checked=await this.get(apiKey,`/accounts/${encodeURIComponent(id)}/orders`);
   if(!Array.isArray(checked?.data)||checked.data.length)throw Error('Entry cancellation not confirmed; manual reconciliation required');
   cancelledUnfilled=true;
  }
  const matching=(await fetchPositions()).filter((p:any)=>p.symbol===input.symbol&&p.side===input.side&&Number(p.qty)>0);
  if(matching.length===0&&cancelledUnfilled)return {intentId:input.intentId,quantity:0,requestedQuantity:qty,plannedLoss:0,protected:false,filled:false,providerStatus:'CANCELLED_UNFILLED'};
  if(matching.length!==1)throw Error('Live entry needs reconciliation; no further entries permitted while positions are unresolved');
  let position=matching[0];
  if(!isProtected(position)){
   if(!validId(String(position.id||'')))throw Error('Protective position identity unavailable');
   const patched=await this.request(`${base}/positions/${encodeURIComponent(position.id)}`,{method:'PATCH',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({sl:input.stop,tp:input.target}),signal:AbortSignal.timeout(12000)});
   if(!patched.ok)throw Error('Protective orders unconfirmed. Inspect and close this position on PropDAO');
   const revised=(await fetchPositions()).find((p:any)=>p.id===position.id);
   if(!revised||!isProtected(revised))throw Error('Protective orders did not reconcile. Inspect your position immediately');
   position=revised;
  }
  const remaining=await this.get(apiKey,`/accounts/${encodeURIComponent(id)}/orders`);
  if(!Array.isArray(remaining?.data)||remaining.data.length)throw Error('Resting order or partial fill requires reconciliation. Protected positions remain; no further entries permitted.');
  const filledQuantity=Number(position.qty);
  if(!Number.isFinite(filledQuantity)||filledQuantity<=0||filledQuantity>qty+market.lotStep/2)throw Error('Unexpected filled quantity; account reconciliation required');
  return {intentId:input.intentId,quantity:filledQuantity,requestedQuantity:qty,plannedLoss:verdict.plannedLoss,protected:true,filled:true,positionId:position.id,providerStatus:'PROTECTED_FILL',provider:body};
  }catch(error){
   if(!submissionStarted)throw new PropDAONoSubmissionError(error instanceof Error?error.message:'Order preflight failed before submission');
   throw error;
  }
 }
 async getPublicMarkets(){
  let response:Response;try{response=await this.request('https://app.propdao.finance/api/v1/markets',{signal:AbortSignal.timeout(10000)})}catch{throw Error('Could not load PropDAO market metadata')};
  if(!response.ok)throw Error('PropDAO markets unavailable');
  const body=await response.json() as any;
  if(!Array.isArray(body?.data)||!Number.isFinite(body?.fees?.taker))throw Error('Invalid PropDAO market metadata');
  return body;
 }
 async recentTrades(uid:string,id:string){
  if(!validId(id))throw Error('Invalid PropDAO account');
  const apiKey=await this.load(uid);if(!apiKey)throw Error('Connect your PropDAO key first');
  const body=await this.get(apiKey,`/accounts/${encodeURIComponent(id)}/trades?limit=50`);
  if(!Array.isArray(body?.data))throw Error('Invalid PropDAO trade history');
  const number=(value:unknown)=>value===undefined||value===null||value===''?null:Number(value);
  const trades=body.data.slice(0,50).map((t:any)=>({
   id:String(t.id||''),symbol:String(t.symbol||''),side:t.side,qty:number(t.qty),entry:number(t.entry),
   exit:number(t.exit),pnl:number(t.pnl),openedAt:number(t.openedAt),closedAt:number(t.closedAt),
   reason:String(t.reason||''),fee:number(t.fee)
  }));
  if(trades.some((t:any)=>!t.id||!t.symbol||!['BUY','SELL'].includes(t.side)||
   [t.qty,t.entry,t.exit,t.pnl].some(v=>typeof v!=='number'||!Number.isFinite(v))||
   [t.openedAt,t.closedAt,t.fee].some(v=>v!==null&&!Number.isFinite(v))))throw Error('Invalid PropDAO trade history');
  return trades;
 }
 /**
  * Read-only two-stage operator reconciliation. Never retries the ambiguous order.
  * PropDAO's current API does not expose a definitive lookup of all historical
  * intents, so require explicit user confirmation, elapsed settlement time,
  * the entire account history, and two independently fetched flat snapshots.
  */
 async verifyFlatReconciliation(uid:string,id:string,pending:{intentId:string;createdAt:number;symbol:string;side:string}){
  if(!validId(id)||typeof pending?.intentId!=='string'||!/^[a-zA-Z0-9_-]{10,128}$/.test(pending.intentId)||
     !Number.isFinite(pending.createdAt)||!Number.isInteger(pending.createdAt)||pending.createdAt>Date.now()-120_000||
     pending.createdAt<Date.now()-30*86_400_000||!['BUY','SELL'].includes(pending.side)||
     typeof pending.symbol!=='string'||!/^[A-Z0-9]{2,40}$/.test(pending.symbol))
   throw Error('The pending order is too recent or its identity cannot be verified. No authorization was cleared.');
  const apiKey=await this.load(uid);if(!apiKey)throw Error('Connect your PropDAO key first');
  const accountPath=`/accounts/${encodeURIComponent(id)}`;
  const flat=async()=>{
   const [live,details]=await Promise.all([this.accountRisk(uid,id),this.get(apiKey,accountPath)]);
   if(!['active','funded'].includes(live.account.status)||live.risk.breached)
    throw Error('The PropDAO account cannot resume trading; review its account status.');
   if(!Array.isArray(details?.openPositions)||!Array.isArray(details?.pendingOrders)||
      !Array.isArray(details?.twapOrders)||!Array.isArray(details?.tradeHistory))
    throw Error('PropDAO did not provide complete order, position and trade history; reconciliation remains locked.');
   if(live.positions.length||live.orders.length||details.openPositions.length||
      details.pendingOrders.length||details.twapOrders.length)
    throw Error('PropDAO still reports an order or open position; inspect/cancel it on PropDAO before reconciliation.');
   return details.tradeHistory as any[];
  };
  const first=await flat();
  await new Promise(resolve=>setTimeout(resolve,800));
  const second=await flat();
  const activeHistory=second.filter(t=>t?.symbol===pending.symbol&&t?.side===pending.side&&
    Number(t?.openedAt)>=pending.createdAt-60_000);
  return {verified:true,accountId:id,intentId:pending.intentId,snapshots:2,checkedAt:Date.now(),
   closedTradesSinceIntent:activeHistory.length,historyEntries:second.length,
   previousHistoryEntries:first.length,openPositions:0,restingOrders:0,twapOrders:0,
   verification:'OPERATOR_CONFIRMED_ACCOUNT_FLAT'};
 }
 async disconnect(uid:string){await this.storage.remove(path(uid));return {connected:false};}
}
export function propDAORoutes(app:Express,accounts:PropDAOAccounts,uid:(req:Request,res:ExpressResponse)=>Promise<string|null>,beforeChange?:(uid:string)=>Promise<void>){
 const handle=(fn:(id:string,req:Request)=>Promise<unknown>)=>async(req:Request,res:ExpressResponse)=>{res.setHeader('Cache-Control','no-store');const id=await uid(req,res);if(!id)return;try{return res.json(await fn(id,req))}catch(e){const message=e instanceof Error?e.message:'';const allowed=/^(PropDAO credential encryption is not configured\.|Could not reach PropDAO\.|PropDAO rate limit reached\. Retry later\.|PropDAO rejected the API key\.|PropDAO account request failed\.|PropDAO returned invalid account data\.|Unable to decrypt PropDAO credentials\. Reconnect your account\.|Enter a valid PropDAO API key\.|Choose a valid PropDAO account\.|Connect a PropDAO API key first\.|PropDAO account not found\.)$/;return res.status(400).json({error:allowed.test(message)?message:'PropDAO account request failed.'})}};
 app.post('/api/venues/propdao/connect',handle(async(id,req)=>{if(beforeChange)await beforeChange(id);return accounts.connect(id,req.body?.apiKey)}));
 app.get('/api/venues/propdao/accounts',handle(id=>accounts.list(id)));
 app.get('/api/venues/propdao/accounts/:accountId',handle((id,req)=>accounts.snapshot(id,req.params.accountId)));
 app.get('/api/venues/propdao/accounts/:accountId/activity',handle(async(id,req)=>{
  const accountId=String(req.params.accountId);
  const snapshot=await accounts.accountRisk(id,accountId);
  let trades:Awaited<ReturnType<PropDAOAccounts['recentTrades']>>|null=null;
  let tradeHistoryError:string|null=null;
  try{trades=await accounts.recentTrades(id,accountId)}
  catch(error){tradeHistoryError=error instanceof Error?error.message:'Broker history unavailable'}
  const pick=(item:any,fields:string[])=>Object.fromEntries(fields.filter(field=>['string','number','boolean'].includes(typeof item?.[field])||item?.[field]===null).map(field=>[field,item[field]]));
  return {account:snapshot.account,risk:pick(snapshot.risk,['equity','balance','roomUsd','breached']),positions:snapshot.positions.slice(0,100).map((item:any)=>pick(item,['id','symbol','side','qty','entry','mark','unrealizedPnl','slPrice','tpPrice','openedAt'])),orders:snapshot.orders.slice(0,100).map((item:any)=>pick(item,['id','orderId','symbol','side','qty','quantity','price','limitPrice','status','type','orderType','createdAt'])),trades,historyAvailable:trades!==null,tradeHistoryError,historyLimit:50,checkedAt:new Date().toISOString()};
 }));
 app.post('/api/venues/propdao/disconnect',handle(async id=>{if(beforeChange)await beforeChange(id);return accounts.disconnect(id)}));
}
