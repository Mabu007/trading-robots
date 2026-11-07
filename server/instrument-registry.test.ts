import {describe,it,expect} from 'vitest';
import {InstrumentRegistry,instrumentFromHyperPerp,instrumentsFromHyperSpot,brokerInstrument} from './instrument-registry.ts';
import {resolveDataSource,type SourceOption} from './source-capabilities.ts';
describe('canonical venue instruments',()=>{
 it('never conflates core BTC, HIP-3 gold, PropDAO gold or cTrader gold',()=>{
  const r=new InstrumentRegistry();
  const btc=instrumentFromHyperPerp({name:'BTC',szDecimals:5},'');
  const eth=instrumentFromHyperPerp({name:'ETH',szDecimals:4},'');
  const gold=instrumentFromHyperPerp({name:'xyz:GOLD',szDecimals:3},'xyz');
  const prop=brokerInstrument({venue:'propdao',kind:'perpetual',symbol:'GOLDUSDC'});
  const ctrader=brokerInstrument({venue:'ctrader',kind:'cfd',symbol:'XAUUSD'});
  for(const item of [btc,eth,gold,prop,ctrader])r.add(item);
  expect(r.all()).toHaveLength(5);expect(r.resolve({id:'hyperliquid:hip3-perpetual:xyz:GOLD'})).toEqual(gold);
  expect(gold.id).not.toEqual(prop.id);expect(prop.id).not.toEqual(ctrader.id);
  expect(gold.quantityStep).toBe(.001);expect(gold.contractSize).toBeNull();
  expect(()=>r.resolve({symbol:'GOLD'})).toThrow(/ambiguous/);
  expect(()=>r.resolve({id:gold.id,venue:'propdao'})).toThrow(/mismatch/);
 });
 it('preserves spot pair provider index and token indices without pretending it is a perpetual',()=>{
  const pair=instrumentsFromHyperSpot({tokens:[{index:0,name:'USDC',szDecimals:8},{index:150,name:'HYPE',szDecimals:2}],universe:[{index:107,name:'@107',tokens:[150,0]}]})[0];
  expect(pair.id).toBe('hyperliquid:spot:@107');expect(pair.base).toBe('HYPE');expect(pair.quote).toBe('USDC');expect(pair.providerIds.spotIndex).toBe(107);
 });
});
describe('source capability and permission resolver',()=>{
 const i=instrumentFromHyperPerp({name:'xyz:GOLD',szDecimals:3},'xyz');
 const base:SourceOption={source:'Hyperliquid',venue:'hyperliquid',instrumentId:i.id,capabilities:['book','candles'],role:'exact',asOf:100000,
   health:'healthy',completeness:1,allowed:true,entitled:true,costRank:1,rateLimitRemaining:20,maxAgeMs:5000,
   historicalFrom:0,historicalTo:150000,provenance:'hyperliquid'};
 it('selects exact even when a cheaper related proxy exists',()=>{
  const cheap={...base,role:'related' as const,instrumentId:'propdao:perpetual:GOLDUSDC',venue:'propdao',costRank:0,source:'PropDAO'};
  expect(resolveDataSource({instrument:i,capability:'book',purpose:'research',candidates:[cheap,base],now:101000,allowRelated:true}).chosen?.source).toBe('Hyperliquid');
  expect(resolveDataSource({instrument:i,capability:'candles',purpose:'backtest',candidates:[cheap],now:101000,allowRelated:true}).chosen).toBeNull();
 });
 it('fails closed on stale, missing permissions and historical gaps',()=>{
  expect(resolveDataSource({instrument:i,capability:'book',purpose:'execution',candidates:[{...base,asOf:100000}],now:110000}).chosen).toBeNull();
  expect(resolveDataSource({instrument:i,capability:'book',purpose:'display',candidates:[{...base,allowed:false}],now:101000}).chosen).toBeNull();
  expect(resolveDataSource({instrument:i,capability:'candles',purpose:'backtest',candidates:[base],now:101000,from:0,to:151000}).chosen).toBeNull();
 });
});

