import { valrSignature } from './valr-account.ts';
import { parseValrSnapshot } from './valr-snapshot.ts';

type Credentials={apiKey:string;apiSecret:string};
type OrderStatus={orderId:string;customerOrderId:string;orderStatusType:string;currencyPair:string;remainingQuantity?:string;originalQuantity?:string};
const pairOk=(value:string)=>/^[A-Z0-9]{3,30}$/.test(value);
const idOk=(value:string)=>/^[A-Za-z0-9-]{1,50}$/.test(value);
const positive=(value:string)=>typeof value==='string'&&value.length<=50&&/^\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))&&Number(value)>0;
type CachedPublic={expires:number;value?:unknown;pending?:Promise<unknown>};
const publicCaches=new WeakMap<typeof fetch,Map<string,CachedPublic>>();

// Provider adapter only. No HTTP route exposes this class and it does not
// perform risk validation, grant user consent, or automatically retry orders.
export class ValrExchange {
 private credentials:Credentials;private request:typeof fetch;private clock:()=>number;
 constructor(credentials:Credentials,request:typeof fetch=fetch,clock:()=>number=Date.now){this.credentials=credentials;this.request=request;this.clock=clock}
 private async call(method:'GET'|'POST',path:string,payload?:unknown):Promise<unknown>{
  const timestamp=String(this.clock()),body=payload===undefined?'':JSON.stringify(payload);
  let response:Response;
  try{response=await this.request(`https://api.valr.com${path}`,{method,headers:{'Content-Type':'application/json','X-VALR-API-KEY':this.credentials.apiKey,'X-VALR-TIMESTAMP':timestamp,'X-VALR-SIGNATURE':valrSignature(this.credentials.apiSecret,timestamp,method,path,body)},...(body?{body}:{}),signal:AbortSignal.timeout(12000)})}
  catch{throw Error('VALR request failed; the order outcome may be unknown.')}
  if(!response.ok)throw Error(`VALR request returned HTTP ${response.status}; reconcile order status before retrying.`);
  try{return await response.json()}catch{throw Error('VALR response was invalid; the order outcome may be unknown.')}
 }
 private async publicGet(path:string):Promise<unknown>{
  let cache=publicCaches.get(this.request);if(!cache){cache=new Map();publicCaches.set(this.request,cache)}
  const existing=cache.get(path);if(existing?.pending)return structuredClone(await existing.pending);if(existing&&existing.expires>Date.now())return structuredClone(existing.value);
  const slot:CachedPublic={expires:0};const pending=(async()=>{
   let response:Response;try{response=await this.request(`https://api.valr.com${path}`,{signal:AbortSignal.timeout(12000)})}catch{throw Error('VALR public market request failed.')}
   if(!response.ok)throw Error(`VALR public market request returned HTTP ${response.status}.`);
   let value:unknown;try{value=await response.json()}catch{throw Error('VALR returned invalid public market data.')}
   const control=response.headers.get('cache-control')||'',seconds=Number(control.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1]??30);
   slot.expires=Date.now()+(/no-store|no-cache/i.test(control)?0:Math.min(60,seconds)*1000);slot.value=value;delete slot.pending;return value;
  })();slot.pending=pending;cache.set(path,slot);
  try{return structuredClone(await pending)}catch(e){if(cache.get(path)===slot)cache.delete(path);throw e}
 }
 async snapshot(pair:string,ledger:{utcDay:string;dayStartEquity:string;dailyLoss:string;reconciled:boolean}){
  if(!pairOk(pair))throw Error('Invalid market');
  // Explicitly request zero balances: a missing base balance must not be
  // assumed flat. All account state is fetched using signed read-only calls.
  const [pairs,balances,orders,conditionals,orderTypes,fees,slippage,orderbook]=await Promise.all([
   this.publicGet('/v1/public/pairs'),this.call('GET','/v1/account/balances?excludeZeroBalances=false'),this.call('GET','/v1/orders/open'),this.call('GET','/v1/orders/conditionals'),this.publicGet(`/v1/public/${pair}/ordertypes`),this.call('GET','/v1/account/fees/trade'),this.publicGet('/v1/public/slippage'),this.call('GET',`/v1/marketdata/${pair}/orderbook`),
  ]);
  return parseValrSnapshot({pair,pairs,balances,orders,conditionals,orderTypes,fees,slippage,orderbook,ledger});
 }
 async limitBuy(pair:string,quantity:string,price:string,customerOrderId:string){
  if(!pairOk(pair)||!positive(quantity)||!positive(price)||!idOk(customerOrderId))throw Error('Invalid limit order');
  const result=await this.call('POST','/v1/orders/limit',{side:'BUY',quantity,price,pair,customerOrderId,allowMargin:false,postOnly:false,timeInForce:'FOK'}) as {id?:unknown};
  if(typeof result?.id!=='string'||!result.id)throw Error('VALR did not acknowledge an order ID; reconcile before retrying.');
  return {orderId:result.id}; // Accepted is not proof of a fill.
 }
 async orderStatus(pair:string,customerOrderId:string):Promise<OrderStatus>{
  if(!pairOk(pair)||!idOk(customerOrderId))throw Error('Invalid order lookup');
  const result=await this.call('GET',`/v1/orders/${pair}/customerorderid/${customerOrderId}`) as Partial<OrderStatus>;
  if(typeof result?.orderId!=='string'||result.customerOrderId!==customerOrderId||result.currencyPair!==pair||typeof result.orderStatusType!=='string')throw Error('VALR returned an invalid or mismatched order status.');
  return result as OrderStatus;
 }
 async orderSummary(customerOrderId:string){
  if(!idOk(customerOrderId))throw Error('Invalid order lookup');
  const result=await this.call('GET',`/v1/orders/history/summary/customerorderid/${customerOrderId}`) as Record<string,unknown>;
  if(result?.customerOrderId!==customerOrderId||typeof result.orderStatusType!=='string'||typeof result.totalExecutedQuantity!=='string'||typeof result.totalFee!=='string'||typeof result.feeCurrency!=='string')throw Error('VALR returned an invalid order summary.');
  return result;
 }
 async spotProtection(pair:string,quantity:string,stop:string,target:string,customerOrderId:string){
  if(!pairOk(pair)||!positive(quantity)||!positive(stop)||!positive(target)||!idOk(customerOrderId)||Number(stop)>=Number(target))throw Error('Invalid protective order');
  const body={pair,quantity,side:'SELL',triggerType:'LAST_TRADED',stopLossTriggerPrice:stop,stopLossOrderPrice:'-1',takeProfitTriggerPrice:target,takeProfitOrderPrice:'-1',customerOrderId,allowMargin:false};
  const result=await this.call('POST','/v1/orders/conditionals',body) as {id?:unknown};
  if(typeof result?.id!=='string'||!result.id)throw Error('VALR did not acknowledge a protection ID; reconcile before retrying.');
  return {orderId:result.id}; // The conditional must be verified as active separately.
 }
 async activeProtection(pair:string,customerOrderId:string){
  if(!pairOk(pair)||!idOk(customerOrderId))throw Error('Invalid protection lookup');
  const result=await this.call('GET','/v1/orders/conditionals');if(!Array.isArray(result))throw Error('VALR returned invalid conditional orders.');
  const matches=result.filter(item=>item?.customerOrderId===customerOrderId&&item?.currencyPair===pair);
  if(matches.length>1)throw Error('Multiple conditional orders share the same ID.');
  return matches[0]??null; // Missing does not prove an order was never placed.
 }
 async protectionStatus(pair:string,customerOrderId:string,orderId?:string){
  if(!pairOk(pair)||!idOk(customerOrderId)||(orderId!==undefined&&!idOk(orderId)))throw Error('Invalid protection lookup');
  let resolved=orderId;
  if(!resolved){
   const active=await this.activeProtection(pair,customerOrderId);
   if(active){if(typeof active.orderId!=='string'||!idOk(active.orderId))throw Error('VALR returned an invalid protection ID.');resolved=active.orderId}
   else{
    const history=await this.call('GET',`/v1/orders/conditionals/${pair}/history`);if(!Array.isArray(history))throw Error('VALR returned invalid protection history.');
    const ids=[...new Set(history.filter(item=>item?.customerOrderId===customerOrderId&&item?.currencyPair===pair).map(item=>item?.orderId))];
    if(ids.length>1)throw Error('Multiple conditional orders share the same ID.');
    if(ids.length===0)return null;
    if(typeof ids[0]!=='string'||!idOk(ids[0]))throw Error('VALR returned an invalid protection ID.');resolved=ids[0];
   }
  }
  const result=await this.call('GET',`/v1/orders/conditionals/conditional/${pair}/orderid/${resolved}`) as Record<string,unknown>;
  if(result?.orderId!==resolved||result.customerOrderId!==customerOrderId||result.currencyPair!==pair)throw Error('VALR returned a mismatched protection status.');
  return result;
 }
}
