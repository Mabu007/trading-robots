import {useCallback,useEffect,useState} from 'react';
import {Activity,ArrowRight,RefreshCw} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import {displayTime} from '../display-time';
import './signal-activity.css';

type Signal={id:string;alertId:string;name:string;symbol:string;timeframe:string|null;action:'BUY'|'SELL'|null;matched:string[];price:number|null;time:number|null;delivery:'sent'};
type Page={signals:Signal[];nextCursor:string|null};
export function SignalActivity({client,active,onCreate}:{client:CloudClient|null;active:boolean;onCreate:()=>void}){
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
 useEffect(()=>{if(!client||!active)return;void refresh();const id=window.setInterval(()=>{if(!document.hidden)void refresh()},30000);return()=>window.clearInterval(id)},[client,active,refresh]);
 const more=async()=>{if(!client||!cursor||moreBusy)return;setMoreBusy(true);setError('');
  try{const page=await sharingRequest<Page>(client,'/api/signals/history?cursor='+encodeURIComponent(cursor));
    setSignals(rows=>[...new Map([...rows,...page.signals].map(s=>[s.id,s])).values()].sort((a,b)=>(b.time||0)-(a.time||0)));
    setCursor(page.nextCursor||null);
  }catch(e){setError(e instanceof Error?e.message:'Could not load more signals')}
  finally{setMoreBusy(false)}
 };
 return <section className="tv-signal-activity" aria-label="Delivered signals">
  <header className="tv-signal-activity-head"><div><span className="tv-signal-kicker"><Activity size={15}/> LIVE SIGNAL HISTORY</span><h1>Signals</h1><p>Every confirmed Telegram notification from your active setup trackers. No orders are placed.</p></div><div className="tv-signal-actions"><button onClick={()=>void refresh()} disabled={!client||loading}><RefreshCw size={15}/>{loading?'Checking…':'Refresh'}</button><button className="tv-signal-primary" onClick={onCreate}>Create tracker <ArrowRight size={15}/></button></div></header>
  {error&&<p role="alert" className="tv-signal-error">{error}</p>}
  {!client?<p>Sign in to see your signals.</p>:signals.length===0&&!loading?<div className="tv-signal-empty"><Activity size={24}/><strong>No signals delivered yet</strong><p>Create a tracker, connect Telegram, then get notified when the conditions match.</p><button onClick={onCreate}>Create first tracker</button></div>:
   <div className="tv-signal-list">{signals.map(s=><article className="tv-signal-item" key={s.id}><span className={'tv-signal-side '+(s.action||'DETECTED').toLowerCase()}>{s.action||'SETUP'}</span><div><strong>{s.name}</strong><p>{s.symbol}{s.timeframe?' · '+s.timeframe.toUpperCase():''}{s.matched.length?' · '+s.matched.join(', '):''}</p><small>{s.time?displayTime(s.time*1000):'Time unavailable'} · Telegram delivered</small></div><strong className="tv-signal-price">{s.price===null?'—':s.price.toLocaleString('en-US',{maximumFractionDigits:4})}</strong></article>)}</div>}
  {cursor&&<button className="tv-signal-load" disabled={moreBusy} onClick={()=>void more()}>{moreBusy?'Loading…':'Load more signals'}</button>}
 </section>;
}
