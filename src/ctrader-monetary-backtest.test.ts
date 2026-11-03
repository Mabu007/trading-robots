import {describe,it,expect} from 'vitest';
import {brokerBacktestAssumptions,simulateCTraderMoney,type CTraderSpecification} from './ctrader-monetary-backtest';
const spec:CTraderSpecification={accountId:'123',asset:'XAUUSD',symbolId:'12',depositCurrency:'USD',
 quoteToDeposit:1,conversionType:'identity',conversionTime:Date.now(),bid:3000,ask:3000.2,
 lotSize:10000,minVolume:100,maxVolume:10000,stepVolume:100,roundTripCommissionPerUnit:.01,
 leverageInCents:10000,balance:1000};
describe('cTrader deposit-currency monetary replay',()=>{
 it('converts cTrader hundredths volume into broker lots',()=>{
  const a=brokerBacktestAssumptions(spec,0.05);
  expect(a.contractSize).toBe(100);
  expect(a.minVolume).toBe(.01);
  expect(a.volumeStep).toBe(.01);
  expect(a.commissionPerLotZar).toBe(1);
  expect(a.spread).toBeCloseTo(.2);
 });
 it('calculates money results in actual account currency',()=>{
  const candles=[
   {time:60,open:3000,high:3001,low:2999,close:3000,volume:1},
   {time:120,open:3000,high:3005,low:2999.9,close:3004,volume:1}
  ];
  const decisions=[{action:'BUY',stopLoss:2998,takeProfit:3004.5},{action:'WAIT'}];
  const out=simulateCTraderMoney(candles,decisions,1000,1,spec,.01);
  expect(out.currency).toBe('USD');
  expect(out.startingBalance).toBe(1000);
  expect(out.trades.length).toBeGreaterThan(0);
 });
 it('rejects impossible specs',()=>expect(()=>brokerBacktestAssumptions({...spec,minVolume:0},.1)).toThrow());
});
