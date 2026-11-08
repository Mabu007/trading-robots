import {useCallback,useEffect,useRef,useState} from 'react';
import {Activity,AlertTriangle,Bot,CheckCircle2,Clock3,RefreshCw,ShieldCheck,Square,Wifi,Zap} from 'lucide-react';
import type {CloudClient} from '../firebase';
import type {PersistentAgent} from '../agents';
import {sharingRequest} from './BotSharing';
import {Dialog} from './Dialog';
import {displayTime} from '../display-time';
import './deployed-robot-inspector.css';

type Snapshot=Record<string,any>;
const dateFrom=(value:unknown)=>{
 if(typeof value==='string'&&Number.isFinite(Date.parse(value)))return displayTime(value);
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return 'Not reported';
 return displayTime(value<1e11?value*1000:value);
};
const count=(v:unknown)=>Array.isArray(v)?v.length:'Unknown';
const amount=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:2}).format(v):'Unavailable';
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
export function DeployedRobotInspector({client,agent,onClose,onRefreshAgents,onStop}:{
 client:CloudClient;agent:PersistentAgent;onClose:()=>void;
 onRefreshAgents:()=>Promise<void>|void;
 onStop:(agent:PersistentAgent,action:'status'|'stop')=>Promise<any>;
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
 const state=stateName(snapshot,agent);
 const verified=Boolean(snapshot&&!snapshot.uncertain&&!snapshot.statusUnavailable&&snapshot.connected);
 const exposureVerified=verified&&snapshot?.brokerExposureVerified===true;
 const exposure=exposureVerified?String(snapshot?.brokerExposure||'verified'):'Unknown / not independently verified';
 const events=Array.isArray(snapshot?.events)?snapshot.events.slice(-10).reverse():[];
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
    <dl><div><dt>Last decision</dt><dd>{value(snapshot?.lastEvaluation?.action)}</dd></div>
     <div><dt>Decision reason</dt><dd>{value(snapshot?.lastEvaluation?.reason)}</dd></div>
     <div><dt>Last evaluated</dt><dd>{dateFrom(snapshot?.lastEvaluation?.time)}</dd></div>
     <div><dt>Next Worker check</dt><dd>{dateFrom(snapshot?.nextAlarm??snapshot?.nextCheck)}</dd></div>
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
  <section className="tv-deployed-panel"><header><Activity size={17}/><h4>Latest runtime events</h4><span>{events.length} recent</span></header>
   {events.length?<div className="tv-deployed-events">{events.map((event:any,index:number)=><article key={String(event?.id??index)}><span>{dateFrom(event?.time??event?.timestamp??event?.at)}</span><strong>{side(event?.type??event?.kind??event?.action??event?.state??'Runtime event')}</strong><small>{side(event?.reason??event?.message??event?.outcome??'No further details supplied')}</small></article>)}</div>
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
  <div className="tv-deployed-footnote"><AlertTriangle size={15}/> Stopping a robot revokes authorization for new entries. It does not guarantee existing positions or resting orders are closed. Inspect your broker separately.</div>
  <div className="tv-deployed-actions">{agent.venue==='propdao'&&!snapshot?.authorizationRevoked&&
   <button type="button" className="tv-deployed-stop" disabled={stopping||loading} onClick={()=>setConfirmStop(current=>!current)}><Square size={15}/> Stop new entries</button>}
   <button type="button" className="tv-deployed-secondary" onClick={onClose}>Close</button></div>
  {confirmStop&&<section className="tv-deployed-stop-confirm" role="alertdialog" aria-label="Confirm robot stop">
   <strong>Revoke new-order permission?</strong><p>This action requests a stop of {agent.name}. Any existing orders or positions remain subject to broker-side verification.</p>
   <div><button type="button" onClick={()=>setConfirmStop(false)} disabled={stopping}>Cancel</button><button type="button" className="tv-deployed-stop" onClick={()=>void stop()} disabled={stopping}>{stopping?'Stopping…':'Confirm stop'}</button></div>
  </section>}
 </Dialog>;
}
