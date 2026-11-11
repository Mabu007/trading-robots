import './trading-desk-card.css';
type Loss={accountId:string;tradeId:string;botId:string|null;side:string;symbol:string;pnl:number;reason:string;closedAtUTC:string|null};
export type DeskView={available?:boolean;day?:string;accountsChecked?:number;closedTradesToday?:number;reportedPnl?:number;
 losses?:number;wins?:number;matchedRobotTrades?:number;probableRobotTrades?:number;
 conflictingRobotTrades?:number;unattributedTrades?:number;recentLosses?:Loss[];partial?:boolean;
 reason?:string;byRobot?:{accountId?:string;botId:string;grantId?:string|null;trades:number;losses:number;pnl:number;verified?:number;probable?:number}[]};
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
  <p className="tv-desk-note">{report.matchedRobotTrades??0} verified robot links · {report.probableRobotTrades??0} probable links · {report.unattributedTrades??0} unlinked{report.conflictingRobotTrades?' · '+report.conflictingRobotTrades+' conflicts':''}.</p>
  {!!report.byRobot?.length&&<details><summary>Attribution evidence (not all robot-confirmed)</summary><div className="tv-desk-list">
   {report.byRobot.slice(0,8).map(x=><div key={x.botId}><span>{x.botId==='unattributed'?'Unattributed account activity':x.botId} · {x.accountId||'Account unknown'}{x.grantId?' · revision '+x.grantId.slice(0,8):''}</span><span>{x.verified??0} verified · {x.probable??0} probable · {x.trades} grouped · {money(x.pnl)} account-reported</span></div>)}
  </div></details>}
  {!!report.recentLosses?.length&&<details><summary>Recent losing fills</summary><div className="tv-desk-list">
   {report.recentLosses.slice(0,12).map(x=><div key={x.accountId+':'+x.tradeId}><span>{x.symbol} {x.side} · {localTime(x.closedAtUTC)}</span><strong>{money(x.pnl)}</strong>
    <small>{x.reason||'Exit unspecified'} · {x.botId||'Robot unverified'}</small></div>)}
  </div></details>}
  {report.partial&&<p className="tv-desk-warning">Partial coverage: some records, Worker events, or historical trades may be missing.</p>}
  <p className="tv-desk-note">Broker-reported P/L is not adjusted for fees here: fee inclusion is unverified. Probable robot links are not proof; SL exits alone do not identify the strategy defect.</p>
 </section>;
}
