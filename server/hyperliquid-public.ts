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
  if(!Array.isArray(dexes)||dexes.length<1||dexes.length>300)throw Error('Malformed Hyperliquid perpDexs');
  const max=Math.min(Math.max(1,opts.dexLimit??80),100);
  const registry=new InstrumentRegistry(), errors:string[]=[];
  const dexNames=dexes.slice(0,max).map((v:any,i:number)=>i===0&&v===null?'':typeof v?.name==='string'?v.name:'INVALID');
  // Bounded batches; do not fake the remaining markets if an upstream call fails.
  for(let i=0;i<dexNames.length;i+=3){
   const responses=await Promise.allSettled(dexNames.slice(i,i+3).map(async dex=>{
    if(!/^[A-Za-z0-9_-]{0,24}$/.test(dex)||dex==='INVALID')throw Error('Invalid DEX');
    const data=await this.info({type:'metaAndAssetCtxs',dex});
    if(!Array.isArray(data)||!Array.isArray(data[0]?.universe)||!Array.isArray(data[1]))throw Error('Malformed perpetual contexts');
    const asOf=new Date(this.clock()).toISOString();
    return (data[0].universe as any[]).flatMap((row,j)=>row?.isDelisted?[]:[{...instrumentFromHyperPerp(row,dex,asOf),providerIds:{...instrumentFromHyperPerp(row,dex,asOf).providerIds,index:j}}]);
   }));
   responses.forEach((r,j)=>{if(r.status==='fulfilled'){for(const entry of r.value)registry.add(entry);}
     else errors.push('DEX '+(dexNames[i+j]||'core')+': '+String(r.reason instanceof Error?r.reason.message:r.reason));});
  }
  if(opts.includeSpot!==false){
   try{
    const data=await this.info({type:'spotMetaAndAssetCtxs'});
    if(!Array.isArray(data)||!Array.isArray(data[1]))throw Error('Malformed spot contexts');
    for(const instrument of instrumentsFromHyperSpot(data[0],new Date(this.clock()).toISOString()))registry.add(instrument);
   }catch(error){errors.push('spot: '+(error instanceof Error?error.message:String(error)));}
  }
  return {instruments:registry.all(),errors,truncated:dexes.length>max,source:'Hyperliquid info / perpDexs / metaAndAssetCtxs / spotMetaAndAssetCtxs',
    receivedAt:new Date(this.clock()).toISOString(),cacheScope:marketHubScope()};
 }
 async context(instrument:CanonicalInstrument){
  if(instrument.venue!=='hyperliquid')throw Error('Exact Hyperliquid identity required');
  const spot=instrument.kind==='spot',perp=instrument.kind==='perpetual'||instrument.kind==='hip3-perpetual';
  if(!spot&&!perp)throw Error('Unsupported instrument type');
  const dex=instrument.kind==='hip3-perpetual'?String(instrument.providerIds.dex):'';
  const data=await this.info(spot?{type:'spotMetaAndAssetCtxs'}:{type:'metaAndAssetCtxs',dex});
  if(!Array.isArray(data)||!Array.isArray(data[0]?.universe)||!Array.isArray(data[1]))throw Error('Invalid market context');
  const index=data[0].universe.findIndex((row:any)=>row?.name===instrument.symbol);
  if(index<0)throw Error('Instrument no longer listed on requested venue');
  const c=data[1][index];
  if(!c||typeof c!=='object')throw Error('Market context unavailable');
  return {instrumentId:instrument.id,symbol:instrument.symbol,kind:instrument.kind,source:'Hyperliquid public context',
    observedAt:null,receivedAt:new Date(this.clock()).toISOString(),sourceTimestampAvailable:false,
    mark:finite(c.markPx),oracle:perp?finite(c.oraclePx):null,mid:finite(c.midPx),
    funding:perp?finite(c.funding):null,openInterest:perp?finite(c.openInterest):null,
    volume24hNotional:finite(c.dayNtlVlm),previousDayPrice:finite(c.prevDayPx),
    circulatingSupply:spot?finite(c.circulatingSupply):null,cacheScope:marketHubScope()};
 }
 async book(instrument:CanonicalInstrument){
  if(instrument.venue!=='hyperliquid')throw Error('Exact Hyperliquid identity required');
  return {...await getHyperliquidBook(instrument.symbol,this.request),instrumentId:instrument.id,cacheScope:marketHubScope()};
 }
 async trades(instrument:CanonicalInstrument){
  if(instrument.venue!=='hyperliquid')throw Error('Exact Hyperliquid identity required');
  const trades=await this.info({type:'recentTrades',coin:instrument.symbol});
  if(!Array.isArray(trades)||trades.length>500)throw Error('Invalid trades response');
  const entries=trades.map((t:any)=>{
   if(t?.coin!==instrument.symbol||!Number.isInteger(t.time)||!Number.isFinite(Number(t.px))||Number(t.px)<=0||!Number.isFinite(Number(t.sz))||Number(t.sz)<=0)throw Error('Malformed trade');
   return {time:t.time,price:Number(t.px),size:Number(t.sz),side:t.side==='B'||t.side==='A'?t.side:null,tid:t.tid??null};
  });
  return {instrumentId:instrument.id,source:'Hyperliquid public recentTrades',trades:entries,receivedAt:new Date(this.clock()).toISOString(),cacheScope:marketHubScope()};
 }
 async mids(dex:string=''){
  if(!/^[A-Za-z0-9_-]{0,24}$/.test(dex))throw Error('Invalid DEX');
  const body=dex?{type:'allMids',dex}:{type:'allMids'};
  const raw=await this.info(body);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid mids response');
  const mids:Record<string,number>={};
  for(const [coin,price] of Object.entries(raw)){const p=finite(price);if(p!==null&&p>0)mids[coin]=p;}
  return {dex,mids,source:'Hyperliquid public allMids',sourceTimestampAvailable:false,receivedAt:new Date(this.clock()).toISOString(),cacheScope:marketHubScope()};
 }
}

