import './trading-desk-card.css';
type Snapshot={available?:boolean;symbol?:string;timeframe?:string;source?:string;asOf?:string;
 close?:number;atr14?:number;atrPercent?:number;ema9?:number|null;ema21?:number|null;
 rsi14?:number|null;volatility?:string;reason?:string;gaps?:number};
const fmt=(x:number|undefined|null,d=2)=>typeof x==='number'&&Number.isFinite(x)?x.toFixed(d):'—';
export function MarketContextCard({report}:{report:Snapshot}){
 return <section className="tv-desk-card" aria-label="Independent reference market evidence">
  <header><strong>Market · {report.symbol||'Instrument not verified'}</strong><span>{report.timeframe||'—'}</span></header>
  {report.available?<><p className="tv-desk-note">{report.source||'Reference provider'} · {report.asOf||'Time unknown'}</p>
   <div className="tv-desk-metrics">
    <div><small>Last close</small><strong>{fmt(report.close)}</strong></div>
    <div><small>ATR14</small><strong>{fmt(report.atr14)} ({fmt(report.atrPercent)}%)</strong></div>
    <div><small>RSI14</small><strong>{fmt(report.rsi14,1)}</strong></div>
    <div><small>Volatility</small><strong>{report.volatility||'Unknown'}</strong></div>
   </div><p className="tv-desk-note">EMA9: {fmt(report.ema9)} · EMA21: {fmt(report.ema21)} · Gaps: {report.gaps??'—'}</p></>:
   <p className="tv-desk-warning">{report.reason||'Completed-candle market evidence unavailable'}</p>}
  <p className="tv-desk-note">Completed reference candles only — not PropDAO executable bid/ask, live broker fills, or the robot's internal filter checks.</p>
 </section>;
}
