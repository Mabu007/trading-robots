import {describe,it,expect,vi} from 'vitest';
import {R2MarketHistory} from './r2-market-history.ts';
import {instrumentFromHyperPerp,brokerInstrument} from './instrument-registry.ts';
const i=instrumentFromHyperPerp({name:'BTC',szDecimals:5},'');
const t=Date.UTC(2026,10,1),bar=(ms:number)=>({time:ms/1000,open:10,high:12,low:9,close:11,volume:2});
function fixture(candles= [bar(t),bar(t+120000)]){
 const entries=new Map<string,string>();
 const store={list:vi.fn(async(prefix:string)=>[...entries.keys()].filter(k=>k.startsWith(prefix))),
 read:vi.fn(async(k:string)=>entries.get(k)??null),write:vi.fn(async(k:string,v:string)=>{entries.set(k,v);})};
 const provider={hyperliquidCandles:vi.fn(async({from,to}:{from:string;to:string})=>({source:'Hyperliquid',candles:candles.filter(c=>c.time*1000>=Date.parse(from)&&c.time*1000<Date.parse(to))}))};
 const svc=new R2MarketHistory(store,provider,()=>t+dayOffset);
 return {svc,store,provider,entries};
}
const dayOffset=86400000*4;
describe('exact archived market OHLC',()=>{
 it('detects missing bars, stores immutable real provider candles, reuses R2 and does not fill gaps',async()=>{
  const f=fixture(),input={instrument:i,timeframe:'m1' as const,from:new Date(t).toISOString(),to:new Date(t+180000).toISOString()};
  const one=await f.svc.get({...input,fetchMissing:true});
  expect(one.expected).toBe(3);expect(one.missing).toBe(1);expect(one.gaps).toEqual([{start:t+60000,end:t+120000}]);
  expect(one.providerCandlesFetched).toBe(2);expec¶»§q«^