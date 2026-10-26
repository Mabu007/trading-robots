export type DemoBot={id:string;name:string;asset:string;prompt:string;description:string;code:string};

export const demoBots:DemoBot[]=[
 {id:'demo-ema-pullback-eurusd',name:'H1 Trend · M15 Pullback',asset:'EURUSD',prompt:'Follow the H1 EMA trend. On M15, enter only when price reclaims the 20 EMA after a pullback. Place the stop beyond the recent 6-bar swing and target 2R.',description:'Multi-timeframe trend filter with a pullback reclaim entry.',code:`// Example strategy 1 · EURUSD trend pullback
export const config = {
  timeframes: ["h1", "m15"],
  executionTimeframe: "m15",
  riskPercent: 1,
  riskReward: 2
};

function ema(candles, period) {
  if (candles.length < period) return null;
  const k = 2 / (period + 1);
  let value = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;
  for (let i = period; i < candles.length; i++) value = candles[i].close * k + value * (1 - k);
  return value;
}

export function onCandle(ctx) {
  const h1 = ctx.timeframes["h1"];
  const m15 = ctx.timeframes["m15"];
  if (h1.length < 60 || m15.length < 25) return { action: "WAIT" };

  const fastTrend = ema(h1.slice(-100), 20);
  const slowTrend = ema(h1.slice(-100), 50);
  const current = m15[m15.length - 1];
  const previous = m15[m15.length - 2];
  const currentEma = ema(m15.slice(-60), 20);
  const previousEma = ema(m15.slice(-61, -1), 20);
  const swing = m15.slice(-7, -1);
  if (fastTrend === null || slowTrend === null || currentEma === null || previousEma === null) return { action: "WAIT" };

  if (fastTrend > slowTrend && previous.close <= previousEma && current.close > currentEma) {
    const stopLoss = Math.min(...swing.map(c => c.low));
    const risk = current.close - stopLoss;
    if (risk > 0) return { action: "BUY", stopLoss, takeProfit: current.close + risk * 2 };
  }
  if (fastTrend < slowTrend && previous.close >= previousEma && current.close < currentEma) {
    const stopLoss = Math.max(...swing.map(c => c.high));
    const risk = stopLoss - current.close;
    if (risk > 0) return { action: "SELL", stopLoss, takeProfit: current.close - risk * 2 };
  }
  return { action: "WAIT" };
}`},
 {id:'demo-rsi-reclaim-xauusd',name:'Gold · RSI Reclaim',asset:'XAUUSD',prompt:'Trade XAUUSD mean reversion on M1. Buy when RSI(14) reclaims 30 after being oversold; sell when it falls back below 70 after being overbought. Use the recent 8-bar swing for the stop and target 1.8R.',description:'M1 RSI reversal entries with recent swing protection.',code:`// Example strategy 2 · XAUUSD RSI reclaim
export const config = {
  timeframes: ["m1"],
  executionTimeframe: "m1",
  riskPercent: 0.5,
  riskReward: 1.8
};

function rsi(candles, period) {
  if (candles.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const relativeStrength = (gains / period) / (losses / period);
  return 100 - 100 / (1 + relativeStrength);
}

export function onCandle(ctx) {
  const candles = ctx.timeframes["m1"];
  if (candles.length < 24) return { action: "WAIT" };
  const previousRsi = rsi(candles.slice(0, -1), 14);
  const currentRsi = rsi(candles, 14);
  if (previousRsi === null || currentRsi === null) return { action: "WAIT" };
  const current = candles[candles.length - 1];
  const swing = candles.slice(-9, -1);

  if (previousRsi < 30 && currentRsi >= 30) {
    const stopLoss = Math.min(...swing.map(c => c.low));
    const risk = current.close - stopLoss;
    if (risk > 0) return { action: "BUY", stopLoss, takeProfit: current.close + risk * 1.8 };
  }
  if (previousRsi > 70 && currentRsi <= 70) {
    const stopLoss = Math.max(...swing.map(c => c.high));
    const risk = stopLoss - current.close;
    if (risk > 0) return { action: "SELL", stopLoss, takeProfit: current.close - risk * 1.8 };
  }
  return { action: "WAIT" };
}`}
];
