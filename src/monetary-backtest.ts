import type { Candle, Side, Trade } from './types';

/** All prices are in the instrument quote currency; conversion is ZAR per quote unit. */
export type MonetaryAssumptions = {
  contractSize: number; minVolume: number; volumeStep: number; quoteToZar: number;
  spread: number; slippage: number; commissionPerLotZar: number; leverage?: number;
};
export type MonetaryTrade = Trade & {
  volume: number; intendedRisk: number; riskAtStop: number; pnlZar: number; equityAfter: number;
  spreadZar: number; slippageZar: number; commissionZar: number;
};
export type MonetaryResult = {
  startingBalance: number; endingBalance: number; netProfit: number; returnPercent: number;
  maxDrawdown: number; maxDrawdownPercent: number; trades: MonetaryTrade[];
  rejected: { time: number; reason: string }[]; equity: { time: number; value: number; tradeId?: number }[];
  assumptions: MonetaryAssumptions; riskPercent: number;
};

export function validateMonetaryAssumptions(a: MonetaryAssumptions): string | null {
  for (const key of ['contractSize', 'minVolume', 'volumeStep', 'quoteToZar'] as const)
    if (!Number.isFinite(a[key]) || a[key] <= 0) return `Enter a positive ${key}.`;
  for (const key of ['spread', 'slippage', 'commissionPerLotZar'] as const)
    if (!Number.isFinite(a[key]) || a[key] < 0) return `Enter a non-negative ${key}.`;
  if (a.leverage !== undefined && (!Number.isFinite(a.leverage) || a.leverage <= 0)) return 'Leverage must be positive.';
  if (!Number.isFinite(a.contractSize*a.quoteToZar)) return 'Contract size and currency conversion are too large.';
  return null;
}

/** Independent simulation: replays the same signals so rejected entries do not block later signals. */
export function simulateMoney(candles: Candle[], decisions: any[], startingBalance: number, riskPercent: number, a: MonetaryAssumptions): MonetaryResult {
  const invalid = validateMonetaryAssumptions(a);
  if (invalid) throw new Error(invalid);
  if (!Number.isFinite(startingBalance) || startingBalance <= 0 || !Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 10) throw new Error('Starting balance and risk percentage must be positive.');
  const valuePerUnit = a.contractSize * a.quoteToZar;
  let equity = startingBalance, peak = startingBalance, maxDrawdown = 0, maxDrawdownPercent = 0;
  const trades: MonetaryTrade[] = [], rejected: MonetaryResult['rejected'] = [];
  const curve: MonetaryResult['equity'] = candles.length ? [{ time: candles[0].time, value: equity }] : [];
  function observe(value:number) { peak=Math.max(peak,value); const dd=peak-value; maxDrawdown=Math.max(maxDrawdown,dd); maxDrawdownPercent=Math.max(maxDrawdownPercent,peak>0?dd/peak*100:0); }
  type Position = { side: Side; entryTime: number; entry: number; midEntry: number; stop: number; target: number; volume: number; intendedRisk: number; riskDistance: number };
  let position: Position | null = null;
  function close(pos: Position, candle: Candle, midExit: number, reason: Trade['reason']) {
    const direction = pos.side === 'LONG' ? 1 : -1;
    const exit = midExit - direction * a.slippage;
    const commissionZar = pos.volume * a.commissionPerLotZar;
    const pnlZar = (exit - pos.entry) * direction * pos.volume * valuePerUnit - commissionZar;
    const pnl = (exit - pos.entry) * direction / pos.riskDistance - commissionZar / (pos.riskDistance * pos.volume * valuePerUnit);
    equity += pnlZar;
    const trade: MonetaryTrade = { id: trades.length + 1, side: pos.side, entryTime: pos.entryTime, exitTime: candle.time, entry: pos.entry, exit, stop: pos.stop, target: pos.target, reason, pnl, volume: pos.volume, intendedRisk: pos.intendedRisk, riskAtStop: (pos.riskDistance + a.slippage) * pos.volume * valuePerUnit + commissionZar, pnlZar, equityAfter: equity, spreadZar: a.spread * pos.volume * valuePerUnit, slippageZar: 2 * a.slippage * pos.volume * valuePerUnit, commissionZar };
    trades.push(trade); curve.push({ time: candle.time, value: equity, tradeId: trade.id });
    observe(equity);
  }
  function exitFor(pos: Position, c: Candle): { price: number; reason: Trade['reason'] } | null {
    if (pos.side === 'LONG') {
      if (c.low <= pos.stop) return { price: Math.min(c.open, pos.stop), reason: 'stop' };
      if (c.high >= pos.target) return { price: pos.target, reason: 'target' };
    } else {
      if (c.high >= pos.stop) return { price: Math.max(c.open, pos.stop), reason: 'stop' };
      if (c.low <= pos.target) return { price: pos.target, reason: 'target' };
    }
    return null;
  }
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]; let closed = false;
    if (position) { const outcome = exitFor(position, c); if (outcome) { close(position, c, outcome.price, outcome.reason); position = null; closed = true; } }
    if (i > 0 && !position && !closed) {
      const signal = decisions[i - 1], action = signal?.action;
      if (action === 'BUY' || action === 'SELL') {
        const long = action === 'BUY', direction = long ? 1 : -1, stop = Number(signal.stopLoss), target = Number(signal.takeProfit);
        const entry = c.open + direction * (a.spread + a.slippage);
        const signalClose = candles[i - 1].close;
        const valid = Number.isFinite(stop) && Number.isFinite(target) && stop > 0 && target > 0 && (long ? stop < signalClose && target > signalClose && stop < entry && entry < target : stop > signalClose && target < signalClose && target < entry && entry < stop);
        if (!valid) rejected.push({time: c.time, reason: 'Invalid stop/target or next fill outside levels'});
        else {
          const intendedRisk = Math.max(0, equity) * (riskPercent / 100);
          const lossPerLot = (Math.abs(entry - stop) + a.slippage) * valuePerUnit + a.commissionPerLotZar;
          const affordable = intendedRisk / lossPerLot;
          const volume = affordable + 1e-10 < a.minVolume ? 0 : a.minVolume + Math.floor((affordable - a.minVolume) / a.volumeStep + 1e-10) * a.volumeStep;
          const margin = a.leverage ? Math.abs(entry) * valuePerUnit * volume / a.leverage : 0;
          if (volume + 1e-10 < a.minVolume) rejected.push({time: c.time, reason: 'Minimum volume exceeds the risk budget'});
          else if (a.leverage && margin > equity + 1e-8) rejected.push({time: c.time, reason: 'Insufficient available margin'});
          else position = { side: long ? 'LONG' : 'SHORT', entryTime: c.time, entry, midEntry: c.open, stop, target, volume, intendedRisk, riskDistance: Math.abs(entry - stop) };
        }
      }
    }
    if (position && position.entryTime === c.time) { const outcome = exitFor(position, c); if (outcome) { close(position, c, outcome.price, outcome.reason); position = null; } }
    if (position) { const direction=position.side==='LONG'?1:-1; const markedExit=c.close-direction*a.slippage; observe(equity+(markedExit-position.entry)*direction*position.volume*valuePerUnit-position.volume*a.commissionPerLotZar); }
  }
  if (position && candles.length) close(position, candles[candles.length - 1], candles[candles.length - 1].close, 'end');
  return { startingBalance, endingBalance: equity, netProfit: equity - startingBalance, returnPercent: (equity - startingBalance) / startingBalance * 100, maxDrawdown, maxDrawdownPercent, trades, rejected, equity: curve, assumptions: { ...a }, riskPercent };
}
