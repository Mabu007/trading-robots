/** Reject a next-open fill that turns an ordinary target into an inflated R-multiple.
 * No target or stop is silently rewritten: the trading signal is skipped instead.
 * A strategy's configured riskReward caps excessive theoretical winners, while
 * the signal-close multiple protects against favourable gap-through fills.
 */
export function nextOpenRewardGuard(
  signalClose: number,
  entry: number,
  stop: number,
  target: number,
  side: 'BUY' | 'SELL',
  configuredRR?: number,
): string | null {
  if (![signalClose, entry, stop, target].every(v => Number.isFinite(v) && v > 0))
    return 'Invalid entry, stop, or target';
  const isLong = side === 'BUY';
  if (isLong ? !(stop < signalClose && stop < entry && signalClose < target && entry < target)
             : !(stop > signalClose && stop > entry && signalClose > target && entry > target))
    return 'Stop/target no longer bracket the signal and next-candle fill';
  const signalRisk = Math.abs(signalClose - stop);
  const fillRisk = Math.abs(entry - stop);
  if (signalRisk <= 0 || fillRisk <= 0) return 'Zero risk distance';
  const signaledReward = Math.abs(target - signalClose) / signalRisk;
  const effectiveReward = Math.abs(target - entry) / fillRisk;
  if (!Number.isFinite(signaledReward) || !Number.isFinite(effectiveReward)) return 'Invalid R multiple';
  // The same static target becomes unrealistically large in R if the next open
  // lands very near the stop. Skip rather than crediting an outlier win.
  if (effectiveReward > signaledReward * 1.25 + 1e-8)
    return `Entry moved too close to stop: signal ${signaledReward.toFixed(2)}R, fill ${effectiveReward.toFixed(2)}R`;
  if (Number.isFinite(configuredRR) && (configuredRR as number) > 0 &&
      effectiveReward > (configuredRR as number) * 1.5 + 1e-8)
    return `Target reward ${effectiveReward.toFixed(2)}R exceeds configured riskReward ${(configuredRR as number).toFixed(2)}R (50% tolerance)`;
  return null;
}
