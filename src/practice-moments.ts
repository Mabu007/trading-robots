import type {ReplayBar} from './market-replay-engine';

/** A sweep is confirmed only when the completed minute closes back inside the
 * preceding 20 consecutive minutes' range. This is one explicit definition,
 * not a claim that every detected event is a profitable setup. */
export function findSweepMoments(bars: ReplayBar[]): number[] {
 const result: number[] = [];
 for (let i = 20; i < bars.length - 1; i++) {
  const window = bars.slice(i - 20, i + 1);
  if (window.some((bar, n) => n > 0 && bar.time - window[n - 1].time !== 60)) continue;
  const preceding = window.slice(0, 20);
  const high = Math.max(...preceding.map(bar => bar.high));
  const low = Math.min(...preceding.map(bar => bar.low));
  const current = bars[i];
  if ((current.high > high && current.close < high) || (current.low < low && current.close > low)) result.push(i);
 }
 return result;
}
