import {getHyperliquidBook} from './hyperliquid-book.ts';
import {hyperliquidFetch,marketHubScope} from './market-hub-client.ts';
import {InstrumentRegistry,instrumentFromHyperPerp,instrumentsFromHyperSpot,type CanonicalInstrument} from './instrument-registry.ts';

const url='https://api.hyperliquid.xyz/info';
function finite(v:unknown):number|null{
 if(v===null||v===undefined||v==='')return null;
 const n=Number(v);return Number.isFinite(n)?n:null;
}
function stringValue(v:unknown):string|null{return typeof v==='string'&&v.length>0?v:null;}
export class HyperliquidPublicService{
 private request:typeof fetch;
 private clock:()=>number;
 constructor(fetcher:typeof fetch=fetch,clock:()=>number=Date.now,shared=true){
  this.request=shared?hyperliquidFetch(fetcher):fetcher;this.clock=clock;
 }
 async info(body:Record<string,unknown>):Promise<any>{
  const response=await this.request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(11000)});
  if(!response.ok){const retry=response.headers.get('retry-after');throw Error('Hyperliquid HTTP '+response.status+(retry?' (retry-after '+retry+')':''));}
  return response.json();
 }
 async discover(opts:{dexLimit?:number;includeSpot?:boolean}={}):Promise<{instruments:CanonicalInstrument[];errors:string[];truncated:boolean;source:string;receivedAt:string;cacheScope:string}>{
  const dexes:unknown=await this.info({type:'perpDexs'});
  if(!Array.isArray(dexes)||dexes.length<1|¶»§q«^