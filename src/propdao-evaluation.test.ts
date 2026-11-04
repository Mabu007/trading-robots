import {describe,expect,it} from 'vitest';
import {IRON_1K,simulatePropDAO} from './propdao-evaluation';
import type {Candle} from './types';
const minute=60;
const origin=Date.parse('2026-09-01T10:00:00Z')/1000;
const candle=(i:number,low=99,high=101,close=100):Candle=>({time:origin+i*minute,open:100,high,low,close,volume:1});
const buy={action:'BUY',stopLoss:99,takeProfit:110};
describe('Iron $1K evaluation replay',()=>{
 it('starts with fixed challenge metrics, not ZAR user assumptions',()=>{
  const s=simulatePropDAO([candle(0)],[undefined],0.25);
  expect(s.status).toBe('not-passed');expect(s.equity).toBe(1000);expect(s.balance).toBe(1000);
  expect(s.available).toBe(1000);expect(s.profitTargetRemaining).toBe(100);
  expect(s.dailyLossUsed).toBe(0);expect(s.drawdownUsed).toBe(0);
 });
 it('passes only after a closed profitable trade meets the $100 target',()=>{
  const s=simulatePropDAO([candle(0),candle(1,100,110,110)],[buy,undefined],1);
  expect(s.status).toBe('passed');expect(s.balance).toBe(1100);expect(s.profitTargetRemaining).toBe(0);
  expect(s.completedTrades).toBe(1);expect(s.endedAt).toBe(origin+60);
 });
 it('stops the evaluation when the 2% daily loss limit is touched',()=>{
  const candles=[candle(0),candle(1,99,100,99),candle(2),candle(3,99,100,99),candle(4),candle(5,99,100,99)];
  const signals=[buy,undefined,buy,undefined,buy,undefined];
  const s=simulatePropDAO(candles,signals,1);
  expect(s.status).toBe('failed-daily');expect(s.completedTrades).toBe(2);
  expect(s.balance).toBe(980);expect(s.endedAt).toBe(origin+180);
 });
 it('fails the static floor when a gap is large, even if daily loss limit also breaches',()=>{
  const candles=[candle(0),candle(1,100,101,100),{...candle(2,96,100,97),open:96}];
  const s=simulatePropDAO(candles,[buy,undefined,undefined],2);
  expect(s.status).toBe('failed-total');expect(s.maxObservedDrawdown).toBeGreaterThanOrEqual(50);
  expect(s.endedAt).toBe(origin+120);
 });
 it('checks worst intrabar equity conservatively even if candle recovers',()=>{
  const signal={action:'BUY',stopLoss:99,takeProfit:110};
  const candles=[candle(0),candle(1,100,101,100),{...candle(2,97,110,110),open:97}];
  const s=simulatePropDAO(candles,[signal,undefined,undefined],1);
  expect(s.status).toBe('failed-daily');
  expect(s.maxObservedDailyLoss).toBeGreaterThanOrEqual(20);
 });
 it('keeps cost assumptions and USD risk separate from theoretical R-only metrics',()=>{
  const s=simulatePropDAO([candle(0),candle(1,99,100,99)],[buy,undefined],0.25,{spread:0,slippage:0,commissionR:0.1});
  expect(s.completedTrades).toBe(1);expect(s.trades[0].pnlUsd).toBeCloseTo(-2.75);
  expect(s.balance).toBeCloseTo(997.25);
 });
 it('uses highest closed balance, not opening equity, for daily loss floor',()=>{
  const target2={action:'BUY',stopLoss:99,takeProfit:102};
  const candles=[candle(0),candle(1,100,102,102),candle(2),candle(3,99,100,99),candle(4),candle(5,99,100,99)];
  const s=simulatePropDAO(candles,[target2,undefined,buy,undefined,buy,undefined],1);
  // +$20 banked, followed by -$20: daily high-water loss is $20,
  // even though balance returns to the original $1,000.
  expect(s.status).toBe('failed-daily');
  expect(s.balance).toBe(1000);
  expect(s.maxObservedDailyLoss).toBeCloseTo(20);
 });
 it('skips a favourably gapped oversized-R fill under configured reward policy',()=>{const dates=[{...candle(0,99,101,100),open:100},{...candle(1,89,105,90),open:104}];const r=simulatePropDAO(dates,[{action:'SELL',stopLoss:105,takeProfit:90}],0.25,{spread:0,slippage:0,commissionR:0},2);expect(r.completedTrades).toBe(0);expect(r.balance).toBe(1000);});
 it('defines the agreed challenge limits',()=>{
  expect(IRON_1K).toEqual({startingBalance:1000,targetProfit:100,maxStaticLoss:50,maxDailyLoss:20});
 });
});
