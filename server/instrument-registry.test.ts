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
  const pair=instrumentsFromHyperSpot({tokens:[{index:0,name:'USDC',szDecimals:8},{index:150,name:'HYPE',szDecimals:2}],universe:[{index:107,na¶»§q«^