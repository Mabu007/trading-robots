import type { Candle, Result } from './types';
import { parseStrategyConfig, validateCandles } from './strategy';
import { simulate } from './engine';

export function isBarComplete(barTime: number, barTf: string, executionTime: number, executionTf: string) {
  // Keep this function self-contained: runInSandbox serializes it into a
  // separate iframe where module-level bindings do not exist.
  const durations: Record<string, number> = {
    m1: 60_000, m5: 300_000, m15: 900_000, m30: 1_800_000,
    h1: 3_600_000, h4: 14_400_000, d1: 86_400_000,
  };
  const barDuration = durations[barTf];
  const executionDuration = durations[executionTf];
  return Boolean(barDuration && executionDuration && barTime * 1000 + barDuration <= executionTime * 1000 + executionDuration);
}

const frame = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; style-src 'none'; form-action 'none'; base-uri 'none'">
<script>
const isBarComplete = ${isBarComplete.toString()};
onmessage = event => {
  if (event.data.type !== 'run') return;
  try {
    const { code, candles, config, datasets } = event.data;
    const durations = { m1: 60000, m5: 300000, m15: 900000, m30: 1800000, h1: 3600000, h4: 14400000, d1: 86400000 };
    let clock = candles[0].time * 1000;
    const NativeDate = Date;
    class SimulatedDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    }
    let seed = 2166136261;
    for (const char of code + ':' + candles[0].time) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
    const strategyMath = Object.create(Math);
    strategyMath.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const simulatedPerformance = Object.freeze({ now: () => clock });
    globalThis.Date = SimulatedDate;
    globalThis.Math = strategyMath;
    try { Object.defineProperty(globalThis, 'performance', { value: simulatedPerformance, configurable: true }); } catch {}

    const js = code
      .replace(/export\\s+const\\s+config\\s*=/, 'const config =')
      .replace(/export\\s+function\\s+onCandle\\s*\\(/, 'function onCandle(');
    const strategy = Function('Date', 'Math', 'performance', '"use strict";' + js + ';return { config, onCandle };')(SimulatedDate, strategyMath, simulatedPerformance);
    if (typeof strategy.onCandle !== 'function') throw Error('Missing onCandle(ctx)');
    const cursors = {}, visibleBars = {}, decisions = [];
    for (const tf of config.timeframes) {
      cursors[tf] = 0;
      visibleBars[tf] = [];
      datasets[tf].forEach(Object.freeze);
    }
    for (let i = 0; i < candles.length; i++) {
      const current = Object.freeze(candles[i]);
      clock = (current.time + durations[config.executionTimeframe]) * 1000;
      const timeframes = {};
      for (const tf of config.timeframes) {
        while (cursors[tf] < datasets[tf].length && isBarComplete(datasets[tf][cursors[tf]].time, tf, current.time, config.executionTimeframe)) {
          visibleBars[tf].push(datasets[tf][cursors[tf]++]);
        }
        timeframes[tf] = Object.freeze(visibleBars[tf].slice(-1000));
      }
      const decision = strategy.onCandle({ candle: current, index: i, timeframes: Object.freeze(timeframes) });
      if (!decision || !['BUY', 'SELL', 'WAIT'].includes(decision.action)) {
        throw Error('Invalid strategy decision at candle ' + i + ': expected BUY, SELL, or WAIT');
      }
      decisions.push({ action: decision.action, stopLoss: decision.stopLoss, takeProfit: decision.takeProfit });
    }
    parent.postMessage({ type: 'done', decisions }, '*');
  } catch (error) {
    parent.postMessage({ type: 'error', message: String(error && error.message || error) }, '*');
  }
};
</script>`;

function runInSandbox(
  code: string,
  candles: Candle[],
  config: Record<string, any>,
  datasets: Record<string, Candle[]>,
  signal?: AbortSignal,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Backtest cancelled by user.'));

    const iframe = document.createElement('iframe');
    iframe.sandbox.add('allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.display = 'none';
    iframe.srcdoc = frame;
    let finished = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      iframe.remove();
    };
    const finishWithError = (message: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      cleanup();
      reject(new Error(message));
    };
    const onAbort = () => finishWithError('Backtest cancelled by user.');
    const timeout = window.setTimeout(() => finishWithError('Strategy execution exceeded 8 seconds and was stopped.'), 8_000);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.type === 'done') {
        finished = true;
        clearTimeout(timeout);
        cleanup();
        resolve(event.data.decisions);
      } else if (event.data?.type === 'error') {
        finishWithError(String(event.data.message || 'Strategy execution failed.'));
      }
    };

    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    iframe.onload = () => iframe.contentWindow?.postMessage({ type: 'run', code, candles, config, datasets }, '*');
    document.body.appendChild(iframe);
  });
}

export async function runBacktest(
  code: string,
  data: Candle[] | Record<string, Candle[]>,
  startingR = 0,
  signal?: AbortSignal,
): Promise<Result> {
  if (signal?.aborted) throw new Error('Backtest cancelled by user.');
  const config = parseStrategyConfig(code);
  if (!/export\s+function\s+onCandle\s*\(/.test(code)) {
    throw new Error('Missing required export `onCandle(ctx)`.');
  }

  const datasets: Record<string, Candle[]> = Array.isArray(data)
    ? { [config.executionTimeframe]: validateCandles(data) }
    : Object.fromEntries(Object.entries(data).map(([tf, rows]) => [tf, validateCandles(rows)]));
  for (const timeframe of config.timeframes) {
    if (!datasets[timeframe]?.length) throw new Error(`No candles loaded for ${timeframe}.`);
  }
  const candles = datasets[config.executionTimeframe];
  if (!candles || candles.length < 2) throw new Error('At least two execution-timeframe candles are required.');

  const logs = [
    `Strategy validated · ${config.timeframes.join(', ')}`,
    `Loaded ${candles.length.toLocaleString()} execution candles`,
    'Running deterministic isolated strategy…',
  ];
  const started = performance.now();
  const decisions = await runInSandbox(code, candles, config, datasets, signal);
  const result = simulate(candles, decisions, startingR);
  logs.push(...result.logs);
  for (const trade of result.trades.slice(0, 30)) {
    logs.push(`#${trade.id} ${trade.side} · ${trade.reason} · ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}R`);
  }
  if (result.trades.length > 30) logs.push(`${result.trades.length - 30} additional trade events available in the trade list.`);
  logs.push(`Backtest complete · ${result.trades.length} trades · ${(performance.now() - started).toFixed(0)} ms`);
  return { ...result, logs };
}
