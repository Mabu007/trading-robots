/* Immutable exact-market OHLC shards. No synthetic candles and no cross-venue conversion. */
import {createHash} from 'node:crypto';
import {intervalMs,isTimeframe,isValidCandle,type MarketTimeframe,type MarketCandle} from './market-data.ts';
import {listR2Objects,readR2Object,writeR2ObjectIfAbsent} from './r2.ts';
import type {CanonicalInstrument} from './instrument-registry.ts';
import {VenueMarketData} from './venue-market-data.ts';
type Store={list:(prefix:string,maxKeys:number)=>Promise<string[]>;read:(key:string)=>Promise<string|null>;writeIfAbsent:(key:string,data:string)=>Promise<boolean>};
type Provider={hyperliquidCandles:(input:{asset:string;timeframe:MarketTimeframe;from:string;to:string})=>Promise<{candles:MarketCandle[];source:string}>};
type Shard={version:3;instrumentId:string;timeframe:MarketTimeframe;source:string;sourceVenue:'hyperliquid';ingestedAt:string;from:number;to:number;kind:'exact';candles:MarketCandle[]};
type HistoryInput={instrument:CanonicalInstrument;timeframe:MarketTimeframe;from:string;to:string;fetchMissing?:boolean};
const day=86_400_000;
const storage:Store={list:listR2Objects,read:readR2Object,writeIfAbsent:writeR2ObjectIfAbsent};
function datePart(ms:number){return new Date(ms).toISOString().slice(0,10);}
function safePath(instrument:CanonicalInstrument,tf:string,d:number){
 return 'market-history/v3/'+instrument.venue+'/'+instrument.kind+'/'+encodeURIComponent(instrument.symbol)+'/'+tf+'/'+datePart(d)+'/';
}
function validStored(v:any,i:CanonicalInstrument,tf:MarketTimeframe):v is Shard{
 return v?.version===3&&v?.instrumentId===i.id&&v?.timeframe===tf&&v.sourceVenue==='hyperliquid'&&v.kind==='exact'
 &&typeof v.source==='string'&&Array.isArray(v.candles)
 &&Number.isSafeInteger(v.from)&&Number.isSafeInteger(v.to)&&v.from<v.to
 &&v.candles.every((c:any)=>isValidCandle(c)&&c.time*1000>=v.from&&c.time*1000<v.to
 &&(c.time*1000)%intervalMs[tf]===0);
}
function checkAndAdd(map:Map<number,MarketCandle>,c:MarketCandle){
 if(!isValidCandle(c))throw Error('Invalid OHLC candle encountered');
 const prior=map.get(c.time);
 if(prior&&JSON.stringify(prior)!==JSON.stringify(c))throw Error('Conflicting candles for identical exact instrument and timestamp');
 map.set(c.time,c);
}
export class R2MarketHistory{
 private store:Store;private provider:Provider;private now:()=>number;
 constructor(store:Store=storage,provider:Provider=new VenueMarketData(),now:()=>number=Date.now){
  this.store=store;this.provider=provider;this.now=now;
 }
 async get(input:HistoryInput){
  const i=input.instrument,tf=input.timeframe;
  if(i.venue!=='hyperliquid'||!['perpetual','hip3-perpetual','spot'].includes(i.kind))throw Error('Exact Hyperliquid identity required for ingestion; proxy forbidden');
  if(!isTimeframe(tf))throw Error('Unsupported history interval');
  const from=Date.parse(input.from),to=Date.parse(input.to),ms=intervalMs[tf],completed=Math.floor(this.now()/ms)*ms;
  if(!Number.isFinite(from)||!Number.isFinite(to)||from%ms||to%ms||from<0||to<=from||to>completed||to-from>7*day||(to-from)/ms>10000)throw Error('Choose an aligned past interval of at most 7 days and 10,000 completed candles');
  const merged=new Map<number,MarketCandle>();
  let shards=0;
  for(let d=Math.floor(from/day)*day;d<to;d+=day){
   const prefix=safePath(i,tf,d),keys=await this.store.list(prefix,257);
   if(keys.length>256)throw Error('History shard limit exceeded; review R2 partition');
   for(const key of keys){
    if(!key.startsWith(prefix)||!key.endsWith('.json'))continue;
    const raw=await this.store.read(key);if(raw===null)continue;
    let obj:unknown;try{obj=JSON.parse(raw);}catch{throw Error('Corrupt archived JSON shard');}
    if(!validStored(obj,i,tf))throw Error('Archive provenance, interval or candle integrity failure');
    shards++;
    for(const c of obj.candles)if(c.time*1000>=from&&c.time*1000<to)checkAndAdd(merged,c);
   }
  }
  let fetched=0,ingested=0;
  const missingRanges=()=>{
   const ranges:{start:number;end:number}[]=[];let start=-1;
   for(let t=from;t<to;t+=ms){
    if(!merged.has(t/1000)){if(start<0)start=t;}
    else if(start>=0){ranges.push({start,end:t});start=-1;}
   }
   if(start>=0)ranges.push({start,end:to});
   return ranges;
  };
  if(input.fetchMissing){
   for(const range of missingRanges()){
    // One provider batch must not exceed the documented most-recent 5,000 OHLC API items.
    for(let start=range.start;start<range.end;start+=ms*2500){
     const end=Math.min(range.end,start+ms*2500);
     const result=await this.provider.hyperliquidCandles({asset:i.symbol,timeframe:tf,from:new Date(start).toISOString(),to:new Date(end).toISOString()});
     if(result.source!=='Hyperliquid')throw Error('Unknown or proxy OHLC source; ingestion refused');
     const byDay=new Map<number,MarketCandle[]>();
     for(const c of result.candles){
      if(!isValidCandle(c))throw Error('Invalid OHLC from provider');
      if((c.time*1000)%ms||c.time*1000<start||c.time*1000>=end)throw Error('Provider returned incompatible candle');
      checkAndAdd(merged,c);fetched++;
      const d=Math.floor(c.time*1000/day)*day;
      byDay.set(d,[...(byDay.get(d)??[]),c]);
     }
     // Immutable append-only shards prevent concurrent overwrites of existing history.
     for(const [d,candles] of byDay){
      const part:Shard={version:3,instrumentId:i.id,timeframe:tf,source:'Hyperliquid public candleSnapshot',
       sourceVenue:'hyperliquid',ingestedAt:new Date(this.now()).toISOString(),from:start,to:end,kind:'exact',candles};
      const digest=createHash('sha256').update(JSON.stringify(candles)).digest('hex');
      const key=safePath(i,tf,d)+start+'-'+end+'-'+digest+'.json';
      const created=await this.store.writeIfAbsent(key,JSON.stringify(part));
      if(created)ingested++;
     }
    }
   }
  }
  const candles=[...merged.values()].sort((a,b)=>a.time-b.time);
  const gaps=missingRanges();
  return {instrumentId:i.id,venue:i.venue,kind:i.kind,symbol:i.symbol,timeframe:tf,
   from:new Date(from).toISOString(),to:new Date(to).toISOString(),source:'R2 exact-market archive / Hyperliquid public candleSnapshot',
   provenance:'exact',candles,expected:(to-from)/ms,missing:(to-from)/ms-candles.length,gaps,
   archivedShards:shards,ingestedShards:ingested,providerCandlesFetched:fetched,
   complete:gaps.length===0,providerRetention:'Hyperliquid candleSnapshot exposes only the most recent 5,000 candles; older missing history is not reconstructed from other venues',
   fetchedAt:new Date(this.now()).toISOString()};
 }
}

