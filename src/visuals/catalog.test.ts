import {describe,it,expect} from 'vitest';
import {tradingCatalog,tradingComponentNames,visualSpec} from './catalog';
describe('Trading Vibes generative UI safety catalog',()=>{
 it('only offers approved source-backed financial components',()=>{
  expect(tradingComponentNames).toHaveLength(12);
  expect(tradingComponentNames).toEqual(expect.arrayContaining(['TradeInspection','CandlestickChart','BacktestSummary','EquityCurve','BrokerAccounts','StrategyCard','RiskBreakdown','MarketSnapshot','MonitorStatus','ActionApproval','NewsSnapshot','NewsCoverage']));
  expect(tradingCatalog).toBeDefined();
 });
 it('produces only record-linked React spec',()=>{
  const spec=visualSpec('NewsSnapshot','news-gold-1');
  expect(spec?.elements.root).toEqual({type:'NewsSnapshot',props:{recordId:'news-gold-1'},children:[]});
 });
 it('does not accept unbounded record identifiers',()=>{
  expect(visualSpec('TradeInspection','a'.repeat(161))).toBeNull();
  expect(visualSpec('BrokerAccounts','')).toBeNull();
 });
});