import {describe,it,expect,vi} from 'vitest';
import {HyperliquidPublicService} from './hyperliquid-public.ts';
import {instrumentFromHyperPerp} from './instrument-registry.ts';
function api(body:any){
 switch(body.type){
  case 'perpDexs':return [null,{name:'xyz'}];
  case 'metaAndAssetCtxs':return body.dex?[
    {universe:[{name:'xyz:GOLD',szDecimals:3,maxLeverage:10}]},
    [{markPx:'4000',oraclePx:'3999',midPx:'3999.5',funding:'0.0001',openInterest:'100',dayNtlVlm:'900000'}]
   ]:[{universe:[{name:'BTC',szDecimals:5,maxLeverage:40},{name:'ETH',szDecimals:4,maxLeverage:30}]},[{markPx:'80000'},{markPx:'5000'}]];
  case 'meta':return body.dex?{universe:[{name:'xyz:GOLD',szDecimals:3}]}:{universe:[{name:'BTC',szDecimals:5},{name:'ETH',szDecimals:4}]};
  case 'spotMetaAndAssetCtxs':return [{tokens:[{name:'USDC',index:0,szDecimals:8},{name:'PURR',index:1,szDecimals:0}],universe:[{index:0,name:'PURR/USDC',tokens:[1,0]}]},[{markPx:'1'}]];
  case 'l2Book':return {coin:body.coin,time:1700000000000,levels:[[{px:'10',sz:'2',n:1}],[{px:'11',sz:'1',n:1}]]};
  case 'recentTrades':return [{coin:body.coin,time:1700000000000,px:'10',sz:'2',side:'B',tid:12}];
  case 'allMids':return {'BTC':'10'};
 }return {};
}
const fetcher=vi.fn(async(_url:any,init:any)=>Response.json(api(JSON.parse(init.body)))) as unknown as typeof fetch;
describe('public Hyperliquid source-aware discovery',()=>{
 it('discovers core BTC/ETH, exact HIP-3 namespace and spot with null unknown specs',async()=>{
  const service=new HyperliquidPublicService(fetcher,()=>1700000001000,false);
  const result=await service.discover();
  expect(result.errors).toEqual([]);
  expect(result.instruments.map(x=>x.id)).toContain('hyperliquid:hip3-perpetual:xyz:GOLD');
  expect(result.instruments.map(x=>x.id)).toContain('hyperliquid:perpetual:BTC');
  expect(result.instruments.map(x=>x.id)).toContain('hyperliquid:perpetual:ETH');
  expect(result.instruments.map(x=>x.id)).toContain('hyperliquid:spot:PURR/USDC');
  expect(result.instruments.find(x=>x.symbol==='BTC')?.contractSize).toBeNull();
 });
 it('returns provider-time book, source-unknown context timestamp, and trades',async()=>{
  const service=new HyperliquidPublicService(fetcher,()=>1700000001000,false);
  const gold=instrumentFromHyperPerp({name:'xyz:GOLD',szDecimals:3},'xyz');
  const ctx=await service.context(gold);expect(ctx.funding).toBe(.0001);expect(ctx.openInterest).toBe(100);
  expect(ctx.observedAt).toBeNull();expect(ctx.sourceTimestampAvailable).toBe(false);
  const b=await service.book(gold);expect(b.bestBid).toBe(10);expect(b.askSize).toBe(1);
  expect(b.asOf).toBe('2023-11-14T22:13:20.000Z');
  expect((await service.trades(gold)).trades[0].tid).toBe(12);
 });
});

