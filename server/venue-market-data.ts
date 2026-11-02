import { countObservedGaps, intervalMs, isTimeframe, isValidCandle, type MarketCandle } from './market-data.ts';

// Public read-only APIs. Account access and order submission are deliberately
// separate from market discovery and are not enabled by these adapters.
export class VenueMarketData {
  private metadataCache=new Map<string,{until:number;value:any}>();
  private request: typeof fetch;
  private clock: () => number;
  constructor(request: typeof fetch = fetch, clock: () => number = Date.now) { this.request=request; this.clock=clock; }
  private async json(url: string, init?: RequestInit): Promise<any> {
    const cacheable=!init?.body||!String(init.body).includes('candleSnapshot');
    const cacheKey=url+String(init?.body??'');
    const cached=this.metadataCache.get(cacheKey);
    if(cacheable&&cached&&cached.until>this.clock())return cached.value;
    const response = await this.request(url, { ...init, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(response.status === 429 ? 'Provider rate limit reached. Retry later.' : `Market data provider returned HTTP ${response.status}.`);
    try { const value=await response.json();if(cacheable){this.metadataCache.set(cacheKey,{until:this.clock()+30000,value});while(this.metadataCache.size>128)this.metadataCache.delete(this.metadataCache.keys().next().value!)}return value; } catch { throw new Error('Market data provider returned invalid JSON.'); }
  }
  private hyper(body: unknown) {
    return this.json('https://api.hyperliquid.xyz/info', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  }
  async propdaoMarkets() {
    const data = await this.json('https://app.propdao.finance/api/v1/markets');
    if (!Array.isArray(data?.data) || !data.fees || !Number.isFinite(data.fees.maker) || !Number.isFinite(data.fees.taker)) throw new Error('PropDAO returned invalid market metadata.');
    const markets = data.data.map((row: any) => {
      if (typeof row?.symbol !== 'string' || !/^[A-Z0-9]{2,40}$/.test(row.symbol) || typeof row.coin !== 'string' || !Number.isFinite(row.lotStep) || row.lotStep <= 0 || !Number.isFinite(row.maxLeverage) || row.maxLeverage <= 0) throw new Error('PropDAO returned invalid market metadata.');
      return { symbol:row.symbol, coin:row.coin, dex:typeof row.dex === 'string' ? row.dex : null, lotStep:row.lotStep, maxLeverage:row.maxLeverage };
    });
    return {venue:'propdao', simulated:true, markets, fees:data.fees};
  }
  async hyperliquidMarkets() {
    const dexes = await this.hyper({type:'perpDexs'});
    if (!Array.isArray(dexes) || dexes.length > 100 || dexes.length < 1) throw new Error('Hyperliquid returned invalid DEX metadata.');
    const names = dexes.map((d:any, index:number) => {
      if (index === 0 && d === null) return '';
      if (typeof d?.name !== 'string' || !/^[a-zA-Z0-9_-]{1,20}$/.test(d.name)) throw new Error('Hyperliquid returned invalid DEX metadata.');
      return d.name;
    });
    // Limit concurrency to avoid a burst of provider requests.
    const markets: any[] = [];
    for (const dex of names) {
      const meta = await this.hyper({type:'meta', dex});
      if (!Array.isArray(meta?.universe)) throw new Error('Hyperliquid returned invalid market metadata.');
      for (const row of meta.universe) {
        if (row?.isDelisted === true) continue;
        if (typeof row?.name !== 'string' || !/^[a-zA-Z0-9_:.@-]{1,64}$/.test(row.name) || !Number.isInteger(row.szDecimals) || row.szDecimals < 0 || row.szDecimals > 12 || !Number.isFinite(row.maxLeverage) || row.maxLeverage <= 0) throw new Error('Hyperliquid returned invalid market metadata.');
        markets.push({symbol:row.name, dex, sizeDecimals:row.szDecimals, quantityStep:10 ** -row.szDecimals, maxLeverage:row.maxLeverage});
      }
    }
    return {venue:'hyperliquid', markets};
  }
  async hyperliquidCandles(input: {asset:unknown; timeframe:unknown; from:unknown; to:unknown}) {
    const {asset,timeframe,from,to}=input;
    if (typeof asset !== 'string' || !/^[a-zA-Z0-9_:.@-]{1,64}$/.test(asset) || !isTimeframe(timeframe)) throw new Error('Choose a valid market and timeframe.');
    const start = typeof from === 'string' ? Date.parse(from) : NaN, requestedEnd = typeof to === 'string' ? Date.parse(to) : NaN;
    const period = intervalMs[timeframe], end = Math.min(requestedEnd, Math.floor(this.clock()/period)*period);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start % period || end % period || (end-start)/period > 5000) throw new Error('Choose an aligned range of at most 5,000 completed candles.');
    const interval: Record<string,string> = {m1:'1m',m5:'5m',m15:'15m',m30:'30m',h1:'1h',h4:'4h',d1:'1d'};
    const rows = await this.hyper({type:'candleSnapshot', req:{coin:asset,interval:interval[timeframe],startTime:start,endTime:end-1}});
    if (!Array.isArray(rows)) throw new Error('Hyperliquid returned invalid candles.');
    const unique = new Map<number,MarketCandle>();
    for (const row of rows) {
      const candle = {time:Number(row.t)/1000,open:Number(row.o),high:Number(row.h),low:Number(row.l),close:Number(row.c),volume:Number(row.v)};
      if (row.s !== asset || row.i !== interval[timeframe] || !isValidCandle(candle) || Number(row.t)%period) throw new Error('Hyperliquid returned invalid or mismatched candles.');
      if (row.t < start || row.t >= end) continue;
      const previous=unique.get(candle.time);
      if (previous && JSON.stringify(previous)!==JSON.stringify(candle)) throw new Error('Hyperliquid returned conflicting candles.');
      unique.set(candle.time,candle);
    }
    const candles=[...unique.values()].sort((a,b)=>a.time-b.time);
    return {source:'Hyperliquid',asset,timeframe,candles,expectedCandles:(end-start)/period,missingCandles:(end-start)/period-candles.length,observedGaps:countObservedGaps(candles,timeframe),endExclusive:true};
  }
}
