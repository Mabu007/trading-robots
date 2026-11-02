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
