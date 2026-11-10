import './trading-desk-card.css';
type Loss={accountId:string;tradeId:string;botId:string|null;side:string;symbol:string;pnl:number;reason:string;closedAtUTC:string|null};
export type DeskView={available?:boolean;day?:string;accountsChecked?:number;closedTradesToday?:number;reportedPnl?:number;
 losses?:number;wins?:number;matchedRobotTrades?:number;unattributedTrades?:number;recentLosses?:Loss[];partial?:boolean;
 reason?:string;byRobot?:{botId:string;trades:number;losses:number;pnl:number}[]};
const money=(n:number|undefined)=>typeof n==='number'&&Number.isFinite(n)?(n<0?'−':'')+'$'+Math.abs(n).toFixed(2):'—';
const localTime=(utc:string|null)=>utc&&Number.isFinite(Date.parse(utc))?
 new Date(Date.parse(utc)+7200000).toISOString().slice(11,16)+' SAST':'Time unknown';
export function TradingDeskCard({report}:{report:DeskView}){
 if(!report.available)return <section className="tv-desk-card" aria-label="Broker data unavailable">
  <header><strong>Live trading desk</strong><span>Unable to verify</span></header><p>{report.reason||'No authenticated broker result was returned.'}</p>
 </section>;
 return <section className="tv-desk-card" aria-label="PropDAO real trading activity">
  <header><strong>Today's PropDAO trading desk</strong><span>{report.day} · SAST</span></header>
  <p className="tv-desk-note">Authenticated broker history across {report.accountsChecked??0} account(s)</p>
  <div className="tv-desk-metrics">
   <div><small>Broker-reported P/L</small><strong>{money(report.reportedPnl)}</strong></div>
   <div><small>Closed trades</small><strong>{report.closedTradesToday??'—'}</strong></div>
   <div><small>Wins</small><strong>{report.wins??'—'}</strong></div>
   <div><small>Losses</small><strong>{report.losses??'—'}</strong></div>
  </div>
  <p className="tv-desk-note">{report.matchedRobotTrades??0} matched to robots by exact broker identity; {report.unattributedTrades??0} unattributed.</p>
  {!!report.byRobot?.length&&<details><summary>Per-robot evidence</summary><div className="tv-desk-list">
   {report.byRobot.slice(0,8).map(x=><div key={x.botId}><span>{x.botId==='unattributed'?'Unattributed account activity':x.botId}</span><span>{x.trades} trades · {x.losses} losses · {money(x.pnl)}</span></div>)}
  </div></details>}
  {!!report.recentLosses?.length&&<details><summary>Recent losing fills</summary><div className="tv-desk-list">
   {report.recentLosses.slice(0,12).map(x=><div key={x.accountId+':'+x.tradeId}><span>{x.symbol} {x.side} · {localTime(x.closedAtUTC)}</span><strong>{money(x.pnl)}</strong>
    <small>{x.reason||'Exit unspecified'} · {x.botId||'Robot unknown'}</small></div>)}
  </div></details>}
  {report.partial&&<p className="tv-desk-warning">Partial coverage: some records, Worker events, or historical trades may be missing.</p>}
  <p className="tv-desk-note">Whether broker P/L already includes fees is unverified. An SL exit does not establish the cause of the loss.</p>
 </section>;
}
