import { afterEach, expect, it, vi } from 'vitest';
import { valrHistory } from './valr-history';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()});
it('requests contiguous 100-candle pages and excludes the incomplete current candle',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(300*60*1000+30_000);
 const requests:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async (_url:string,init:RequestInit)=>{
  const body=JSON.parse(String(init.body));requests.push(body);
  const start=Date.parse(body.from)/1000,end=Date.parse(body.to)/1000;
  return Response.json({candles:Array.from({length:(end-start)/60},(_,i)=>({time:start+i*60,open:1,high:1,low:1,close:1,volume:1})),missingCandles:0,observedGaps:0});
 }));
 const result=await valrHistory({asset:'ETHZAR',timeframe:'m1',from:new Date(60*1000).toISOString(),to:new Date(301*60*1000).toISOString()});
 expect(result.candles).toHaveLength(299);expect(requests).toHaveLength(3);
 expect(requests[0].to).toBe(requests[1].from);
 expect(result.candles.at(-1)?.time).toBe(299*60);
});
it('rejects oversized ranges before sending requests',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(10000*60*1000);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(valrHistory({asset:'ETHZAR',timeframe:'m1',from:new Date(60*1000).toISOString(),to:new Date(6000*60*1000).toISOString()})).rejects.toThrow('5,000');
 expect(fetcher).not.toHaveBeenCalled();
});
it('waits and retries a rate-limited page without dropping data',async()=>{
 vi.useFakeTimers();vi.setSystemTime(300*60*1000);
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:'VALR market data rate limit reached. Wait and retry.'},{status:502})).mockResolvedValueOnce(Response.json({candles:[{time:60,open:1,high:1,low:1,close:1,volume:1}],missingCandles:0,observedGaps:0}));
 vi.stubGlobal('fetch',fetcher);const retry=vi.fn();
 const promise=valrHistory({asset:'ETHZAR',timeframe:'m1',from:new Date(60*1000).toISOString(),to:new Date(120*1000).toISOString()},undefined,retry);
 await vi.advanceTimersByTimeAsync(0);expect(retry).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(60_000);expect((await promise).candles).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(2);
});
