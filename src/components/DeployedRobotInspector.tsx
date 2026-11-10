import {useCallback,useEffect,useRef,useState} from 'react';
import {Activity,AlertTriangle,Bot,CheckCircle2,Clock3,Play,RefreshCw,ShieldCheck,Square,Trash2,Wifi,Zap} from 'lucide-react';
import type {CloudClient} from '../firebase';
import type {PersistentAgent} from '../agents';
import {sharingRequest} from './BotSharing';
import {Dialog} from './Dialog';
import {displayTime} from '../display-time';
import {filterReadiness} from '../strategy-check-readiness';
import {robotDisplayState,canClearRobot} from '../robot-lifecycle';
import './deployed-robot-inspector.css';
import {PropDAOExecutionTimeline} from './PropDAOExecutionTimeline';
import {safeExecutionEvents,oldWorkerEvents} from '../../shared/propdao-execution-journal';

type Snapshot=Record<string,any>;
const dateFrom=(value:unknown)=>{
 if(typeof value==='string'&&Number.isFinite(Date.parse(value)))return displayTime(value);
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return 'Not reported';
 return displayTime(value<1e11?value*1000:value);
};
const count=(v:unknown)=>Array.isArray(v)?v.length:'Unknown';
const amount=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}).format(v):'Unavailable';
export function describeRuntimeEvent(input:unknown){
 if(typeof input==='string'){
  const m=/^(\d{4}-\d\d-\d\dT[\d:.]+Z) · (.*)$/.exec(input);
  return {time:m?Date.parse(m[1]):null,kind:'Worker activity',text:(m?.[2]||input).slice(0,220)};
 }
 const e=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;
 const raw=e.time??e.timestamp??e.at;
 return {time:typeof raw==='number'&&Number.isFinite(raw)?raw:null,
  kind:String(e.kind??e.type??e.action??'Runtime event').slice(0,45),
  text:String(e.reason??e.message??e.outcome??'No detail').slice(0,220)};
}
const value=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):'Not reported';
const stateName=(s:Snapshot|null,agent:PersistentAgent)=>{
 if(!s)return 'Not verified';
 if(s.uncertain||s.statusUnavailable)return 'Status unknown';
 if(s.running&&s.deployed)return 'Running';
 if(s.paused&&s.deployed)return 'Paused';
 if(s.authorizationRevoked)return 'New orders revoked';
 if(s.deployed)return 'Stopped';
 return agent.state==='unknown'?'Status unknown':'No active authorization';
};
export function DeployedRobotInspector({client,agent,onClose,onRefreshAgents,onStop,onRestart,onClear,onViewAccountTrades}:{
 client:CloudClient;agent:PersistentAgent;onClose:()=>void;
 onRefreshAgents:()=>Promise<void>|void;
 onStop:(agent:PersistentAgent,action:'status'|'stop')=>Promise<any>;
 onRestart?:(agent:PersistentAgent)=>void;onClear?:(agent:PersistentAgent)=>void;
  onViewAccountTrades?:(accountId:string)=>void;
}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [checkedAt,setCheckedAt]=useState('');
 const [confirmStop,setConfirmStop]=useState(false);
 const [stopping,setStopping]=useState(false);
 const [stopResult,setStopResult]=useState('');
 const refreshAgentsRef=useRef(onRefreshAgents);refreshAgentsRef.current=onRefreshAgents;
 const refresh=useCallback(async()=>{
  if(agent.venue!=='propdao'){setError('Detailed live telemetry is not yet connected for this broker. The agent record below is available, but broker exposure is unverified.');setLoading(false);return}
  setLoading(true);setError('');
  try{
   const next=await sharingRequest<Snapshot>(client,'/api/venues/propdao/bots/'+encodeURIComponent(agent.botId)+'/live');
   setSnapshot(next);setCheckedAt(new Date().toISOString());
   await Promise.resolve(refreshAgentsRef.current());
  }catch(cause){
   // Never rebrand a previous snapshot as current after a failed read.
   setSnapshot(null);setError(cause instanceof Error?cause.message:'Runtime data unavailable. Broker exposure is unknown.');
   setCheckedAt('');
  }finally{setLoading(false)}
 },[agent.botId,agent.venue,client]);
 useEffect(()=>{void refresh()},[refresh]);
 useEffect(()=>{
  if(agent.venue!=='propdao')return;
  const id=window.setInterval(()=>{if(!document.hidden&&!stopping)void refresh()},30000);
  return()=>window.clearInterval(id);
 },[agent.venue,refresh,stopping]);
 const stopped=robotDisplayState(agent)==='stopped';
 const state=snapshot?stateName(snapshot,agent):stopped?'Stopped record · runtime unverified':'Status unknown';
 const verified=Boolean(snapshot&&!snapshot.uncertain&&!snapshot.statusUnavailable&&snapshot.connected);
 const exposureVerified=verified&&snapshot?.brokerExposureVerified===true;
 const exposure=exposureVerified?String(snapshot?.brokerExposure||'verified'):'Unknown / not independently verified';
 const events=Array.isArray(snapshot?.events)?snapshot.events.slice(-10).reverse().map(describeRuntimeEvent):[];
  const accountId=String(snapshot?.accountId??agent.deployment?.limits?.accountId??'');
  const structured=Array.isArray(snapshot?.executionEvents)?
   safeExecutionEvents(snapshot.executionEvents,accountId):null;
  const legacy=accountId&&Array.isArray(snapshot?.events)?oldWorkerEvents(snapshot.events,accountId):[];
  const journal=structured===null?legacy:structured.concat(legacy).filter((event,index,all)=>
   !all.some((prior,j)=>j<index&&prior.stage===event.stage&&prior.side===event.side&&
    Math.abs(prior.time-event.time)<15000));
  const lastSignal=journal.filter(e=>e.stage==='SIGNAL').sort((a,b)=>b.time-a.time)[0];
  const lastOutcome=lastSignal?.intentId&&journal.filter(e=>e.intentId===lastSignal.intentId&&
   e.stage!=='SIGNAL'&&e.stage!=='SUBMISSION_STARTED').sort((a,b)=>b.time-a.time)[0];
 const feeds=snapshot?.lastMarketData?.timeframes&&typeof snapshot.lastMarketData.timeframes==='object'?
   Object.entries(snapshot.lastMarketData.timeframes) as [string,{received?:number;requested?:number;ready?:boolean;recentGap?:boolean}][]
   :[];
 const stop=async()=>{
  if(!confirmStop||stopping)return;
  setStopping(true);setStopResult('');
  try{
   const result=await onStop(agent,'stop');
   if(result?.authorizationRevoked===true){
    setStopResult(result.runtimeStopped===true?
     'New-order authorization revoked and Worker stop confirmed. Existing broker positions and resting orders still require verification.':
     'New-order authorization revoked, but the Worker stop is not verified. Check the broker account before taking further action.');
   }else{
    setStopResult('Stop could not be confirmed. Broker exposure may be unknown. Recheck the account.');
   }
  }catch(cause){setStopResult('Stop could not be confirmed: '+(cause instanceof Error?cause.message:'unknown error'))}
  finally{setConfirmStop(false);setStopping(false);await refresh();}
 };
 const readiness=filterReadiness(snapshot?.lastEvaluation?.checks);
 const recentDecisions=Array.isArray(snapshot?.recentDecisions)?snapshot.recentDecisions.slice(-120):[];
 const side=(input:unknown)=>String(input??'—').slice(0,24);
 return <Dialog title={'Robot operations · '+agent.name} className="tv-deployed-inspector" onClose={onClose} busy={stopping}>
  <div className="tv-deployed-hero">
   <div className="tv-deployed-identity"><span className="tv-deployed-orb"><Bot size={24}/></span><div>
    <span className="tv-deployed-eyebrow">ROBOT OPERATIONS / OWNER-VERIFIED DATA</span>
    <h3>{agent.name}</h3><p>{agent.asset} · {agent.venue.toUpperCase()} · revision {agent.strategy.revision}</p></div></div>
   <span className={'tv-deployed-state '+(verified&&state==='Running'?'running':verified?'neutral':'unknown')}>{verified&&state==='Running'?<CheckCircle2 size={14}/>:<AlertTriangle size={14}/>} {state}</span>
  </div>
  <div className="tv-deployed-toolbar"><span><Clock3 size={13}/>{checkedAt?'Last fetched '+dateFrom(checkedAt):'No verified runtime fetch yet'}</span>
   <button type="button" onClick={()=>void refresh()} disabled={loading||stopping}><RefreshCw size={15} className={loading?'tv-deployed-spinning':''}/>{loading?'Checking…':'Refresh status'}</button></div>
  {error&&<div role="alert" className="tv-deployed-warning"><AlertTriangle size={16}/>{error}</div>}
  {stopResult&&<div role="status" className="tv-deployed-warning"><ShieldCheck size={16}/>{stopResult}</div>}
  {!snapshot&&loading&&<div className="tv-deployed-loading" role="status">Contacting your Cloudflare runtime and broker account…</div>}
  <div className="tv-deployed-overview">
   <article><span><Activity size={15}/> Runtime</span><strong>{state}</strong><small>{snapshot?.connected?'Worker reachable':snapshot?'Worker reachability not confirmed':'Awaiting fresh status'}</small></article>
   <article><span><Wifi size={15}/> Broker exposure</span><strong>{exposure}</strong><small>{exposureVerified?'Direct authenticated broker read':'Do not assume a flat account'}</small></article>
   <article><span><ShieldCheck size={15}/> Account risk room</span><strong>{snapshot?.brokerExposureVerified?'$'+amount(snapshot?.risk?.roomUsd):'Unknown'}</strong><small>Broker-reported USDC, if verified</small></article>
  </div>
  <div className="tv-deployed-grid">
   <section className="tv-deployed-panel"><header><Zap size={17}/><h4>What the robot is doing</h4></header>
    <p className="tv-deployed-note">A strategy signal is not a broker fill. Consult the execution outcome and account history.</p>
     <dl><div><dt>Last strategy decision</dt><dd>{value(snapshot?.lastEvaluation?.action)}</dd></div>
     <div><dt>Decision reason</dt><dd>{snapshot?.lastEvaluation?.reason?value(snapshot.lastEvaluation.reason):'Strategy did not provide a reason'}</dd></div>
     <div><dt>Last evaluated</dt><dd>{dateFrom(snapshot?.lastEvaluation?.time)}</dd></div>
     <div><dt>Next Worker check</dt><dd>{dateFrom(snapshot?.nextAlarm??snapshot?.nextCheck)}</dd></div>
     <div><dt>Last broker-confirmed order</dt><dd>{snapshot?.lastOrder?.providerStatus?value(snapshot.lastOrder.providerStatus)+' · '+dateFrom(snapshot.lastOrder.time):'No confirmed order result retained'}</dd></div>
     <div><dt>Latest signal outcome</dt><dd>{lastOutcome?lastOutcome.stage.replaceAll('_',' '):'No outcome recorded for that signal'}</dd></div>
     <div><dt>Order intent</dt><dd>{snapshot?.pendingIntent?'Unresolved; reconciliation required':'No unresolved intent reported'}</dd></div>
     <div><dt>Runtime authorization</dt><dd>{snapshot?.authorizationRevoked?'New entries revoked':snapshot?.deployed?'Authorized / status above':'Not verified'}</dd></div>
    </dl>
   </section>
   <section className="tv-deployed-panel"><header><ShieldCheck size={17}/><h4>Account and execution</h4></header>
    <dl><div><dt>Account ID</dt><dd>{value(snapshot?.accountId??agent.deployment?.limits?.accountId)}</dd></div>
     <div><dt>Balance</dt><dd>{exposureVerified?'$'+amount(snapshot?.risk?.balance):'Unknown'}</dd></div>
     <div><dt>Equity</dt><dd>{exposureVerified?'$'+amount(snapshot?.risk?.equity):'Unknown'}</dd></div>
     <div><dt>Open positions</dt><dd>{exposureVerified?count(snapshot?.positions):'Unknown'}</dd></div>
     <div><dt>Resting orders</dt><dd>{exposureVerified?count(snapshot?.pendingOrders):'Unknown'}</dd></div>
     <div><dt>Risk breach</dt><dd>{exposureVerified?(snapshot?.risk?.breached?'BREACHED':'No breach reported'):'Unknown'}</dd></div>
    </dl>
   </section>
  </div>
  <section className="tv-deployed-panel tv-deployed-feed"><header><Wifi size={17}/><h4>Market data sensors</h4><span>{feeds.length?'Worker-reported coverage':'No feed telemetry available'}</span></header>
   {feeds.length?<div className="tv-deployed-feeds">{feeds.map(([tf,feed])=><div key={tf}><strong>{tf.toUpperCase()}</strong><span>{feed.received??'—'} / {feed.requested??'—'} bars</span><small className={feed.ready?'ready':'not-ready'}>{feed.ready?'Ready':feed.recentGap?'Recent gap':'Incomplete / stale'}</small></div>)}</div>
   :<p>No verified candle-load metrics were returned. This is not proof that the feed is healthy.</p>}
  </section>
  <section className="tv-deployed-panel tv-deployed-conditions" aria-label="Entry filter progress">
   <header><Activity size={17}/><h4>Entry conditions · latest evaluation</h4><span>{dateFrom(snapshot?.lastEvaluation?.time)}</span></header>
   {readiness.reported?<>
    <p>{readiness.passed} / {readiness.reportedCount} reported checks passed, {readiness.failed} waiting, {readiness.unknown} unknown. Conditions are observations, not trade predictions.</p>
    <div className="tv-deployed-checks">{readiness.checks.map((check,i)=><article key={check.name+':'+i}>
     <strong>{check.passed===true?'✓':check.passed===false?'○':'?'} {check.name}</strong>
     <span>{check.actual!==null&&check.threshold!==null&&check.operator?
      String(check.actual)+' '+(check.unit||'')+' '+check.operator+' '+String(check.threshold)+' '+(check.unit||''):
      check.passed===true?'Met':check.passed===false?'Not yet met':'Not measured'}</span>
     {check.gap!==null&&check.gap>0&&<small>Remaining: {Number(check.gap.toPrecision(6))} {check.unit||''}{check.progressPercent!==null?' · '+check.progressPercent.toFixed(0)+'% of minimum reached':''}</small>}
     {check.progressPercent!==null&&<div className="tv-deployed-check-track"><span style={{width:check.progressPercent+'%'}}/></div>}
    </article>)}</div>
   </>:<p>The deployed strategy did not report individual filter checks. A WAIT alone does not reveal which EMA, ATR, RSI or structure threshold failed. Future saved strategy revisions can emit verified checks.</p>}
   <small>{recentDecisions.length?'Worker retained '+recentDecisions.length+' evaluated decisions ('+recentDecisions.filter((v:any)=>v?.action==='WAIT').length+' WAIT). This is not a complete broker trade history.':'No individual decision history returned by this Worker version. New Worker code must be deployed separately.'}</small>
  </section>
  <PropDAOExecutionTimeline events={journal} accountId={accountId}
    title="This robot's signals and execution outcomes" max={25}/>
  <section className="tv-deployed-panel"><header><Activity size={17}/><h4>Latest runtime events</h4><span>{events.length} recent</span></header>
   {events.length?<div className="tv-deployed-events">{events.map((event,index)=><article key={String(event.time??index)+':'+index}>
    <span>{dateFrom(event.time)}</span><strong>{event.kind}</strong><small>{event.text}</small></article>)}</div>
   :<p>There are no recent events in the current Worker response. This does not prove the robot has never traded.</p>}
  </section>
  {exposureVerified&&(Array.isArray(snapshot?.positions)&&snapshot.positions.length>0||Array.isArray(snapshot?.pendingOrders)&&snapshot.pendingOrders.length>0)&&
  <section className="tv-deployed-panel"><header><AlertTriangle size={17}/><h4>Actual broker exposure</h4></header>
   <div className="tv-deployed-exposure">{(snapshot.positions||[]).slice(0,15).map((p:any,i:number)=><div key={'pos'+i}><strong>Position · {side(p.symbol)} · {side(p.side)}</strong><span>Qty {value(p.qty)} · Entry {value(p.entry)} · Mark {value(p.mark)} · P&L {value(p.unrealizedPnl)}</span></div>)}
    {(snapshot.pendingOrders||[]).slice(0,15).map((o:any,i:number)=><div key={'order'+i}><strong>Order · {side(o.symbol)} · {side(o.side)}</strong><span>Qty {value(o.qty)} · Price {value(o.price)} · {side(o.status)}</span></div>)}</div>
  </section>}
  <section className="tv-deployed-panel tv-deployed-provenance"><header><ShieldCheck size={17}/><h4>Deployment identity and costs</h4></header>
   <dl><div><dt>Grant ID</dt><dd>{value(agent.deployment?.grantId)}</dd></div>
    <div><dt>Code hash</dt><dd className="tv-deployed-codehash">{value(snapshot?.codeHash??agent.strategy.codeHash)}</dd></div>
    <div><dt>Authorized at</dt><dd>{dateFrom(agent.deployment?.authorizedAt)}</dd></div>
    <div><dt>Authorization expiry</dt><dd>{dateFrom(snapshot?.grantExpiresAt??agent.deployment?.expiresAt)}</dd></div>
    <div><dt>AI tokens / compute usage</dt><dd>Not metered per robot in this response</dd></div>
   </dl>
  </section>
  {onViewAccountTrades&&accountId&&<button type="button" className="tv-deployed-secondary"
    onClick={()=>onViewAccountTrades(accountId)}><Activity size={15}/> View Trades for {accountId}</button>}
  <div className="tv-deployed-footnote"><AlertTriangle size={15}/> Stopping a robot revokes authorization for new entries. It does not guarantee existing positions or resting orders are closed. Inspect your broker separately.</div>
  <div className="tv-deployed-actions">{stopped&&onRestart&&<button type="button" className="tv-deployed-secondary" onClick={()=>onRestart(agent)}><Play size={15}/> Start Bot</button>}
   {stopped&&onClear&&canClearRobot(agent)&&<button type="button" className="tv-deployed-secondary" onClick={()=>onClear(agent)}><Trash2 size={15}/> Clear</button>}
   {agent.venue==='propdao'&&!stopped&&!snapshot?.authorizationRevoked&&
   <button type="button" className="tv-deployed-stop" disabled={stopping||loading} onClick={()=>setConfirmStop(current=>!current)}><Square size={15}/> Stop new entries</button>}
   <button type="button" className="tv-deployed-secondary" onClick={onClose}>Close</button></div>
  {confirmStop&&<section className="tv-deployed-stop-confirm" role="alertdialog" aria-label="Confirm robot stop">
   <strong>Revoke new-order permission?</strong><p>This action requests a stop of {agent.name}. Any existing orders or positions remain subject to broker-side verification.</p>
   <div><button type="button" onClick={()=>setConfirmStop(false)} disabled={stopping}>Cancel</button><button type="button" className="tv-deployed-stop" onClick={()=>void stop()} disabled={stopping}>{stopping?'Stopping…':'Confirm stop'}</button></div>
  </section>}
 </Dialog>;
}
