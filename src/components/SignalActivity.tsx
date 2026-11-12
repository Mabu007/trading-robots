import {useCallback,useEffect,useState} from 'react';
import {Activity,ArrowRight,Bell,Plus,RefreshCw} from 'lucide-react';
import {SignalBuilder} from './SignalBuilder';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import {displayTime} from '../display-time';
import './signal-activity.css';

type Signal={id:string;alertId:string;name:string;symbol:string;timeframe:string|null;action:'BUY'|'SELL'|null;matched:string[];price:number|null;time:number|null;delivery:'sent'};
type Page={signals:Signal[];nextCursor:string|null};
export function SignalActivity({client,active,bots=[],initialStrategyId='',initialDraftText='',onOpenApps}:{client:CloudClient|null;active:boolean;bots?:{id:string;name:string;asset:string}[];initialStrategyId?:string;initialDraftText?:string;onOpenApps:()=>void}){
 const [tab,setTab]=useState<'create'|'sent'>('create');
 const [signals,setSignals]=useState<Signal[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(false),[moreBusy,setMoreBusy]=useState(false),[error,setError]=useState('');
 const refresh=useCallback(async()=>{
  if(!client)return;
  setLoading(true);setError('');
  try{const page=await sharingRequest<Page>(client,'/api/signals/history');
   setSignals(page.signals||[]);setCursor(page.nextCursor||null);
  }catch(e){setError(e instanceof Error?e.message:'Could not read signal history')}
  finally{setLoading(false)}
 },[client]);
 useEffect(()=>{if(!client||!active||tab!=='sent')return;void refresh();const id=window.setInterval(()=>{if(!document.hidden)void refresh()},30000);return()=>window.clearInterval(id)},[client,active,tab,refresh]);
 const more=async()=>{if(!client||!cursor||moreBusy)return;setMoreBusy(true);setError('');
  try{const page=await sharingRequest<Page>(client,'/api/signals/history?cursor='+encodeURIComponent(cursor));
    setSignals(rows=>[...new Map([...rows,...page.signals].map(s=>[s.id,s])).values()].sort((a,b)=>(b.time||0)-(a.time||0)));
    setCursor(page.nextCursor||null);
  }catch(e){setError(e instanceof Error?e.message:'Could not load more signals')}
  finally{setMoreBusy(false)}
 };
 return <section className="tv-signal-activity" aria-label="Signals workspace">
  <header className="tv-signal-activity-head"><div><span className="tv-signal-kicker"><Bell size={15}/> SETUP SIGNALS</span><h1>Signals</h1><p>Describe a market condition, track it live and get notified when it appears.</p></div>
    <button className="tv-signal-primary" onClick={()=>setTab('create')}><Plus size={16}/> Create signal</button>
  </header>
  <div className="tv-signal-tabs" role="tablist" aria-label="Signals sections">
   <button type="button" role="tab" aria-selected={tab==='create'} className={tab==='create'?'is-active':''} onClick={()=>setTab('create')}><Bell size={15}/> Create & manage</button>
   <button type="button" role="tab" aria-selected={tab==='sent'} className={tab==='sent'?'is-active':''} onClick={()=>setTab('sent')}><Activity size={15}/> Sent history</button>
  </div>
  {tab==='create'&&<SignalBuilder client={client} active={active&&tab==='create'} bots={bots} initialStrategyId={initialStrategyId} initialDraftText={initialDraftText} onOpenApps={onOpenApps} onViewHistory={()=>setTab('sent')}/>}
  {tab==='sent'&&<section className="tv-signal-panel tv-signal-history" aria-label="Delivered notifications">
   <div className="tv-signal-history-head"><div><h2>Delivered signals</h2><p>Notifications successfully sent to your connected Telegram chat.</p></div><button className="tv-secondary-action" onClick={()=>void refresh()} disabled={!client||loading}><RefreshCw size={15}/>{loading?'Refreshing…':'Refresh'}</button></div>
   {error&&<p role="alert" className="tv-signal-error">{error}</p>}
   {!client?<p>Sign in to see sent signals.</p>:signals.length===0&&!loading?
    <div className="tv-signal-empty"><Activity size={24}/><strong>No notifications sent yet</strong><p>Once one of your conditions matches, confirmed Telegram deliveries appear here.</p><button onClick={()=>setTab('create')}>Create your first signal <ArrowRight size={15}/></button></div>:
    <div className="tv-signal-list">{signals.map(s=><article className="tv-signal-item" key={s.id}><span className={'tv-signal-side '+(s.action||'DETECTED').toLowerCase()}>{s.action||'SETUP'}</span><div><strong>{s.name}</strong><p>{s.symbol}{s.timeframe?' · '+s.timeframe.toUpperCase():''}{s.matched.length?' · '+s.matched.join(', '):''}</p><small>{s.time?displayTime(s.time*1000):'Time unavailable'} · Delivered</small></div><strong className="tv-signal-price">{s.price===null?'—':s.price.toLocaleString('en-US',{maximumFractionDigits:4})}</strong></article>)}</div>}
   {cursor&&<button className="tv-signal-load" disabled={moreBusy} onClick={()=>void more()}>{moreBusy?'Loading…':'Load more'}</button>}
  </section>}
 </section>;
}
