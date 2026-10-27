// This exact module runs inside the browser sandbox and the isolated live Worker.
// It has no application bindings, storage, secrets, or broker operations.
export const STRATEGY_RUNTIME_SOURCE = String.raw`
export async function evaluate(loadStrategy, code, datasets, config) {
  const durations = { m1:60, m5:300, m15:900, m30:1800, h1:3600, h4:14400, d1:86400 };
  const candles = datasets[config.executionTimeframe];
  if (!candles || !candles.length) throw Error('No execution candles');
  let clock = candles[0].time * 1000;
  const NativeDate = Date;
  class StrategyDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  let seed = 2166136261;
  for (const char of code + ':' + candles[0].time) seed = Math.imul(seed ^ char.charCodeAt(0),16777619) >>> 0;
  const strategyMath = Object.create(Math);
  strategyMath.random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const strategyPerformance = Object.freeze({now: () => clock});
  globalThis.Date = StrategyDate; globalThis.Math = strategyMath;
  try { Object.defineProperty(globalThis,'performance',{value:strategyPerformance,configurable:true}); } catch {}
  const strategy = await loadStrategy(StrategyDate,strategyMath,strategyPerformance);
  if (typeof strategy.onCandle !== 'function') throw Error('Missing onCandle(ctx)');
  const cursors = {}, visible = {}, decisions = [];
  for (const tf of config.timeframes) { if (!durations[tf] || !datasets[tf]?.length) throw Error('Missing timeframe ' + tf); cursors[tf] = 0; visible[tf] = []; datasets[tf].forEach(Object.freeze); }
  for (let i=0;i<candles.length;i++) {
    const current = Object.freeze(candles[i]); clock = (current.time + durations[config.executionTimeframe]) * 1000;
    const timeframes = {};
    for (const tf of config.timeframes) {
      while (cursors[tf] < datasets[tf].length && datasets[tf][cursors[tf]].time + durations[tf] <= clock/1000) visible[tf].push(datasets[tf][cursors[tf]++]);
      timeframes[tf] = Object.freeze(visible[tf].slice(-1000));
    }
    const decision = strategy.onCandle(Object.freeze({candle:current,index:i,timeframes:Object.freeze(timeframes)}));
    if (!decision || !['BUY','SELL','WAIT'].includes(decision.action)) throw Error('Invalid strategy decision at candle ' + i);
    decisions.push({action:decision.action,stopLoss:decision.stopLoss,takeProfit:decision.takeProfit,reason:typeof decision.reason==='string'?decision.reason.slice(0,300):''});
  }
  return decisions;
}`;
