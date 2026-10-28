import { describe, expect, it } from 'vitest';
import { simulateMoney, validateMonetaryAssumptions } from './monetary-backtest';
const c=(time:number,open:number,high:number,low:number,close:number)=>({time,open,high,low,close,volume:1});
const a={contractSize:1,minVolume:1,volumeStep:1,quoteToZar:1,spread:0,slippage:0,commissionPerLotZar:0};
describe('monetary backtest',()=>{
 it('compounds risk on the next eligible trade and reconciles equity',()=>{
  const candles=[c(1,100,101,99,100),c(2,100,102,99.5,101),c(3,100,101,99,100),c(4,100,102,99.5,101)];
  const decisions=[{action:'BUY',stopLoss:99,takeProfit:102},{action:'WAIT'},{action:'BUY',stopLoss:99,takeProfit:102}];
  const out=simulateMoney(candles,decisions,500,5,a);
  expect(out.trades.map(t=>t.volume)).toEqual([25,27]); expect(out.endingBalance).toBe(604);
  expect(out.equity.at(-1)?.value).toBe(out.endingBalance);
 });
 it('rejects minimum volume and insufficient margin',()=>{
  const candles=[c(1,100,101,99,100),c(2,100,101,99,100)]; const decisions=[{action:'BUY',stopLoss:90,takeProfit:110}];
  expect(simulateMoney(candles,decisions,50,5,a).rejected[0].reason).toMatch(/Minimum volume/);
  expect(simulateMoney(candles,decisions,500,5,{...a,leverage:0.1}).rejected[0].reason).toMatch(/margin/);
 });
 it('includes conversion, execution costs, and gap stops',()=>{
  const candles=[c(1,100,101,99,100),c(2,100,101,99,100),c(3,95,96,94,95)];
  const out=simulateMoney(candles,[{action:'BUY',stopLoss:98,takeProfit:110}],500,5,{...a,quoteToZar:2,volumeStep:.1,minVolume:.1,spread:.2,slippage:.1,commissionPerLotZar:1});
  expect(out.trades[0].exit).toBe(94.9); expect(out.trades[0].pnlZar).toBeLessThan(-25); expect(out.trades[0].commissionZar).toBeGreaterThan(0); expect(out.endingBalance).toBeCloseTo(500+out.trades[0].pnlZar);
 });
 it('rejects absent specifications',()=>expect(validateMonetaryAssumptions({...a,quoteToZar:0})).toMatch(/quoteToZar/));
 it('marks open positions at candle close for drawdown',()=>{
  const candles=[c(1,100,101,99,100),c(2,100,101,97,98),c(3,100,103,99,102)];
  const out=simulateMoney(candles,[{action:'BUY',stopLoss:95,takeProfit:102}],500,5,a);
  expect(out.endingBalance).toBe(510);expect(out.maxDrawdown).toBe(10);expect(out.maxDrawdownPercent).toBe(2);
 });
 it('replays later entries after a risk rejection',()=>{
  const candles=[c(1,100,101,99,100),c(2,100,101,99,100),c(3,100,101,99,100),c(4,100,102,99.5,101)];
  const out=simulateMoney(candles,[{action:'BUY',stopLoss:50,takeProfit:110},{action:'WAIT'},{action:'BUY',stopLoss:99,takeProfit:102}],500,5,a);
  expect(out.rejected).toHaveLength(1);expect(out.trades).toHaveLength(1);expect(out.trades[0].entryTime).toBe(4);
 });

 it('rounds volume to increments from the minimum rather than exceeding risk',()=>{
  const candles=[c(1,100,101,99,100),c(2,100,101,99.5,100)];
  const out=simulateMoney(candles,[{action:'BUY',stopLoss:99,takeProfit:110}],1,5,{...a,minVolume:.03,volumeStep:.02});
  expect(out.trades[0].volume).toBeCloseTo(.05);expect(out.trades[0].intendedRisk).toBeCloseTo(.05);
 });

});
