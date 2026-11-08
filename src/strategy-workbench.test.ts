import {describe, expect, it, vi} from 'vitest';
import {runBacktest} from './backtest';
import {compressBacktest, decompressBacktest} from './backtest-storage';
import {historicalData} from './history-cache';
import {backtestRange, simulateWorkbench, validateWorkbenchSource, type StrategyRun} from './strategy-workbench';
import {starterCode} from './strategy';

vi.mock('./history-cache', () => ({historicalData: vi.fn()}));
vi.mock('./backtest', () => ({runBacktest: vi.fn()}));

describe('Strategy Library backtest', () => {
  it('validates source and rejects invalid or unfinished UTC dates', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(() => validateWorkbenchSource(starterCode.replace('function onCandle', 'function other'))).toThrow(/onCandle/);
    expect(() => backtestRange('2026-02-30', '2026-03-03', ['m1'], now)).toThrow(/completed UTC dates/);
    expect(() => backtestRange('2026-11-08', '2026-11-08', ['m1'], now)).toThrow(/completed UTC dates/);
    expect(() => backtestRange('2026-01-01', '2026-11-01', ['m1'], now)).toThrow(/50,000 candles/);
  });

  it('uses the chosen market and dates and retains source identity in the saved result', async () => {
    const time = Date.parse('2026-10-26T00:00:00Z') / 1000;
    const candles = [time, time + 60].map(time => ({time, open: 100, high: 101, low: 99, close: 100, volume: 1}));
    const input = {venue: 'propdao' as const, asset: 'GOLDUSDC', strategyCode: starterCode, from: '2026-10-26', to: '2026-10-26'};
    const signal = new AbortController().signal;
    vi.mocked(historicalData).mockResolvedValueOnce({candles, source: 'Reference history', observedGaps: 1, missingCandles: 1});
    vi.mocked(runBacktest).mockResolvedValueOnce({
      candles, trades: [], equity: [], logs: ['Costs assumed'], decisions: [{action: 'WAIT'}, {action: 'BUY', stopLoss: 99, takeProfit: 102}],
      metrics: {trades: 0, wins: 0, losses: 0, winRate: 0, netReturn: 0, profitFactor: 0, maxDrawdown: 0, endingBalance: 0},
    });
    const result = await simulateWorkbench(input, signal, () => {});
    expect(historicalData).toHaveBeenCalledWith({venue: 'propdao', asset: 'GOLDUSDC', timeframe: 'm1',
      from: '2026-10-25T20:40:00.000Z', to: '2026-10-26T23:59:59.000Z'}, signal, expect.any(Function));
    expect(runBacktest).toHaveBeenCalledWith(starterCode, {m1: candles}, 0, signal, time);
    expect(await decompressBacktest<StrategyRun>(await compressBacktest(result))).toMatchObject({
      ...input, result: {timeframe: 'm1', source: 'Reference history', candles},
      sparseSignals: [{index: 1, action: 'BUY', stopLoss: 99, takeProfit: 102}],
    });
  });
});
