import {describe,it,expect,vi} from 'vitest';
import {getHyperliquidBook} from './hyperliquid-book.ts';
const body={coin:'xyz:GOLD',time:1700000000000,levels:[
 [{px:'100',sz:'2',n:1},{px:'99',sz:'1',n:2}],
 [{px:'101',sz:'1',n:1}]
]};
function mock(value:unknown,status=200){return vi.fn().mockResolvedValue(new Response(JSON.stringify(value),{status})) as unknown as typeof fetch}
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
