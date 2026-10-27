import { describe, expect, it } from 'vitest';
import { strategyDocumentation } from './strategy-documentation';
import { parseStrategyConfig } from './strategy';

function exampleFrom(doc: string) {
  const match = doc.match(/```js\n([\s\S]*?)\n```/);
  if (!match) throw new Error('No strategy example was included');
  return match[1];
}

describe('copyable strategy guide', () => {
  it('provides an executable example using an available timeframe', () => {
    const doc = strategyDocumentation('XAUUSD', ['h1', 'm5']);
    expect(doc).toContain('Selected instrument: XAUUSD');
    expect(doc).toContain('Listed historical timeframes: h1, m5');
    const code = exampleFrom(doc);
    const config = parseStrategyConfig(code);
    expect(config.executionTimeframe).toBe('h1');
    const js = code.replace(/export\s+const\s+config\s*=/, 'const config =').replace(/export\s+function\s+onCandle\s*\(/, 'function onCandle(');
    const onCandle = new Function(`${js}; return onCandle;`)();
    const candles = Array.from({ length: 35 }, (_, i) => ({ time: i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 }));
    expect(onCandle({ candle: candles[0], index: 0, timeframes: { h1: candles.slice(0, 1) } })).toEqual({ action: 'WAIT' });
    const decision = onCandle({ candle: candles.at(-1), index: 34, timeframes: { h1: candles } });
    expect(decision.action).toBe('BUY');
    expect(decision.stopLoss).toBeLessThan(candles.at(-1)!.close);
    expect(decision.takeProfit).toBeGreaterThan(candles.at(-1)!.close);
  });

  it('does not pretend historical timeframes are available when data has not loaded', () => {
    const doc = strategyDocumentation('XAUUSD', []);
    expect(doc).toContain('not loaded yet');
    expect(parseStrategyConfig(exampleFrom(doc)).executionTimeframe).toBe('m1');
  });
});
