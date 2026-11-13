import {TF_SECONDS} from '../shared/trading';
import type {Venue} from '../shared/venues';
import {readApiJson} from './api';
import {runBacktest} from './backtest';
import {historicalData} from './history-cache';
import {parseStrategyConfig, validateStrategySyntax} from './strategy';
import type {Candle, Result} from './types';

export type StrategyRun = {
  venue: Venue;
  asset: string;
  strategyCode: string;
  from: string;
  to: string;
  result: Result;
  logs: string[];
  savedAt: string;
  riskPercent: number;
  sparseSignals: {index: number; action: 'BUY' | 'SELL'; stopLoss?: number; takeProfit?: number}[];
};

export function validateWorkbenchSource(code: string) {
  if (code.length > 180_000) throw Error('Strategy code must be under 180,000 characters.');
  const config = parseStrategyConfig(code);
  if (!/export\s+function\s+onCandle\s*\(/.test(code)) throw Error('Add the required export function onCandle(ctx).');
  validateStrategySyntax(code);
  return config;
}

export async function strategyMarkets(venue: Venue, signal: AbortSignal) {
  const endpoint = '/api/venues/research/markets';
  const response = await fetch(endpoint, {signal});
  const {markets} = await readApiJson<{markets: {symbol: string}[]}>(response, 'Venue markets');
  return markets.map(market => market.symbol);
}

export function backtestRange(from: string, to: string, timeframes: string[], now = Date.now()) {
  const start = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z') + 86_400_000;
  const valid = (value: string, ms: number) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
  if (!valid(from, start) || !valid(to, end - 86_400_000) || start >= end || end > now) {
    throw Error('Choose a valid range of completed UTC dates.');
  }
  if (timeframes.some(tf => (end - start) / (TF_SECONDS[tf] * 1000) + 500 > 50_000)) {
    throw Error('This range exceeds 50,000 candles for one of the strategy timeframes. Choose a shorter range.');
  }
  return {start, end};
}

export async function simulateWorkbench(input: {venue: Venue; asset: string; strategyCode: string; from: string; to: string},
  signal: AbortSignal, onProgress: (message: string) => void): Promise<StrategyRun> {
  const config = validateWorkbenchSource(input.strategyCode);
  const {start, end} = backtestRange(input.from, input.to, config.timeframes);
  if(!['XAUUSD','GOLDUSDC'].includes(input.asset))throw Error('Dukascopy strategy backtesting currently supports Gold/XAUUSD.');
  const candles: Record<string, Candle[]> = {};
  const sources = new Set<string>();
  const notes: string[] = [];
  for (const timeframe of config.timeframes) {
    onProgress(`Loading ${input.asset} ${timeframe.toUpperCase()} candles…`);
    const data = await historicalData({
      venue: 'research', asset: 'XAUUSD', timeframe,
      from: new Date(start - 200 * TF_SECONDS[timeframe] * 1000).toISOString(),
      to: new Date(end - 1000).toISOString(),
    }, signal, () => onProgress('Market data rate limit reached. Waiting to retry…'), (done,total)=>onProgress(`Loading ${timeframe.toUpperCase()} history · ${done} of ${total} days…`));
    candles[timeframe] = data.candles;
    if (data.source) sources.add(data.source);
    const warmup = data.candles.filter(candle => candle.time * 1000 < start).length;
    if (warmup < 200) notes.push(`${timeframe.toUpperCase()} warm-up had ${warmup} of 200 requested candles.`);
    if (data.observedGaps) notes.push(`${timeframe.toUpperCase()} had ${data.observedGaps} gaps, which may include market closures.`);
  }
  onProgress('Simulating the strategy on historical candles…');
  const {decisions, logs, ...result} = await runBacktest(input.strategyCode, candles, 0, signal, start / 1000);
  return {
    ...input, result: {...result, logs: [], source: [...sources].join(' + ') || 'Market history', timeframe: config.executionTimeframe},
    logs: [...notes, ...logs], savedAt: new Date().toISOString(), riskPercent: config.riskPercent,
    sparseSignals: decisions.flatMap((decision, index) => decision.action === 'BUY' || decision.action === 'SELL'
      ? [{index, action: decision.action, stopLoss: decision.stopLoss, takeProfit: decision.takeProfit}] : []),
  };
}

export function workbenchDeployable(venue: Venue) {
  return venue === 'propdao' || venue === 'valr';
}
