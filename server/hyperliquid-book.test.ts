import {describe,it,expect,vi} from 'vitest';
import {getHyperliquidBook,HyperliquidBookCache} from './hyperliquid-book.ts';
const body={coin:'xyz:GOLD',time:1700000000000,levels:[
 [{px:'100',sz:'2',n:1},{px:'99',sz:'1',n:2}],
 [{px:'101',sz:'1',n:1}]
]};
function mock(value:unknown,status=200){return vi.fn().mockImplementation(async()=>new Response(JSON.stringify(value),{status})) as unknown as typeof fetch}
describe('Hyperliquid visible order book',()=>{
 it('returns sourced snapshot and correctly calculated depth',async()=>{
  const f=mock(body);const result=await getHyperliquidBook('xyz:GOLD',f);
  expect(result.bestBid).toBe(100);expect(result.bestAsk).toBe(101);expect(result.spread).toBe(1);
  expect(result.imbalance).toBe(.5);expect(result.asOf).toBe('2023-11-14T22:13:20.000Z');
  expect(JSON.parse(String((vi.mocked(f).mock.calls[0][1] as RequestInit).body))).toEqual({type:'l2Book',coin:'xyz:GOLD'});
 });
 it('rejects mismatched instrument and malformed or crossed books',async()=>{
  await expect(getHyperliquidBook('BTC',mock(body))).rejects.toThrow();
  await expect(getHyperliquidBook('xyz:GOLD',mock({...body,levels:[[{px:'1',sz:'-1',n:1}],[]]}))).rejects.toThrow();
  await expect(getHyperliquidBook('xyz:GOLD',mock({...body,levels:[[{px:'102',sz:'1',n:1}],body.levels[1]]}))).rejects.toThrow();
 });
 it('fails closed for provider errors and invalid identifiers',async()=>{
  await expect(getHyperliquidBook('BTC',mock({},429))).rejects.toThrow();
  await expect(getHyperliquidBook('../invalid?',mock(body))).rejects.toThrow();
 });
});

describe('per-process provider protection',()=>{
 it('coalesces concurrent requests and caches only successful snapshots',async()=>{
  const f=mock(body);let now=0;const cache=new HyperliquidBookCache(f,()=>now,2000);
  const [a,b]=await Promise.all([cache.get('xyz:GOLD'),cache.get('xyz:GOLD')]);
  expect(a).toEqual(b);expect(f).toHaveBeenCalledTimes(1);
  now=1999;await cache.get('xyz:GOLD');expect(f).toHaveBeenCalledTimes(1);
  now=2001;await cache.get('xyz:GOLD');expect(f).toHaveBeenCalledTimes(2);
 });
 it('limits outbound calls and resets after the window',async()=>{
  const f=mock(body);let now=0;const cache=new HyperliquidBookCache(f,()=>now,0,1);
  await cache.get('xyz:GOLD');await expect(cache.get('xyz:GOLD')).rejects.toThrow('limit');
  now=60001;await cache.get('xyz:GOLD');expect(f).toHaveBeenCalledTimes(2);
 });
 it('does not cache provider failures',async()=>{
  const f=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(new Response(JSON.stringify(body))) as unknown as typeof fetch;
  const cache=new HyperliquidBookCache(f);
  await expect(cache.get('xyz:GOLD')).rejects.toThrow();
  await expect(cache.get('xyz:GOLD')).resolves.toMatchObject({market:'xyz:GOLD'});
  expect(f).toHaveBeenCalledTimes(2);
 });
});
