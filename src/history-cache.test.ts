import {afterEach,describe,expect,it,vi} from 'vitest';
import {historicalData,setResearchHistoryToken} from './history-cache';
afterEach(()=>{setResearchHistoryToken(null);vi.unstubAllGlobals()});
describe('shared historical research loader',()=>{
 it('loads days concurrently with a bounded batch and returns candles in order',async()=>{
  setResearchHistoryToken(async()=> 'fixture');let active=0,maxActive=0,calls=0;
  vi.stubGlobal('fetch',vi.fn(async (_url:string,init:RequestInit)=>{active++;calls++;maxActive=Math.max(maxActive,active);const day=JSON.parse(String(init.body)).day;await new Promise(resolve=>setTimeout(resolve,2));active--;return Response.json({candles:[{time:Date.parse(day+'T00:00:00Z')/1000,open:1,high:1,low:1,close:1}],missingIntervals:0})}));
  const request={venue:'research' as const,asset:'XAUUSD',timeframe:'m1',from:'2026-09-01T00:00:00Z',to:'2026-09-07T00:00:00Z'};
  const result=await historicalData(request);expect(calls).toBe(6);expect(maxActive).toBe(4);expect(result.candles.map(c=>c.time)).toEqual([...result.candles.map(c=>c.time)].sort((a,b)=>a-b));
  await historicalData(request);expect(calls).toBe(6);
 });
});
