import {Activity,ArrowDownUp,Sparkles} from 'lucide-react';
import type {MarketReport} from '../code-analysis';

const num=(n:number|null,d=2)=>n===null||!Number.isFinite(n)?'—':n.toLocaleString('en-US',{maximumFractionDigits:d});
export function AnalysisChatCard({report}:{report:MarketReport}){
 const bearish=report.findings.filter(f=>f.kind==='bearish sweep').length,bullish=report.findings.filter(f=>f.kind==='bullish sweep').length;
 return <section className="tv-analysis-chat-card" aria-label={'Market analysis '+report.asset}>
  <header><Activity size={17}/><strong>{report.kind==='liquidity_sweeps'?'Liquidity sweeps':'Volatility profile'}</strong><small>{report.asset} · {report.timeframe.toUpperCase()}</small></header>
  <div className="tv-analysis-window">{new Date(report.from).toLocaleString()} — {new Date(report.to).toLocaleString()} <span>UTC source window</span></div>
  <div className="tv-analysis-metrics"><div><small>Completed bars</small><strong>{report.bars.toLocaleString()}</strong></div><div><small>Candidate sweeps</small><strong>{report.kind==='liquidity_sweeps'?report.findings.length:'—'}</strong></div><div><small>ATR14</small><strong>{num(report.atr14,5)}</strong></div><div><small>ATR %</small><strong>{num(report.atrPercent,3)}%</strong></div></div>
  {report.kind==='liquidity_sweeps'&&<p><ArrowDownUp size={14}/> {bullish} bullish and {bearish} bearish sweep candidates (5-bar lookback unless specified).</p>}
  <p><Sparkles size={14}/> {report.regime}. {report.explanation}</p>
  {report.gaps>0&&<p role="status">The data contains {report.gaps} interval gaps; counts may underrepresent activity.</p>}
  {report.kind==='liquidity_sweeps'&&!!report.findings.length&&<details><summary>Inspect detections ({report.findings.length} shown)</summary><div className="tv-analysis-findings">{report.findings.slice(-35).reverse().map((f,i)=><div key={i}><span>{new Date(f.time*1000).toLocaleString()}</span><strong>{f.kind}</strong><span>{num(f.price,5)} vs {num(f.level,5)}</span></div>)}</div></details>}
  <footer>Read-only analysis of available historical candles. No broker order was submitted. Unverified news and chart gaps are excluded.</footer>
 </section>;
}
