export type MarketCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const timeframes = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1'] as const;
export type MarketTimeframe = typeof timeframes[number];
export const isTimeframe = (value: unknown): value is MarketTimeframe => typeof value === 'string' && timeframes.includes(value as MarketTimeframe);
export const intervalMs: Record<MarketTimeframe, number> = {
  m1: 60_000, m5: 300_000, m15: 900_000, m30: 1_800_000,
  h1: 3_600_000, h4: 14_400_000, d1: 86_400_000,
};

export function countObservedGaps(candles: MarketCandle[], timeframe: MarketTimeframe): number {
  const expectedSeconds = intervalMs[timeframe] / 1000;
  let gaps = 0;
  for (let index = 1; index < candles.length; index++) {
    if (candles[index].time - candles[index - 1].time > expectedSeconds * 1.5) gaps++;
  }
  return gaps;
}

export function isValidCandle(c: MarketCandle): boolean {
  return Number.isInteger(c.time) && c.time > 0
    && [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0
    && c.volume >= 0
    && c.high >= Math.max(c.open, c.close)
    && c.low <= Math.min(c.open, c.close)
    && c.high >= c.low;
}
