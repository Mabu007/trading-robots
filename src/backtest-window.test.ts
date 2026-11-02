import { expect, it } from 'vitest';
import { tradingWindow } from './backtest';

it('keeps warm-up signals out of the trading period and aligns subsequent signals', () => {
  const candles = [0, 60, 120, 180].map(time => ({time, open:1, high:1, low:1, close:1, volume:1}));
  const decisions = ['warmup-buy', 'warmup-sell', 'first', 'second'];
  const result = tradingWindow(candles, decisions, 120);
  expect(result.candles.map(c => c.time)).toEqual([120, 180]);
  expect(result.decisions).toEqual(['first', 'second']);
  expect(result.warmupCandles).toBe(2);
  expect(() => tradingWindow(candles, decisions, 180)).toThrow('At least two candles');
});
