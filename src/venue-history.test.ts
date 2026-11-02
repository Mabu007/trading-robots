import {afterEach,expect,it,vi} from 'vitest';
import {historicalData} from './history-cache';
afterEach(()=>vi.unstubAllGlobals());
it('routes PropDAO reference history to its adapter and aligns candle boundaries',async()=>{
 const fetcher=vi.fn(async(_url:string,_init?:RequestInit)=>Response.json({candles:[{time:60,open:1,high:1,low:1,close:1,volume:1}],source:'Hyperliquid reference',missingCandles:0,observedGaps:0}));vi.stubGlobal('fetch',fetcher);
 const result=await historicalData({venue:'propdao',asset:'GOLDUSDC',timeframe:'m1',from:'2026-10-01T00:00:01Z',to:'2026-10-01T00:01:59Z'});
 expect(result.source).toBe('Hyperliquid reference');expect(fetcher.mock.calls[0][0]).toBe('/api/venues/propdao/candles');
});
