import { describe, expect, it, vi } from 'vitest';
import { ValrMarketData } from './valr-market-data';

const start = Date.parse('2026-01-01T00:00:00Z') / 1000;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const pair = { symbol: 'ETHZAR', active: true, baseCurrency: 'ETH', quoteCurrency: 'ZAR', currencyPairType: 'SPOT' };
const candle = (time: number, price: number) => ({ currencyPairSymbol: 'ETHZAR', bucketPeriodInSeconds: 3600, startTime: iso(time), open: String(price), high: String(price + 2), low: String(price - 1), close: String(price + 1), volume: '2' });
const clock = () => Date.parse('2026-01-10T00:00:00Z');

describe('VALR public market data', () => {
  it('aggregates only complete UTC four-hour groups, sorts rows, and reports missing candles', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/pairs') ? Response.json([pair]) : Response.json([
      candle(start + 10800, 13), candle(start, 10), candle(start + 3600, 11), candle(start + 7200, 12), candle(start + 14400, 14),
    ]));
    const provider = new ValrMarketData(fetcher as typeof fetch, clock);
    const result = await provider.candles({ asset: 'ETHZAR', timeframe: 'h4', from: iso(start), to: iso(start + 28800) });
    expect(result.candles).toEqual([{ time: start, open: 10, high: 15, low: 9, close: 14, volume: 8 }]);
    expect(result.missingCandles).toBe(1);
    const url = new URL(String(fetcher.mock.calls[1][0]));
    expect(url.searchParams.get('periodSeconds')).toBe('3600');
    expect(url.searchParams.get('endTime')).toBe(String(start + 28800 - 1));
  });

  it('deduplicates concurrent public requests and rejects conflicting candles', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/pairs') ? Response.json([pair]) : Response.json([candle(start, 10), candle(start, 11)]));
    const provider = new ValrMarketData(fetcher as typeof fetch, clock);
    const request = { asset: 'ETHZAR', timeframe: 'h1', from: iso(start), to: iso(start + 3600) };
    const results = await Promise.allSettled([provider.candles(request), provider.candles(request)]);
    expect(results.every(result => result.status === 'rejected' && /conflicting/.test(String(result.reason)))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('bounds page size and propagates provider rate limits without inventing data', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429 }));
    const provider = new ValrMarketData(fetcher as typeof fetch, clock);
    await expect(provider.candles({ asset: 'ETHZAR', timeframe: 'h1', from: iso(start), to: iso(start + 101 * 3600) })).rejects.toThrow('at most 100');
    await expect(provider.pairs()).rejects.toThrow('rate limit');
  });
});
