import type { Candle } from './types';
export const starterCode = `// A simple moving-average trend strategy. Edit freely.
export const config = {
  timeframes: ["m1"],
  executionTimeframe: "m1",
  riskPercent: 1,
  riskReward: 2
};

function sma(candles, period) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((sum, candle) => sum + candle.close, 0) / period;
}

export function onCandle(ctx) {
  const candles = ctx.timeframes["m1"];
  const fast = sma(candles, 10);
  const slow = sma(candles, 30);
  if (fast === null || slow === null) return { action: "WAIT" };

  const candle = candles[candles.length - 1];
  const risk = Math.max(candle.high - candle.low, candle.close * 0.001);
  if (fast > slow) return { action: "BUY", stopLoss: candle.close - risk, takeProfit: candle.close + risk * 2 };
  if (fast < slow) return { action: "SELL", stopLoss: candle.close + risk, takeProfit: candle.close - risk * 2 };
  return { action: "WAIT" };
}`;
const allowedTimeframes = ['m1','m5','m15','m30','h1','h4','d1'];
export function parseStrategyConfig(code:string) {
  const match=code.match(/export\s+const\s+config\s*=\s*(\{[\s\S]*?\})\s*;/);
  if(!match) throw new Error('Missing static `export const config = { ... };` block.');
  let body=match[1].replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g,'$1"$2"$3').replace(/'/g,'"').replace(/,\s*([}\]])/g,'$1');
  let config:any; try{config=JSON.parse(body)}catch{throw new Error('Strategy config must contain only static JSON values.');}
  if(!Array.isArray(config.timeframes)||!config.timeframes.length)throw new Error('Add at least one timeframe in config.timeframes.');
  const tfs=[...new Set([...config.timeframes,config.executionTimeframe])];
  for(const tf of tfs)if(!allowedTimeframes.includes(tf))throw new Error(`Unsupported timeframe: ${tf}. Use ${allowedTimeframes.join(', ')}.`);
  if(!Number.isFinite(config.riskPercent)||config.riskPercent<=0||config.riskPercent>10)throw new Error('riskPercent must be between 0 and 10.');
  if(!Number.isFinite(config.riskReward)||config.riskReward<=0)throw new Error('riskReward must be a positive number.');
  return {...config,timeframes:tfs};
}
export function validateCandles(input:Candle[]) {
  const sorted=[...input].sort((a,b)=>a.time-b.time), out:Candle[]=[];let previous=-Infinity;
  for(const c of sorted){if(!Number.isFinite(c.time)||![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||c.high<c.low||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close))continue;if(c.time<=previous)continue;previous=c.time;out.push(c);}
  if(!out.length)throw new Error('No valid historical candles were returned.');return out;
}
