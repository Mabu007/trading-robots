import { describe, expect, it } from 'vitest';
import { candleObjectKey, countObservedGaps, normalizeCandles, parseCandleCsv, utcDaysBetween } from '../server/market-data';

describe('manual candle data', () => {
  it('parses UTC CSV and removes duplicate timestamps deterministically', () => {
    const rows = parseCandleCsv('time,open,high,low,close,volume\n2026-07-01T00:00:00Z,1,1.2,0.9,1.1,4\n2026-07-01T00:00:00Z,1,1.2,0.9,1.1,4\n2026-07-01 00:05:00,1.1,1.3,1,1.2,5');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ time: 1782864000, open: 1, high: 1.2, low: 0.9, close: 1.1, volume: 4 });
    expect(rows[1].time).toBe(1782864300);
  });

  it('accepts millisecond timestamps and normalizes to seconds', () => {
    const result = normalizeCandles([{ timestamp: 1782864000000, open: 1, high: 2, low: 0.5, close: 1.5 }]);
    expect(result.candles[0].time).toBe(1782864000);
    expect(result.candles[0].volume).toBe(0);
  });

  it('rejects malformed, impossible rows rather than storing bad prices', () => {
    expect(() => parseCandleCsv('time,open,high,low,close\n2026-07-01T00:00:00Z,4,1,3,2'))
      .toThrow('Invalid candle on CSV row 2');
  });

  it('builds stable private keys and UTC day partitions', () => {
    expect(candleObjectKey('EURUSD', 'm5', '2026-07-01')).toBe('market-data/v1/EURUSD/m5/2026-07-01.json');
    expect(utcDaysBetween(new Date('2026-07-01T22:00:00Z'), new Date('2026-07-02T01:00:00Z')))
      .toEqual(['2026-07-01', '2026-07-02']);
  });

  it('reports a missing M1 candle using the stored second timestamps', () => {
    const candle = (time: number) => ({ time, open: 4200, high: 4201, low: 4199, close: 4200, volume: 1 });
    expect(countObservedGaps([candle(1_782_864_000), candle(1_782_864_060), candle(1_782_864_180)], 'm1')).toBe(1);
  });
});
