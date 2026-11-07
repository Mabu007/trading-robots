import {describe,it,expect,vi} from 'vitest';
import {R2MarketHistory} from './r2-market-history.ts';
import {instrumentFromHyperPerp,brokerInstrument} from './instrument-registry.ts';
const i=instrumentFromHyperPerp({name:'BTC',szDecimals:5},'');
const t=Date.UTC(2026,10,1),bar=(ms:number)=>({time:ms/1000,open:10,high:12,low:9,close:11,volume:2});
function fixture(candles= [bar(t),bar(t+120000)]){
 const entries=new Map<string,string>();
 const store={list:vi.fn(async(prefix:string)=>[...entries.keys()].filter(k=>k.startsWith(prefix))),
 read:vi.fn(async(k:string)=>entries.get(k)??null),writeIfAbsent:vi.fn(async(k:string,v:string)=>{
  if(entries.has(k))return false;
  entries.set(k,v);return true;
 })};
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
  expect(one.providerCandlesFetched).toBe(2);expect(one.ingestedShards).toBe(1);
  const two=await f.svc.get(input);
  expect(two.candles).toHaveLength(2);expect(two.archivedShards).toBe(1);
  expect(f.provider.hyperliquidCandles).toHaveBeenCalledTimes(1);
 });
 it('rejects cross-venue proxy or conflicting cached candles',async()=>{
  const f=fixture();
  const input={instrument:i,timeframe:'m1' as const,from:new Date(t).toISOString(),to:new Date(t+120000).toISOString()};
  await expect(f.svc.get({...input,instrument:brokerInstrument({venue:'propdao',kind:'perpetual',symbol:'GOLDUSDC'})})).rejects.toThrow(/proxy/);
  await f.svc.get({...input,fetchMissing:true});
  const key=[...f.entries.keys()][0],shard=JSON.parse(f.entries.get(key)!);
  f.entries.set(key.replace('.json','-other.json'),JSON.stringify({...shard,candles:[{...bar(t),close:11.5}]}));
  await expect(f.svc.get(input)).rejects.toThrow(/Conflicting/);
 });
 it('uses atomic content-addressed create-once keys under concurrent instances',async()=>{
  const f=fixture([bar(t),bar(t+60000),bar(t+120000)]);
  const input={instrument:i,timeframe:'m1' as const,from:new Date(t).toISOString(),to:new Date(t+180000).toISOString(),fetchMissing:true};
  const [a,b]=await Promise.all([f.svc.get(input),f.svc.get(input)]);
  expect(a.complete).toBe(true);expect(b.complete).toBe(true);
  expect(f.entries.size).toBe(1);
  expect(f.store.writeIfAbsent).toHaveBeenCalledTimes(2);
  const next=await f.svc.get(input);
  expect(next.providerCandlesFetched).toBe(0);
  expect(next.archivedShards).toBe(1);
 });
 it('rejects malformed OHLC and impossible date range without any write',async()=>{
  const f=fixture([{...bar(t),high:1}]);
  const input={instrument:i,timeframe:'m1' as const,from:new Date(t).toISOString(),to:new Date(t+60000).toISOString()};
  await expect(f.svc.get({...input,fetchMissing:true})).rejects.toThrow(/Invalid OHLC/);
  expect(f.store.writeIfAbsent).not.toHaveBeenCalled();
  await expect(f.svc.get({...input,to:new Date(t+10).toISOString()})).rejects.toThrow(/aligned/);
 });
});

