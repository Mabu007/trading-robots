import { describe, expect, it } from 'vitest';
import { backtestMoneySummary } from './backtest-summary';

describe('saved money summary', () => {
  it('keeps the simulated loss and return without treating it as a live result', () => {
    expect(backtestMoneySummary({netProfit: -125.5, returnPercent: -2.51})).toEqual({netProfit: -125.5, returnPercent: -2.51, currency: 'ZAR'});
  });
  it('does not invent cash when the simulation or its numbers are unavailable', () => {
    expect(backtestMoneySummary(null)).toBeNull();
    expect(backtestMoneySummary({netProfit: NaN, returnPercent: 0})).toBeNull();
    expect(backtestMoneySummary({netProfit: 1, returnPercent: Infinity})).toBeNull();
  });
});
