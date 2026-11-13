import {describe, expect, it} from 'vitest';
import {findSweepMoments} from './practice-moments';
import type {ReplayBar} from './market-replay-engine';

const bar = (i: number): ReplayBar => ({time: 60 * i, open: 10, high: 11, low: 9, close: 10});
describe('sweep workout discovery', () => {
 it('confirms a sweep at the completed candle and does not need later prices', () => {
  const bars = Array.from({length: 24}, (_, i) => bar(i));
  bars[20] = {...bars[20], high: 12, close: 10};
  expect(findSweepMoments(bars)).toEqual([20]);
  expect(findSweepMoments(bars.slice(0, 22))).toEqual([20]);
 });
 it('does not confirm a breakout that closes outside or bridge missing candles', () => {
  const bars = Array.from({length: 24}, (_, i) => bar(i));
  bars[20] = {...bars[20], high: 12, close: 12};
  expect(findSweepMoments(bars)).toEqual([]);
  bars[20] = {...bars[20], close: 10};
  bars.splice(5, 1);
  expect(findSweepMoments(bars)).toEqual([]);
 });
});
