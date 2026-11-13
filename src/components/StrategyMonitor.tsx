import {useCallback,useEffect,useState} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
import type {CloudBot,CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import {Dialog} from './Dialog';
import {displayTime} from '../display-time';
import type {AlertRule} from '../../shared/market-alerts';
import './signal-builder.css';

type Monitor={id:string;revision:string;rule:AlertRule;state:string;runtime?:{running:boolean;dataStatus?:string;error?:string|null;lastCheck?:number|null;gap?:{reason?:string}|null;events?:{id:string;time:number;price:number;delivery:string}[]}|null;error?:string};
type Connection={connected:boolean};
export function StrategyMonitor({client,bot,expectedHash,onClose,onOpenApps}:{client:CloudClient;bot:CloudBot;expectedHash?:string;onClose:()=>void;onOpenApps:()=>void}){
 const [rows,setRows]=useState<Monitor[]>([]),[selected,setSelected]=useState<Monitor|null>(null),[source,setSource]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{
  const [list,tg]=await Promise.all([sharingRequest<{alerts:Monitor[]}>(client,'/api/market-alerts'),sharingRequest<Connection>(client,'/api/telegram/status')]);
  setRows((list.alerts||[]).filter(row=>row.rule?.strategy?.id===bot.id));setConnected(tg.connected);
 },[client,bot.id]);
 useEffect(()=>{void refresh().catch(e=>setError(e instanceof Error?e.message:'Could not load monitoring.'))},[refresh]);
 const act=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'Monitoring request failed.')}finally{setBusy(false)}};
 const read=async(id:string)=>{const row=await sharingRequest<Monitor>(client,'/api/market-alerts/'+encodeURIComponent(id));setSelected(row);try{const saved=await sharingRequest<{code:string}>(client,'/api/market-alerts/'+encodeURIComponent(id)+'/source');setSource(saved.code)}catch{setSource('')}};
 const prepare=()=>void act(async()=>{const row=await sharingRequest<Monitor>(client,'/api/market-alerts/from-strategy','POST',{botId:bot.id,...(expectedHash?{expectedHash}:{})});setSelected(row);const saved=await sharingRequest<{code:string}>(client,'/api/market-alerts/'+encodeURIComponent(row.id)+'/source');setSource(saved.code);setNotice('Review this saved version before starting monitoring.');await refresh()});
 const control=(action:'start'|'pause')=>void act(async()=>{if(!selected)return;await sharingRequest(client,'/api/market-alerts/'+encodeURIComponent(selected.id)+'/control','POST',{action,...(action==='start'?{revision:selected.revision}:{})});await read(selected.id);await refresh();setNotice(action==='start'?'Monitoring started.':'Monitoring paused.')});
 return <Dialog title={'Monitor '+bot.name} busy={busy} onClose={onClose}><div className="tv-signal-builder">
  <section className="tv-signal-panel"><h3>Watch this strategy</h3><p>Review a saved Gold strategy version and receive Telegram notifications when its conditions are met. Monitoring does not place orders.</p>
   <p>{connected?'Telegram is connected.':'Connect Telegram in Apps before starting.'} <button type="button" className="tv-secondary-action" onClick={onOpenApps}>{connected?'Manage Telegram':'Connect Telegram'} <ArrowRight size={14}/></button></p>
   {expectedHash?<button type="button" className="tv-signal-primary-action" disabled={busy} onClick={prepare}>Review tested strategy</button>:<p>Open the strategy and run or review its current backtest to start a new monitor.</p>}
  </section>
  <section className="tv-signal-panel"><h3>Monitoring history</h3><button type="button" className="tv-secondary-action" disabled={busy} onClick={()=>void act(refresh)}><RefreshCw size={14}/> Refresh</button>
   {rows.length===0?<p>No monitors for this strategy yet.</p>:<div className="tv-signal-owned-list">{rows.map(row=><button type="button" key={row.id} className="tv-signal-owned-row" onClick={()=>void act(()=>read(row.id))}><span><strong>{row.rule.timeframe.toUpperCase()} · {row.state}</strong><small>Version {row.rule.strategy?.sourceHash.slice(0,12)}</small></span></button>)}</div>}
   {selected&&<div className="tv-signal-selected"><h3>{bot.name} · {selected.rule.symbol}</h3><p>Completed {selected.rule.timeframe.toUpperCase()} candles · Telegram · {selected.rule.repeat?'Repeating':'Once'} · expires {displayTime(selected.rule.expiresAt*1000)}</p><p>Strategy version: {selected.rule.strategy?.sourceHash.slice(0,12)}. Editing the saved strategy does not change a running monitor. Prepare a new review to use changes.</p>
    <details><summary>View strategy conditions in code</summary>{source?<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:240,overflow:'auto'}}>{source}</pre>:<p>The saved source has changed or cannot be loaded. A running monitor keeps its existing version.</p>}</details><p>Status: {selected.runtime?selected.runtime.running?(selected.runtime.error?'Needs attention':selected.runtime.dataStatus==='unavailable'?'Market data unavailable':selected.runtime.dataStatus==='waiting'?'Waiting for market data':'Monitoring'):'Not monitoring':selected.state==='draft'?'Draft':'Unknown — refresh to check'}{selected.runtime?.lastCheck?' · Last checked '+displayTime(selected.runtime.lastCheck):''}</p>
    {selected.runtime?.gap?.reason&&<p role="status">{selected.runtime.gap.reason}</p>}{selected.runtime?.error&&<p role="alert">{selected.runtime.error}</p>}{selected.error&&<p role="alert">{selected.error}</p>}
    <div className="tv-signal-action-row"><button type="button" className="tv-signal-primary-action" disabled={busy||!connected||!!selected.runtime?.running} onClick={()=>control('start')}>Start monitoring</button><button type="button" className="tv-secondary-action" disabled={busy} onClick={()=>control('pause')}>Pause</button><button type="button" className="tv-secondary-action" disabled={busy} onClick={()=>void act(()=>read(selected.id))}>Check status</button></div>
    {Boolean(selected.runtime?.events?.length)&&<><h4>Recent events</h4>{selected.runtime!.events!.slice(-5).reverse().map(event=><p key={event.id}>{displayTime(event.time*1000)} · {event.price} · {event.delivery}</p>)}</>}
   </div>}
  </section>{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </div></Dialog>;
}
