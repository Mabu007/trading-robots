import { expect, it, vi } from 'vitest';
import { fetchValrCandles } from '../workers/valr-candles';

it('fetches bounded consecutive pages and combines only complete H4 candles',async()=>{
 const start=14400*10000, requests:URL[]=[];
 const fetcher=vi.fn(async (input:string|URL|Request)=>{
  const url=new URL(String(input));requests.push(url);const from=Number(url.searchParams.get('startTime')),end=Number(url.searchParams.get('endTime'));
  return Response.json(Array.from({length:Math.floor((end-from)/3600)+1},(_,i)=>({currencyPairSymbol:'ETHZAR',bucketPeriodInSeconds:3600,startTime:new Date((from+i*3600)*1000).toISOString(),open:'100',high:'102',low:'99',close:'101',volume:'2'})).reverse());
 });
 const result=await fetchValrCandles('ETHZAR','h4',start,start+26*14400,fetcher as typeof fetch);
 expect(result).toHaveLength(26);expect(requests).toHaveLength(2);expect(result[0]).toEqual({time:start,open:100,high:102,low:99,close:101,volume:8});
 expect(Number(requests[0].searchParams.get('endTime'))+1).toBe(Number(requests[1].searchParams.get('startTime')));
});
it('fails closed when the provider omits a source candle',async()=>{
 const start=14400*11000;
 const fetcher=vi.fn(async()=>Response.json([{currencyPairSymbol:'BTCZAR',bucketPeriodInSeconds:3600,startTime:new Date(start*1000).toISOString(),open:'100',high:'102',low:'99',close:'101',volume:'2'}]));
 await expect(fetchValrCandles('BTCZAR','h4',start,start+14400,fetcher as typeof fetch)).rejects.toThrow('Missing VALR candles');
});
