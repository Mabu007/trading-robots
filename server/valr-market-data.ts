import { countObservedGaps, isTimeframe, isValidCandle, type MarketCandle, type MarketTimeframe } from './market-data.ts';

// VALR's bucket endpoint accepts at most 100 rows per request. Keep this
// adapter paginated so callers can bound work and handle rate limits.
const seconds: Record<MarketTimeframe, number> = { m1: 60, m5: 300, m15: 900, m30: 1800, h1: 3600, h4: 14400, d1: 86400 };
type Pair = { symbol: string; active: boolean; baseCurrency: string; quoteCurrency: string; currencyPairType: string; minBaseAmount: string; maxBaseAmount: string; minQuoteAmount: string; maxQuoteAmount: string; tickSize: string; baseDecimalPlaces: string };
type CacheEntry = { expires: number; value: unknown };

export class ValrMarketData {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<unknown>>();
  private request: typeof fetch;
  private clock: () => number;
  constructor(request: typeof fetch = fetch, clock: () => number = Date.now) { this.request = request; this.clock = clock; }

  private async get(path: string, ttl: number): Promise<unknown> {
    const cached = this.cache.get(path);
    if (cached && cached.expires > this.clock()) return cached.value;
    const pending = this.inFlight.get(path);
    if (pending) return pending;
    const task = (async () => {
      const response = await this.request(`https://api.valr.com${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        if (response.status === 429) throw new Error('VALR market data rate limit reached. Wait and retry.');
        throw new Error(`VALR market data returned HTTP ${response.status}.`);
      }
      let value: unknown;
      try { value = await response.json(); } catch { throw new Error('VALR returned invalid JSON.'); }
      this.cache.set(path, { value, expires: this.clock() + ttl });
      while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
      return value;
    })();
    this.inFlight.set(path, task);
    try { return await task; } finally { this.inFlight.delete(path); }
  }

  async pairs(): Promise<Pair[]> {
    const value = await this.get('/v1/public/pairs', 300_000);
    if (!Array.isArray(value)) throw new Error('VALR returned an invalid markets response.');
    return value.filter((p): p is Pair => p && typeof p.symbol === 'string' && /^[A-Z0-9]{3,30}$/.test(p.symbol) && p.active === true && typeof p.baseCurrency === 'string' && typeof p.quoteCurrency === 'string');
  }

  async candles(input: { asset: unknown; timeframe: unknown; from: unknown; to: unknown }) {
    const { asset, timeframe, from, to } = input;
    if (typeof asset !== 'string' || !/^[A-Z0-9]{3,30}$/.test(asset)) throw new Error('Choose a valid VALR market.');
    if (!isTimeframe(timeframe)) throw new Error('Unsupported timeframe.');
    const start = typeof from === 'string' ? Date.parse(from) / 1000 : NaN;
    const end = typeof to === 'string' ? Date.parse(to) / 1000 : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end > this.clock() / 1000 + 1) throw new Error('Choose a valid past UTC date range.');
    const period = seconds[timeframe];
    const base = timeframe === 'h4' ? 3600 : period;
    if (start % period !== 0 || end % period !== 0) throw new Error('Dates must align with candle boundaries.');
    if ((end - start) / base > 100) throw new Error('A page may contain at most 100 VALR source candles. Request another page.');
    if (!(await this.pairs()).some(pair => pair.symbol === asset)) throw new Error('This market is not active on VALR.');
    // Ask for the instant before the exclusive end so an inclusive provider
    // boundary cannot consume one of the 100 slots with the next candle.
    const params = new URLSearchParams({ periodSeconds: String(base), startTime: String(start), endTime: String(end - 1), skip: '0', limit: '100', includeEmpty: 'true' });
    const value = await this.get(`/v1/public/${asset}/buckets?${params}`, end * 1000 < this.clock() - 120_000 ? 600_000 : 15_000);
    if (!Array.isArray(value)) throw new Error('VALR returned an invalid candle response.');
    const unique = new Map<number, MarketCandle>();
    for (const row of value) {
      const time = Date.parse(String(row?.startTime)) / 1000;
      const candle = { time, open: Number(row?.open), high: Number(row?.high), low: Number(row?.low), close: Number(row?.close), volume: Number(row?.volume) };
      if (!isValidCandle(candle) || time % base !== 0 || row?.currencyPairSymbol !== asset || Number(row?.bucketPeriodInSeconds) !== base) throw new Error('VALR returned an invalid or mismatched candle.');
      if (time < start || time >= end) continue;
      const old = unique.get(time);
      if (old && JSON.stringify(old) !== JSON.stringify(candle)) throw new Error('VALR returned conflicting candles.');
      unique.set(time, candle);
    }
    const rows = [...unique.values()].sort((a, b) => a.time - b.time);
    let candles = rows;
    if (timeframe === 'h4') {
      candles = [];
      for (let t = start; t < end; t += period) {
        const group = Array.from({ length: 4 }, (_, i) => unique.get(t + i * base));
        if (group.some(c => !c)) continue; // Never invent a partial 4-hour candle.
        const [first, ...rest] = group as MarketCandle[];
        candles.push({ time: t, open: first.open, high: Math.max(first.high, ...rest.map(c => c.high)), low: Math.min(first.low, ...rest.map(c => c.low)), close: rest.at(-1)!.close, volume: group.reduce((sum, c) => sum + c!.volume, 0) });
      }
    }
    const expected = (end - start) / period;
    return { source: 'VALR', asset, timeframe, candles, observedGaps: countObservedGaps(candles, timeframe), expectedCandles: expected, missingCandles: expected - candles.length, requested: { from, to }, endExclusive: true };
  }
}
