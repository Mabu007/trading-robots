import { describe, expect, it, vi } from 'vitest';
import { VenueMarketData } from './venue-market-data.ts';

describe('provider market data', () => {
  it('uses PropDAO metadata and rejects malformed risk limits', async () => {
    const request=vi.fn().mockResolvedValueOnce(Response.json({fees:{maker:0.00015,taker:0.00045},data:[{symbol:'GOLDUSDC',coin:'GOLD',dex:'xyz',lotStep:0.01,maxLeverage:1.5}]})).mockResolvedValueOnce(Response.json({fees:{maker:0,taker:0},data:[{symbol:'BTCUSDC',coin:'BTC',lotStep:0,maxLeverage:2}]}));
    let now=0;const provider=new VenueMarketData(request,()=>now);
    expect((await provider.propdaoMarkets()).markets[0]).toMatchObject({symbol:'GOLDUSDC',lotStep:0.01});
    now=31000;await expect(provider.propdaoMarkets()).rejects.toThrow('invalid market metadata');
  });
  it('discovers native and HIP-3 markets without relabeling their names', async () => {
    const request=vi.fn(async (_:string, init:RequestInit)=>{
      const body=JSON.parse(String(init.body));
      return Response.json(body.type==='perpDexs'?[null,{name:'xyz'}]:{universe:body.dex?[{name:'xyz:GOLD',szDecimals:3,maxLeverage:10}]:[{name:'BTC',szDecimals:5,maxLeverage:40},{name:'OLD',szDecimals:2,maxLeverage:2,isDelisted:true}]});
    });
    const result=await new VenueMarketData(request as typeof fetch).hyperliquidMarkets();
    expect(result.markets.map(m=>m.symbol)).toEqual(['BTC','xyz:GOLD']);
    expect(result.markets[1].quantityStep).toBe(0.001);
  });
  it('excludes unfinished candles and reports missing coverage',async()=>{
    const request=vi.fn().mockResolvedValue(Response.json([{s:'BTC',i:'1m',t:60000,o:'10',h:'12',l:'9',c:'11',v:'2'},{s:'BTC',i:'1m',t:180000,o:'11',h:'12',l:'10',c:'11',v:'1'}]));
    const result=await new VenueMarketData(request,()=>240000).hyperliquidCandles({asset:'BTC',timeframe:'m1',from:new Date(60000).toISOString(),to:new Date(180000).toISOString()});
    expect(result.candles).toHaveLength(1);expect(result.missingCandles).toBe(1);
    const sent=JSON.parse(request.mock.calls[0][1].body);expect(sent.req.endTime).toBe(179999);
  });
  it('reads finalized complete ranges from the persistent archive after provider retention expires',async()=>{
    const input={asset:'BTC',timeframe:'m1',from:new Date(60000).toISOString(),to:new Date(120000).toISOString()};
    const request=vi.fn(async()=>Response.json([{s:'BTC',i:'1m',t:60000,o:'10',h:'12',l:'9',c:'11',v:'2'}]));
    const objects=new Map<string,string>();
    const archive={read:async(key:string)=>objects.get(key)??null,write:async(key:string,value:string)=>{objects.set(key,value)}};
    const first=await new VenueMarketData(request,()=>90000000,archive).hyperliquidCandles(input);
    expect(first).toMatchObject({cache:'public candleSnapshot',missingCandles:0});
    const replay=await new VenueMarketData(request,()=>900000000,archive).hyperliquidCandles(input);
    expect(replay).toMatchObject({cache:'R2 archive',candles:first.candles});
    expect(request).toHaveBeenCalledTimes(1);
  });
});
