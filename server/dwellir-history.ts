import { countObservedGaps, intervalMs, isTimeframe, isValidCandle, type MarketCandle, type MarketTimeframe } from './market-data.ts';
import {VenueMarketData} from './venue-market-data.ts';
import { readR2Object, writeR2Object } from './r2.ts';

// Dwellir indexes sparse, finalized Hyperliquid candles. Never fill missing bars
// with synthetic prices: strategies must see only observed market activity.
const WEEK = 7 * 86_400_000;
const FIRST_HISTORY = Date.parse('2025-07-27T08:00:00Z');
const API_ORIGIN = 'https://api-hyperliquid-index.n.dwellir.com';
type Storage = { read:(key:string)=>Promise<string|null>; write:(key:string,body:string)=>Promise<void> };
type Page = {data:unknown[];hasMore:boolean;nextCursor?:string};
const validSymbol = (s:unknown):s is string => typeof s === 'string' && /^[A-Za-z0-9_:.@/\-]{1,64}$/.test(s) && !s.includes('..');
const seconds = (ms:number) => new Date(ms).toISOString();
const number = (n:unknown) => typeof n==='string'||typeof n==='number'?Number(n):NaN;
const upstreamError = (status:number) => status===401||status===403?'Dwellir credentials or historical-data entitlement were rejected.':status===429?'Dwellir historical-data rate limit reached.':`Dwellir historical data returned HTTP ${status}.`;

export class DwellirHistory {
 private readonly storage:Storage;
 private readonly waiting=new Map<string,Promise<MarketCandle[]>>();
 private readonly publicMarket:VenueMarketData;
 private readonly request:typeof fetch;
 private readonly key:()=>string|undefined;
 private readonly now:()=>number;
 constructor(storage:Storage={read:readR2Object,write:writeR2Object},request:typeof fetch=fetch,key:()=>string|undefined=()=>process.env.DWELLIR_API_KEY,now:()=>number=Date.now){
  this.storage=storage;this.request=request;this.key=key;this.now=now;this.publicMarket=new VenueMarketData(request,now);
 }

 // Public Hyperliquid history is a read-only fallback for GOLDUSDC only.
 // Reuse the existing Dwellir R2 archive first, then persist finalized public
 // snapshots separately. Empty/expired windows are not cached as fake candles.
 private async goldPublic(market:string,timeframe:MarketTimeframe,start:number,end:number):Promise<MarketCandle[]> {
  const period=intervalMs[timeframe];
  const key=`historical/hyperliquid/v1/${encodeURIComponent(market)}/${timeframe}/${start}-${end}.json`;
  const cached=await this.storage.read(key).catch(()=>null);
  if(cached!==null){
   let rows:unknown;try{rows=JSON.parse(cached)}catch{throw Error('Cached Hyperliquid Gold history is corrupt.')}
   if(!Array.isArray(rows)||!rows.every((c:any,i:number)=>isValidCandle(c)&&c.time*1000>=start&&c.time*1000<end&&c.time*1000%period===0&&(!i||rows[i-1].time<c.time)))throw Error('Cached Hyperliquid Gold history is invalid.');
   return rows as MarketCandle[];
  }
  const lastClosed=Math.floor(this.now()/period)*period;
  const from=Math.max(Math.ceil(start/period)*period,lastClosed-5000*period);
  const to=Math.min(Math.floor(end/period)*period,lastClosed);
  if(from>=to)return [];
  const {candles}=await this.publicMarket.hyperliquidCandles({asset:market,timeframe,from:seconds(from),to:seconds(to)});
  if(candles.length)await this.storage.write(key,JSON.stringify(candles)).catch(()=>console.warn('Public Hyperliquid archive write unavailable'));
  return candles;
 }
 private async weekly(market:string,base:'1m'|'5m',start:number,end:number):Promise<MarketCandle[]> {
  const cacheKey=`historical/dwellir/v1/${encodeURIComponent(market)}/${base}/${start}.json`;
  const completeWeek=end===start+WEEK;
  // Persist closed, partial GOLDUSDC M1 archive weeks as immutable R2 objects.
  // Other markets retain their existing full-week-only caching behavior.
  const archivedGold=market==='xyz:GOLD'&&base==='1m'&&end<=Date.parse('2026-11-03T00:00:00Z');
  const objectKey=completeWeek?cacheKey:archivedGold?`historical/dwellir/v1/${encodeURIComponent(market)}/${base}/${start}-${end}.json`:null;
  const cached=objectKey?await this.storage.read(objectKey).catch(()=>null):null;
  if(cached!==null){
   let parsed:unknown;try{parsed=JSON.parse(cached)}catch{throw Error('Cached Dwellir history is corrupt.')}
   if(!Array.isArray(parsed)||!parsed.every(isValidCandle))throw Error('Cached Dwellir history is invalid.');
   return parsed as MarketCandle[];
  }
  const waitingKey=objectKey??cacheKey+'-'+end;const existing=this.waiting.get(waitingKey);if(existing)return existing;
  const task=(async()=>{
   if(market==='xyz:GOLD')return this.goldPublic(market,base==='1m'?'m1':'m5',start,end);
   const secret=this.key()?.trim();if(!secret)throw Error('Dwellir historical data is not configured.');
   const period=base==='1m'?60_000:300_000, candles=new Map<number,MarketCandle>();
   let cursor:string|undefined;
   const cursors=new Set<string>();
   for(let page=0;page<100;page++){
    const url=new URL(`${API_ORIGIN}/${encodeURIComponent(secret)}/v1/candles/range`);
    url.searchParams.set('market',market);url.searchParams.set('interval',base);
    url.searchParams.set('start',seconds(start));url.searchParams.set('end',seconds(end));url.searchParams.set('limit','5000');
    if(cursor)url.searchParams.set('cursor',cursor);
    let response:Response;
    try{response=await this.request(url.toString(),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20_000)})}
    catch{throw Error('Could not reach Dwellir historical data.')}
    if(!response.ok)throw Error(upstreamError(response.status));
    let value:Page;try{value=await response.json() as Page}catch{throw Error('Dwellir returned malformed JSON.')}
    if(!value||!Array.isArray(value.data)||typeof value.hasMore!=='boolean'||value.data.length>5000)throw Error('Dwellir returned an invalid candle page.');
    for(const row of value.data){
     const r=row as Record<string,unknown>;
     const t=number(r?.t),c:MarketCandle={time:t/1000,open:number(r?.o),high:number(r?.h),low:number(r?.l),close:number(r?.c),volume:number(r?.v)};
     if(r?.s!==market||r?.i!==base||r?.x!==true||!Number.isInteger(t)||t%period!==0||t<start||t>=end||!isValidCandle(c))throw Error('Dwellir returned invalid or mismatched candles.');
     const previous=candles.get(c.time);
     if(previous&&JSON.stringify(previous)!==JSON.stringify(c))throw Error('Dwellir returned conflicting candles.');
     candles.set(c.time,c);
    }
    if(!value.hasMore) {
     const result=[...candles.values()].sort((a,b)=>a.time-b.time);
     if(objectKey)await this.storage.write(objectKey,JSON.stringify(result));
     return result;
    }
    if(typeof value.nextCursor!=='string'||!value.nextCursor||cursors.has(value.nextCursor))throw Error('Dwellir pagination did not advance.');
    cursors.add(value.nextCursor);cursor=value.nextCursor;
   }
   throw Error('Dwellir pagination exceeded the allowed page count.');
  })();
  this.waiting.set(waitingKey,task);
  try{return await task}finally{this.waiting.delete(waitingKey)}
 }
 async candles(input:{asset:unknown;timeframe:unknown;from:unknown;to:unknown}) {
  const {asset,timeframe,from,to}=input;
  if(!validSymbol(asset)||!isTimeframe(timeframe))throw Error('Choose a valid market and timeframe.');
  const originalStart=typeof from==='string'?Date.parse(from):NaN;
  const originalEnd=typeof to==='string'?Date.parse(to):NaN;
  const period=intervalMs[timeframe], base:'1m'|'5m'=timeframe==='m1'?'1m':'5m';
  const baseMs=base==='1m'?60_000:300_000;
  const now=Math.floor(this.now()/period)*period;
  const start=originalStart,end=Math.min(originalEnd,now);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||start%period!==0||end%period!==0||start<FIRST_HISTORY||originalEnd<start)throw Error('Choose a valid aligned historical date range after July 27, 2025.');
  if((end-start)/period>50_000)throw Error('Choose at most 50,000 candles per request.');
  const chunks:{start:number;end:number}[]=[];
  for(let t=Math.floor(start/WEEK)*WEEK;t<end;t+=WEEK)chunks.push({start:t,end:Math.min(t+WEEK,asset==='xyz:GOLD'&&timeframe==='m1'?end:now,now)});
  // Limit download work per HTTP request. Longer runs can reuse cached weeks.
  if(chunks.length>32)throw Error('Select a shorter date range (up to 32 history weeks per request).');
  const segments:MarketCandle[][]=new Array(chunks.length);
  const nativeSegments:MarketCandle[][]=new Array(chunks.length);
  for(let i=0;i<chunks.length;i+=4){
   await Promise.all(chunks.slice(i,i+4).map(async (chunk,j)=>{
    if(asset==='xyz:GOLD'&&timeframe!=='m1'){
     const native=await this.goldPublic(asset,timeframe,chunk.start,chunk.end);
     if(native.length){nativeSegments[i+j]=native;segments[i+j]=[];return;}
    }
    segments[i+j]=await this.weekly(asset,base,chunk.start,chunk.end);
   }));
  }
  const unique=new Map<number,MarketCandle>();
  for(const segment of segments)for(const candle of segment)if(candle.time*1000>=start&&candle.time*1000<end)unique.set(candle.time,candle);
  const baseRows=[...unique.values()].sort((a,b)=>a.time-b.time);
  const candles:MarketCandle[]=[];
  if(period===baseMs)candles.push(...baseRows);
  else{
   for(let t=start;t<end;t+=period){
    const group:MarketCandle[]=[];
    for(let u=t;u<t+period;u+=baseMs){
     const bar=unique.get(u/1000);
     if(!bar)break;
     group.push(bar);
    }
    if(group.length!==period/baseMs)continue;
    candles.push({time:t/1000,open:group[0].open,high:Math.max(...group.map(c=>c.high)),low:Math.min(...group.map(c=>c.low)),close:group[group.length-1].close,volume:group.reduce((n,c)=>n+c.volume,0)});
   }
  }
  if(asset==='xyz:GOLD'){
   const merged=new Map(candles.map(c=>[c.time,c]));
   for(const native of nativeSegments)if(native)for(const c of native)if(c.time*1000>=start&&c.time*1000<end)merged.set(c.time,c);
   candles.length=0;candles.push(...[...merged.values()].sort((a,b)=>a.time-b.time));
  }
  const expectedCandles=(end-start)/period;
  return {source:asset==='xyz:GOLD'?'R2 archive + public Hyperliquid (xyz:GOLD)':`Dwellir Hyperliquid (${asset})`,asset,timeframe,candles,expectedCandles,missingCandles:expectedCandles-candles.length,observedGaps:countObservedGaps(candles,timeframe),endExclusive:true,cache:'R2',sparse:true,rangeStart:seconds(start),rangeEndExclusive:seconds(end),coverageComplete:candles.length===expectedCandles};
 }
}
