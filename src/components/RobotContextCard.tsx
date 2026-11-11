import type {RobotCardEvidence} from '../robot-context-card.ts';
import './trading-desk-card.css';
const num=(x:number|null|undefined)=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('en-US',{maximumFractionDigits:2}):'—';
const date=(t:number|null|undefined)=>typeof t==='number'&&Number.isFinite(t)?
 new Date(t>1e11?t:t*1000).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg',
 dateStyle:'medium',timeStyle:'short'})+' SAST':'Not reported';
/** A robot card intentionally excludes aggregate account P/L unless the trade
 * receipts include attribution to this exact robot. */
export function RobotContextCard({report,name}:{report:RobotCardEvidence;name?:string}){
 const attribution=report.today;
 return <section className="tv-desk-card" aria-label="Robot status and attributed trade evidence">
  <header><strong>Robot · {name||report.robotId||'Identity unavailable'}</strong>
   <span>{report.running==='running'?'Worker running':report.running==='paused'?'Paused':
    report.running==='stopped'?'Stopped':'Runtime unverified'}</span></header>
  <p className="tv-desk-note">{report.instrument||'Instrument unknown'} · {report.timeframe||'Timeframe unknown'} · Account {report.accountId||'unverified'}</p>
  <div className="tv-desk-metrics">
   <div><small>Verified fills linked today</small><strong>{attribution?num(attribution.verifiedTrades):'—'}</strong></div>
   <div><small>Probable links</small><strong>{attribution?num(attribution.probableTrades):'—'}</strong></div>
   <div><small>Broker exposure</small><strong>{report.brokerExposureVerified?report.brokerExposure:'Unknown'}</strong></div>
   <div><small>Last decision</small><strong>{report.lastDecision?.action||'Not reported'}</strong></div>
  </div>
  {report.lastDecision&&<p className="tv-desk-note">Decision: {report.lastDecision.reason||'No strategy reason recorded'} · {date(report.lastDecision.time)}</p>}
  {report.revision&&<p className="tv-desk-note">Deployed revision: <code>{report.revision.slice(0,14)}</code></p>}
  {attribution&&<details><summary>Broker-to-robot attribution</summary>
   <p className="tv-desk-note">{attribution.verifiedTrades} exactly linked broker trades; {attribution.probableTrades} probable and not verified.</p>
   <p className="tv-desk-note">Recent account losses lacking bot proof: {attribution.accountRecentLossesWithoutRobotProof}. These do not count as robot losses.</p>
   {attribution.partial&&<p className="tv-desk-warning">Partial broker or Worker history. Totals may be incomplete.</p>}
   <p className="tv-desk-note">{attribution.unattributedStatement}</p>
  </details>}
  {report.issue&&<p className="tv-desk-warning">{report.issue}</p>}
  <p className="tv-desk-note">Runtime status does not establish trade attribution. Strategy fitness requires entry-time decision and market evidence; SL exits alone do not diagnose stop placement.</p>
 </section>;
}
