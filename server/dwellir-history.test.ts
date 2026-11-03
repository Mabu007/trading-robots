import {describe,it,expect,vi} from 'vitest';
import {DwellirHistory} from './dwellir-history.ts';

const WEEK=7*86400000;
const monday=Date.parse('2025-09-04T00:00:00.000Z');
const start=Math.floor(monday/WEEK)*WEEK;
const t=start+300000;
const bar=(time:number,close='101')=>({s:'BTC',i:'5m',t:time,T:time+299999,o:'100',h:'102',l:'99',c:close,v:'10',q:'1000',n:3,x:true});
const memory=()=>{const map=new Map<string,string>();return {map,read:async(k:string)=>map.get(k)??null,write:async(k:string,v:string)=>{map.set(k,v);}}};
const history=(storage:ReturnType<typeof memory>,fetcher:typeof fetch)=>new DwellirHistory(storage,fetcher,()=> 'test-key',()=>Date.parse('2026-11-02T00:00:00Z'));
describe('Dwellir historical market data',()=>{

 it('uses public Hyperliquid for an uncached GOLDUSDC minute week, saves actual bars to R2, and never calls Dwellir',async()=>{
  const storage=memory(),ms=start+60000;
  const fetcher=vi.fn(async(url:string,init:RequestInit)=>{
   expect(url).toBe('https://api.hyperliquid.xyz/info');
   expect(JSON.parse(String(init.body)).req).toMatchObject({coin:'xyz:GOLD',interval:'1m'});
   return Response.json([{s:'xyz:GOLD',i:'1m',t:ms,o:'2000',h:'2003',l:'1999',c:'2001',v:'10'}]);
  }) as typeof fetch;
  const input={asset:'xyz:GOLD',timeframe:'m1',from:new Date(start).toISOString(),to:new Date(start+WEEK).toISOString()};
  const first=await history(storage,fetcher).candles(input);
  expect(first.candles).toHaveLength(1);
  expect(first.candles[0].close).toBe(2001);
  expect(first.missingCandles).toBe(10079);
  expect([...storage.map.keys()].some(key=>key.startsWith('historical/hyperliquid/v1/'))).toBe(true);
  const second=await history(storage,fetcher).candles(input);
  expect(second.candles).toEqual(first.candles);
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('obtains M15 and H1 GOLDUSDC candles from public Hyperliquid without the paid Dwellir feed',async()=>{
  for(const [timeframe,interval,period] of [['m15','15m',900000],['h1','1h',3600000]] as const){
   const storage=memory(),ms=start+period;
   const request=vi.fn(async(url:string,init:RequestInit)=>{
    expect(url).toBe('https://api.hyperliquid.xyz/info');
    const input=JSON.parse(String(init.body));
    expect(input.req.interval).toBe(interval);
    return Response.json([{s:'xyz:GOLD',i:interval,t:ms,o:'2000',h:'2010',l:'1990',c:'2003',v:'20'}]);
   }) as typeof fetch;
   const input={asset:'xyz:GOLD',timeframe,from:new Date(start).toISOString(),to:new Date(start+WEEK).toISOString()};
   const first=await history(storage,request).candles(input);
   expect(first.candles).toHaveLength(1);
   expect(first.candles[0].time).toBe(ms/1000);
   await history(storage,request).candles(input);
   expect(request).toHaveBeenCalledTimes(1);
  }
 });
 it('does not fabricate GOLDUSDC candles beyond public retention or existing R2 weeks',async()=>{
  const storage=memory(),request=vi.fn() as unknown as typeof fetch;
  const h=new DwellirHistory(storage,request,()=>undefined,()=>Date.parse('2026-11-03T00:00:00Z'));
  const result=await h.candles({asset:'xyz:GOLD',timeframe:'m1',from:new Date(start).toISOString(),to:new Date(start+WEEK).toISOString()});
  expect(result.candles).toEqual([]);
  expect(result.missingCandles).toBe(10080);
  expect(request).not.toHaveBeenCalled();
 });
 it('caches completed GOLDUSDC M1 partial archive weeks without refetching Dwellir',async()=>{
  const storage=memory();
  const partialEnd=start+3*86400000;
  const bar1={...bar(t),s:'xyz:GOLD',i:'1m',t:start+60000,T:start+119999};
  const request=vi.fn(async()=>Response.json({data:[bar1],hasMore:false})) as unknown as typeof fetch;
  const input={asset:'xyz:GOLD',timeframe:'m1',from:new Date(start+60000).toISOString(),to:new Date(partialEnd).toISOString()};
  const result=await history(storage,request).candles(input);
  expect(result.candles).toHaveLength(1);
  expect(result.candles[0].time).toBe(bar1.t/1000);
  expect([...storage.map.keys()]).toEqual([`historical/dwellir/v1/xyz%3AGOLD/1m/${start}-${partialEnd}.json`]);
  await history(storage,request).candles(input);
  expect(request).toHaveBeenCalledTimes(1);
 });
 it('paginates, validates, persists a completed week and reuses the R2 cache',async()=>{
  const storage=memory();
  const request=vi.fn(async(url:string)=>{
   const u=new URL(url);
   expect(u.pathname).toContain('/test-key/v1/candles/range');
   if(!u.searchParams.has('cursor'))return new Response(JSON.stringify({data:[bar(t)],hasMore:true,nextCursor:'next'}));
   return new Response(JSON.stringify({data:[bar(t+300000)],hasMore:false}));
  }) as unknown as typeof fetch;
  const input={asset:'BTC',timeframe:'m5',from:new Date(start).toISOString(),to:new Date(start+WEEK).toISOString()};
  const first=await history(storage,request).candles(input);
  expect(first.candles).toHaveLength(2);
  expect(first.missingCandles).toBe(2014);
  expect(storage.map.size).toBe(1);
  const again=await history(storage,request).candles(input);
  expect(again.candles).toEqual(first.candles);
  expect(request).toHaveBeenCalledTimes(2);
 });
 it('does not manufacture larger candles when underlying intervals are missing',async()=>{
  const storage=memory();
  const request=vi.fn(async()=>new Response(JSON.stringify({data:[bar(t),bar(t+600000)],hasMore:false}))) as unknown as typeof fetch;
  const result=await history(storage,request).candles({asset:'BTC',timeframe:'m15',from:new Date(start).toISOString(),to:new Date(start+900000).toISOString()});
  expect(result.candles).toHaveLength(0);
  expect(result.missingCandles).toBe(1);
 });
 it('rejects upstream malformed data and does not cache it',async()=>{
  const storage=memory();
  const request=vi.fn(async()=>new Response(JSON.stringify({data:[{...bar(t),s:'ETH'}],hasMore:false}))) as unknown as typeof fetch;
  await expect(history(storage,request).candles({asset:'BTC',timeframe:'m5',from:new Date(start).toISOString(),to:new Date(start+WEEK).toISOString()})).rejects.toThrow(/mismatched/);
  expect(storage.map.size).toBe(0);
 });
 it('rejects invalid market symbols without making a paid provider request',async()=>{
  const storage=memory(),request=vi.fn() as unknown as typeof fetch;
  await expect(history(storage,request).candles({asset:'../../secret',timeframe:'m5',from:new Date(start).toISOString(),to:new Date(start+WEEK).toISOString()})).rejects.toThrow(/valid market/);
  expect(request).not.toHaveBeenCalled();
 });
});
