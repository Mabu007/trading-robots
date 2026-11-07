import {Activity, ChevronDown, Sparkles} from 'lucide-react';

export type BacktestCardData={
 botId:string;name:string;asset:string;venue:string;from:string;to:string;completedAt:string;
 metrics:{netReturn?:number;winRate?:number;profitFactor?:number;maxDrawdown?:number;trades?:number;wins?:number;losses?:number};
 trades:{id:number;side:string;entryTime:number;exitTime:number;entry:number;exit:number;pnl:number;reason:string}[];
 candleCount:number;source?:string;
};
const fmt=(value:unknown,unit='')=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:2})+unit:'—';
export function BacktestChatCard({data,onInspect,onDeploy}:{data:BacktestCardData;onInspect?:(tradeId:number)=>void;onDeploy?:()=>void}){
 const m=data.metrics;
 return <section className="tv-backtest-chat-card" aria-label={'Backtest results for '+data.name}>
  <header><span><Activity size={17}/> Backtest completed</span><small>{data.completedAt?new Date(data.completedAt).toLocaleString():'Saved result'}</small></header>
  <div className="tv-backtest-chat-caption"><strong>{data.name}</strong><span>{data.asset} · {data.from} to {data.to} · {data.venue}</span></div>
  <div className="tv-backtest-chat-metrics">
   <div><small>Net result</small><strong className={typeof m.netReturn==='number'&&m.netReturn<0?'loss':'gain'}>{fmt(m.netReturn,'R')}</strong></div>
   <div><small>Trades</small><strong>{fmt(m.trades)}</strong></div>
   <div><small>Win rate</small><strong>{fmt(typeof m.winRate==='number'?m.winRate*100:null,'%')}</strong></div>
   <div><small>Profit factor</small><strong>{fmt(m.profitFactor)}</strong></div>
   <div><small>Max drawdown</small><strong>{fmt(m.maxDrawdown,'R')}</strong></div>
  </div>
  <p className="tv-backtest-chat-note">Historical simulation, not a verified live fill. {data.candleCount.toLocaleString()} execution candles. {data.source||'Market history'}.</p>
  <details className="tv-backtest-chat-trades"><summary>Inspect backtest trades <ChevronDown size={15}/></summary><div className="tv-backtest-chat-table"><table><thead><tr><th>#</th><th>Side</th><th>Entry</th><th>Exit</th><th>Result</th><th>Inspect</th></tr></thead><tbody>{data.trades.map(t=><tr key={t.id}><td>{t.id}</td><td>{t.side}</td><td>{fmt(t.entry)}</td><td>{fmt(t.exit)}</td><td className={t.pnl<0?'loss':'gain'}>{fmt(t.pnl,'R')}</td><td>{onInspect?<button type="button" onClick={()=>onInspect(t.id)} aria-label={'Ask AI to inspect trade '+t.id}><Sparkles size={14}/></button>:'—'}</td></tr>)}</tbody></table></div>{!data.trades.length&&<p>No trades were opened.</p>}</details>
  {onDeploy&&<div className="vibes-evidence-actions"><button type="button" onClick={onDeploy}>Prepare deployment</button></div>}
 </section>;
}
