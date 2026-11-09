import {describe,it,expect,vi} from 'vitest';
import {getHyperliquidTradeSummary} from './hyperliquid-trades';
const now=Date.parse('2026-11-09T12:22:00Z');
describe('public Hyperliquid bounded recent trade sample',()=>{
  it('calculates buyer- and seller-initiated sizes without returning personal identifiers',async()=>{
    const fetcher=vi.fn(async()=>Response.json([
      {coin:'xyz:GOLD',side:'B',px:'4115.5',sz:'2',time:now-3000,hash:'secret_wallet'},
      {coin:'xyz:GOLD',side:'A',px:'4114.0',sz:'1',time:now-8000,hash:'secret_wallet'}
    ]));
    const result=await getHyperliquidTradeSummary('xyz:GOLD',fetcher as typeof fetch,now);
    expect(result).toMatchObject({tradeCount:2,buyAggressorSize:2,sellAggressorSize:1,totalSampleSize:3});
    expect(result.sampleBuyFraction).toBeCloseTo(2/3);
    expect(result.sampleVwap).toBeCloseTo((4115.5*2+4114)/3);
    expect(JSON.stringify(result)).not.toContain('secret_wallet');
    const firstCall=fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(JSON.parse(String(firstCall[1].body))).toEqual({type:'recentTrades',coin:'xyz:GOLD'});
  });
  it('refuses mismatched or invalid rows and does not treat stale prints as fresh',async()=>{
    const mismatched=vi.fn(async()=>Response.json([{coin:'BTC',side:'B',px:'1',sz:'2',time:now}]));
    const result=await getHyperliquidTradeSummary('xyz:GOLD',mismatched as typeof fetch,now);
    expect(result.tradeCount).toBe(0);
    const malformed=vi.fn(async()=>Response.json([{coin:'xyz:GOLD',side:'C',px:'1',sz:'2',time:now}]));
    await expect(getHyperliquidTradeSummary('xyz:GOLD',malformed as typeof fetch,now)).rejects.toThrow('Invalid recent trade data');
  });
});
