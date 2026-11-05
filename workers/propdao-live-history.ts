// Live strategy lookback is independent of the 120 candles displayed on the chart.
// Keep requests below Hyperliquid's latest-5000-candles limit and the QuickJS
// evaluation budget; no synthetic bars are introduced for market closures.
export const PROPDAO_LIVE_HISTORY_BARS:Readonly<Record<string,number>>=Object.freeze({
 m1:480,m5:420,m15:360,m30:300,h1:300,h4:240,d1:210
});
export function propDAOLiveHistoryBars(tf:string):number{
 const n=PROPDAO_LIVE_HISTORY_BARS[tf];
 if(!Number.isInteger(n)||n<210||n>1000)throw Error('Unsupported live history timeframe');
 return n;
}
export type PropDAOHistoryStats={requested:number;received:number;oldest:number|null;newest:number|null;recentGap:boolean;ready:boolean};
export function propDAOLiveHistoryStats(tf:string,rows:{time:number}[],at:number):PropDAOHistoryStats{
 const duration:Record<string,number>={m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400,d1:86400};
 const seconds=duration[tf],requested=propDAOLiveHistoryBars(tf);
 if(!Number.isFinite(at)||!seconds)throw Error('Invalid history diagnostic window');
 const newest=rows.at(-1)?.time??null,oldest=rows[0]?.time??null;
 const recentGap=rows.length>1&&rows[rows.length-1].time-rows[rows.length-2].time!==seconds;
 return {requested,received:rows.length,oldest,newest,recentGap,
  ready:rows.length>=30&&newest!==null&&newest+seconds===Math.floor(at/seconds)*seconds&&!recentGap};
}
export function propDAOLiveRetryAt(nowMs:number,closedAtSeconds:number,transient:boolean):number|null{
 const elapsed=nowMs-closedAtSeconds*1000;
 if(!transient||!Number.isFinite(elapsed)||elapsed<0||elapsed>=20000)return null;
 return nowMs+Math.min(8000,Math.max(1000,22000-elapsed));
}
