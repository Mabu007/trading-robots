import {History,ShieldAlert} from 'lucide-react';
import {displayTime} from '../display-time';
import type {ExecutionEvent,ExecutionStage} from '../../shared/propdao-execution-journal';
import './propdao-execution-timeline.css';
const names:Record<ExecutionStage,string>={
 SIGNAL:'Signal only — not filled',
 ENTRY_SKIPPED:'Skipped · no submission',
 SUBMISSION_STARTED:'Submitted · fill unverified',
 PRE_SUBMIT_REJECTED:'Rejected before submission',
 PROTECTED_FILL:'Protected fill confirmed',
 CANCELLED_UNFILLED:'Cancelled without fill',
 OUTCOME_UNKNOWN:'Outcome unknown · reconcile'
};
export function PropDAOExecutionTimeline({events,accountId,title='Robot decisions and order outcomes',max=80}:{
 events:ExecutionEvent[]|null;accountId:string;title?:string;max?:number;
}){
 const listed=events===null?null:events.filter(x=>x.accountId===accountId).slice()
  .sort((a,b)=>b.time-a.time).slice(0,max);
 return <section className="tv-desk-section tv-execution-timeline" aria-label={title}>
  <header className="tv-desk-section-heading"><div><h2><History size={17}/>{title}</h2>
   <p>Signals and order attempts are not trades. Only broker-confirmed fills and trade history prove execution.</p>
  </div><span>{listed===null?'Not verified':listed.length+' events'}</span></header>
  {listed===null?<p role="status" className="tv-desk-warning">Runtime journal unavailable. This does not mean the robot never traded.</p>:
   listed.length===0?<p className="tv-desk-table-empty">No execution records retained for this account. Older Worker data may be incomplete.</p>:
   <div className="tv-desk-table-wrap"><table className="tv-desk-table">
    <thead><tr><th>Time (UTC / SAST)</th><th>Signal</th><th>Execution status</th><th>Symbol</th><th>Bot</th><th>Size</th><th>Details</th></tr></thead>
    <tbody>{listed.map(e=><tr key={e.id+e.botId}>
     <td className="tv-desk-date">{displayTime(e.time)}</td><td>{e.side||'—'}</td>
     <td><span className={'tv-execution-stage '+(e.stage==='OUTCOME_UNKNOWN'?'danger':e.stage==='PROTECTED_FILL'?'confirmed':'')}>{e.stage==='OUTCOME_UNKNOWN'&&<ShieldAlert size={13}/>} {names[e.stage]}</span></td>
     <td>{e.symbol}</td><td title={e.botId}>{e.botId==='unattributed'?'Legacy · bot unknown':e.botId.slice(0,16)}</td>
     <td>{typeof e.quantity==='number'?e.quantity.toLocaleString('en-US',{maximumFractionDigits:8}):'—'}</td>
     <td className="tv-execution-detail">{e.reason||'—'}{e.intentId&&<small>Intent: {e.intentId}</small>}</td>
    </tr>)}</tbody>
   </table></div>}
  <p className="tv-execution-footnote">This Worker journal retains a limited number of recent events. Broker-reported closed trades are shown separately; a position can open and close between refreshes.</p>
 </section>;
}
