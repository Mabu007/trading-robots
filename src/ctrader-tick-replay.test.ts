import {describe,it,expect} from 'vitest';
import {simulateCTraderTickReplay} from './ctrader-tick-replay';
import type {CTraderSpecification} from './ctrader-monetary-backtest';
const spec:CTraderSpecification={accountId:'1',asset:'XAUUSD',symbolId:'23',depositCurrency:'USD',quoteToDeposit:1,
 conversionType:'identity',conversionTime:0,bid:3000,ask:3000.1,lotSize:10000,minVolume:100,maxVolume:10000,
 stepVolume:100,roundTripCommissionPerUnit:0,leverageInCents:10000,balance:1000};
describe('cTrader tick-replay execution',()=>{
 it('uses ask for BUY and bid for exit instead of OHLC close',()=>{
  const bars=[{time:60,open:3000,high:3001,low:2999,close:3000,volume:1},
    {time:120,open:3000,high:3004,low:2999,close:3003,volume:1}];
  const decisions=[{action:'BUY',stopLoss:2998,takeProfit:3002},{action:'WAIT'}];
  const bid=[{timeMs:120000,price:3000},{timeMs:120100,price:3002.1}];
  const ask=[{timeMs:120000,price:3000.1},{timeMs:120100,price:3002.2}];
  const out=simulateCTraderTickReplay(bars,decisions,bid,ask,1000,1,spec);
  expect(out.currency).toBe('USD');expect(out.trades.length).toBe(1);
  expect(out.trades[0].entry).toBeCloseTo(3000.1);expect(out.trades[0].exit).toBe(3002);
  expect(out.netProfit).toBeGreaterThan(0);
 });
 it('prices gap-through stops from adverse executable tick',()=>{
  const bars=[{time:60,open:3000,high:3001,low:2999,close:3000,volume:1},
    {time:120,open:3000,high:3002,low:2996,close:2997,volume:1}];
  const d=[{action:'BUY',stopLoss:2998,takeProfit:3002},{action:'WAIT'}];
  const out=simulateCTraderTickReplay(bars,d,[{timeMs:120000,price:3000},{timeMs:121000,price:2996}],
   [{timeMs:120000,price:3000.1},{timeMs:121000,price:2996.1}],1000,1,spec);
  expect(out.trades[0].reason).toBe('stop');
  expect(out.trades[0].exit).toBe(2996);
 });
});
