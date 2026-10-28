import type { MonetaryResult } from './monetary-backtest';

/** Only persist a cash result that the assumptions-based simulation actually produced. */
export function backtestMoneySummary(result: Pick<MonetaryResult, 'netProfit' | 'returnPercent'> | null) {
  if (!result || !Number.isFinite(result.netProfit) || !Number.isFinite(result.returnPercent)) return null;
  return { netProfit: result.netProfit, returnPercent: result.returnPercent, currency: 'ZAR' as const };
}
