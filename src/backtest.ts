import type { Candle, Result } from './types';
import { parseStrategyConfig, validateCandles } from './strategy';
import { simulate } from './engine';
import { STRATEGY_RUNTIME_SOURCE } from './strategy-runtime';

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

const workerProgram=STRATEGY_RUNTIME_SOURCE.replace('export async function','async function')+String.raw`
onmessage = async event => {
 try {
  const {code,config,datasets}=event.data;
  const js=code.replace(/export\s+const\s+config\s*=/,'const config =').replace(/export\s+function\s+onCandle\s*\(/,'function onCandle(');
  const decisions=await evaluate((Date,Math,performance)=>Function('Date','Math','performance','"use strict";'+js+';return {config,onCandle};')(Date,Math,performance),code,datasets,config);
  postMessage({type:'done',decisions});
 }catch(error){postMessage({type:'error',message:String(error&&error.message||error)});}
};`;
// The opaque frame denies origin access and network. Its dedicated Worker keeps
// the UI responsive and is terminated when the frame is removed on timeout.
const frame=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'">
<script>
let worker;
onmessage=event=>{if(event.data.type!=='run')return;try{
 worker?.terminate();const url=URL.createObjectURL(new Blob([${JSON.stringify(workerProgram)}],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);
 worker.onmessage=e=>parent.postMessage(e.data,'*');worker.onerror=()=>parent.postMessage({type:'error',message:'Isolated strategy worker failed.'},'*');worker.postMessage(event.data);
}catch(e){parent.postMessage({type:'error',message:String(e.message||e)},'*')}};
onunload=()=>worker?.terminate();
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
    `Costs assumed · spread ${config.backtestSpread||0} price units · slippage ${config.backtestSlippage||0} per fill · commission ${config.backtestCommissionR||0}R per trade`,
    'Running deterministic isolated strategy worker…',
  ];
  const started = performance.now();
  const decisions = await runInSandbox(code, candles, config, datasets, signal);
  const result = simulate(candles, decisions, startingR,{spread:config.backtestSpread||0,slippage:config.backtestSlippage||0,commissionR:config.backtestCommissionR||0});
  logs.push(...result.logs);
  for (const trade of result.trades.slice(0, 30)) {
    logs.push(`#${trade.id} ${trade.side} · ${trade.reason} · ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}R`);
  }
  if (result.trades.length > 30) logs.push(`${result.trades.length - 30} additional trade events available in the trade list.`);
  logs.push(`Backtest complete · ${result.trades.length} trades · ${(performance.now() - started).toFixed(0)} ms`);
  return { ...result, logs };
}
