import {useEffect,useState} from 'react';
import {Activity,ArrowRight,BarChart3,CalendarDays,CheckCircle2,ChevronRight,Home,LogOut,Moon,Play,RotateCcw,Sun,Trash2,Pencil,Save} from 'lucide-react';
import {mergePracticeHistory,readLocalHistory,syncPracticeHistory,saveLocalHistory,removeLocalPracticeRecord,clearLocalPracticeHistory,type PracticeRecord} from '../practice-history';
import type {CloudClient} from '../firebase';
import type {AppTheme} from '../theme';
import {MarketReplay} from './MarketReplay';
import './practice-app.css';

type Page='home'|'replay'|'progress';
type Props={client:CloudClient;theme:AppTheme;onSignOut:()=>void;onThemeToggle:()=>void};
const menu=[{id:'home',label:'Home',icon:Home},{id:'replay',label:'Market Replay',icon:Activity},{id:'progress',label:'My Progress',icon:BarChart3}] as const;
const heroImage='https://pub-60ec726f38cd437c94063e4c72071321.r2.dev/Confident%20Trader%20in%20a%20Modern%20Workspace.png';
export function PracticeApp({client,theme,onSignOut,onThemeToggle}:Props){
 const [page,setPage]=useState<Page>('home');
 const [replayChoice,setReplayChoice]=useState<{day?:string;tradeId?:string}>({});
 const [edit,setEdit]=useState<{recordId:string;tradeId:string;note:string}|null>(null);
 const [saving,setSaving]=useState(false),[historyError,setHistoryError]=useState('');
 const [history,setHistory]=useState<PracticeRecord[]>([]);
 const [historyState,setHistoryState]=useState<'loading'|'synced'|'local'>('loading');
 const [historyRevision,setHistoryRevision]=useState(0);
 const profile=client.getProfile(),name=profile?.displayName?.trim().split(' ')[0]||'trader';
 useEffect(()=>{const uid=profile?.uid;if(!uid)return;let active=true;
  setHistory(mergePracticeHistory(readLocalHistory(uid),[]));setHistoryState('loading');
  void (async()=>{try{await syncPracticeHistory(uid,client);const remote=await client.listPracticeRecords();if(active){setHistory(mergePracticeHistory(readLocalHistory(uid),remote));setHistoryState('synced')}}catch{if(active){setHistory(mergePracticeHistory(readLocalHistory(uid),[]));setHistoryState('local')}}})();
  return()=>{active=false};
 },[client,profile?.uid,historyRevision]);
 const openReplay=(day?:string,tradeId?:string)=>{setReplayChoice({day,tradeId});setPage('replay')};
 const tradeRows=history.flatMap(record=>(record.trades||[]).map(trade=>({record,trade}))).sort((a,b)=>b.trade.exitTime-a.trade.exitTime);
 const money=(value:number)=>(value<0?'−':value>0?'+':'')+'R'+Math.abs(value).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2});
 const uid=profile?.uid||'';
 const saveRecord=async(record:PracticeRecord)=>{
  setSaving(true);setHistoryError('');saveLocalHistory(uid,record);
  setHistory(items=>items.map(item=>item.id===record.id?record:item));
  try{await client.savePracticeRecord(record);saveLocalHistory(uid,record,true)}
  catch{setHistoryError('Saved on this device. Firebase sync will retry next time you open My Progress.')}
  finally{setSaving(false)}
 };
 const deleteRecordedTrade=async(record:PracticeRecord,tradeId:string)=>{
  if(!window.confirm('Delete this archived trade review? This does not alter historical market prices or the local replay execution.'))return;
  setSaving(true);setHistoryError('');
  const trades=(record.trades||[]).filter(trade=>trade.id!==tradeId);
  const annotations={...(record.annotations||{})};delete annotations[tradeId];
  try{
   if(!trades.length){await client.deletePracticeRecord(record.id);removeLocalPracticeRecord(uid,record.id);setHistory(items=>items.filter(item=>item.id!==record.id))}
   else await saveRecord({...record,trades,annotations,tradeCount:trades.length,net:trades.reduce((sum,t)=>sum+t.net,0)});
   setEdit(null);
  }catch{setHistoryError('Could not delete this archived trade. Please retry.')}
  finally{setSaving(false)}
 };
 const resetProgress=async()=>{
  if(!window.confirm('Delete your saved replay history, archived trade reviews, drawings and sessions on this account/device? This cannot be undone.'))return;
  setSaving(true);setHistoryError('');
  try{
   await client.clearPracticeRecords();
   for(const key of Object.keys(localStorage)){
    if(key.startsWith('trading-vibes:replay:zar:v4:'+uid+':')||key.startsWith('trading-vibes:replay:v3:'+uid+':')||key.startsWith('trading-vibes:replay:v2:'+uid+':')||key.startsWith('trading-vibes:replay-drawings:'+uid+':')||key==='trading-vibes:practice-history:v1:'+uid)localStorage.removeItem(key);
   }
   clearLocalPracticeHistory(uid);setHistory([]);setEdit(null);
  }catch{setHistoryError('The reset was not completed. Please retry while signed in.')}
  finally{setSaving(false)}
 };
 if(page==='replay')return <MarketReplay client={client} theme={theme} initialDay={replayChoice.day} initialReviewTradeId={replayChoice.tradeId} onHistoryChange={()=>setHistoryRevision(v=>v+1)} onClose={()=>setPage('home')}/>;
 return <div className="practice-shell practice-replay-first" data-practice-theme={theme}>
  <aside className="practice-sidebar">
   <div className="practice-brand"><img src="/logo.png" alt="Trading Vibes"/><span>trading<span>vibes</span><small>THE MARKET REPLAY APP</small></span></div>
   <div className="practice-nav-label">YOUR WORKSPACE</div>
   <nav aria-label="Main navigation">{menu.map(({id,label,icon:Icon})=><button key={id} type="button" aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={19}/><span>{label}</span>{page===id&&<ChevronRight size={15}/>}</button>)}</nav>
   <div className="practice-sidebar-bottom"><div className="practice-sidebar-note"><RotateCcw size={19}/><strong>Replay it. Learn from it.</strong><p>Every session gives you another chance to refine your decisions.</p></div><button type="button" onClick={onSignOut}><LogOut size={18}/> Sign out</button></div>
  </aside>
  <main className="practice-main">
   <header className="practice-top"><div><span className="practice-top-kicker">TRADING VIBES · MARKET REPLAY</span><strong>{menu.find(item=>item.id===page)?.label}</strong></div><div className="practice-account"><button type="button" aria-label={theme==='dark'?'Switch to light theme':'Switch to dark theme'} onClick={onThemeToggle}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button><button type="button" onClick={onSignOut}>Sign out</button><b title={name}>{name.charAt(0).toUpperCase()}</b></div></header>
   <div className="practice-content">
    {page==='home'&&<>
     <section className="practice-greeting practice-replay-hero">
      <img className="practice-hero-photo" src={heroImage} alt="Trader smiling in a modern workspace"/>
      <div className="practice-hero-shade" aria-hidden="true"/>
      <div className="practice-replay-hero-copy"><span className="practice-overline"><span/> YOUR MARKET. YOUR PACE.</span><h1>Learn to trade<br/><em>by trading the past.</em></h1><p>Pick a real historical market day. Watch the candles unfold, place practice trades and see what your decisions could have done — without risking a rand.</p><button type="button" className="practice-primary" onClick={()=>openReplay()}><Play size={16} fill="currentColor"/> Launch Market Replay <ArrowRight size={16}/></button></div>
     </section>
     <div className="practice-section-head"><div><span className="practice-overline">ONE SIMPLE WAY TO GET BETTER</span><h2>Step into the market. Learn as you go.</h2><p>Everything you need to practise, from the first candle to the final review.</p></div></div>
     <div className="practice-info-grid practice-replay-steps">
      <article><span>01</span><CalendarDays size={24}/><h3>Pick your day</h3><p>Choose a historical Gold session and start from the exact time you want.</p></article>
      <article><span>02</span><Activity size={24}/><h3>Trade the replay</h3><p>Reveal candles, draw on the chart and place simulated orders with real decisions.</p></article>
      <article><span>03</span><BarChart3 size={24}/><h3>See your progress</h3><p>Review your trades, capture what you learned and build consistency over time.</p></article>
     </div>
     <div className="practice-home-action"><div><span className="practice-overline"><CheckCircle2 size={14}/> YOUR REPLAY JOURNEY</span><h2>Ready for your next session?</h2><p>Today's practice can sharpen tomorrow's decisions.</p></div><button type="button" className="practice-primary" onClick={()=>openReplay()}>Open Market Replay <ArrowRight size={16}/></button></div>
    </>}
    {page==='progress'&&<>
     <div className="practice-page-intro"><span className="practice-overline">MY PROGRESS</span><h1>Every session<br/><em>moves you forward.</em></h1><p>Your replay sessions, trade decisions and reflections in one place. Keep showing up and watch your practice add up.</p><button type="button" className="practice-primary" onClick={()=>openReplay()}><Play size={16} fill="currentColor"/> Start a replay <ArrowRight size={16}/></button></div>
     <div className="practice-history-status" role="status">{historyState==='loading'?'Checking your saved sessions…':historyState==='synced'?'Your session history is synced':'Showing sessions on this device · sync will retry'} {historyState==='local'&&<button type="button" onClick={()=>setHistoryRevision(v=>v+1)}>Retry sync</button>}</div>
     <div className="practice-history-stats"><div><span>TRADES PLACED</span><strong>{tradeRows.length}</strong></div><div><span>WON TRADES</span><strong className="is-profit">{tradeRows.filter(row=>row.trade.net>0).length}</strong></div><div><span>LOST TRADES</span><strong className="is-loss">{tradeRows.filter(row=>row.trade.net<0).length}</strong></div></div>
     {historyError&&<p className="practice-history-error" role="alert">{historyError}</p>}
     {tradeRows.length?<section className="practice-trades-list"><div className="practice-section-head"><div><span className="practice-overline">YOUR TRADING JOURNAL</span><h2>Trades you've practised.</h2><p>Select a trade to revisit that historical day or edit the saved review.</p></div></div>
      <div className="practice-trade-table-scroll"><table className="practice-trade-table"><thead><tr><th>Date</th><th>Asset</th><th>Side</th><th>Entry</th><th>Exit</th><th>Result</th><th>Review</th><th>Actions</th></tr></thead><tbody>
       {tradeRows.map(({record,trade})=><tr key={record.id+':'+trade.id}>
        <td><button type="button" className="practice-trade-day" onClick={()=>openReplay(record.day,trade.id)} title="Open this historical day">{record.day}</button></td>
        <td>Gold</td><td><span className={trade.side==='BUY'?'is-profit':'is-loss'}>{trade.side==='BUY'?'BUY':'SELL'}</span></td><td>{trade.entry.toFixed(3)}</td><td>{trade.exit.toFixed(3)}</td>
        <td className={trade.net>0?'is-profit':trade.net<0?'is-loss':''}>{money(trade.net)}</td>
        <td className="practice-trade-review">{record.annotations?.[trade.id]||<span className="practice-muted">Add a review</span>}</td>
        <td><div className="practice-trade-actions"><button type="button" title="Edit trade review" aria-label="Edit trade review" disabled={saving} onClick={()=>setEdit({recordId:record.id,tradeId:trade.id,note:record.annotations?.[trade.id]||''})}><Pencil size={15}/></button><button type="button" title="Delete archived trade" aria-label="Delete archived trade" disabled={saving} onClick={()=>void deleteRecordedTrade(record,trade.id)}><Trash2 size={15}/></button></div></td>
       </tr>)}
      </tbody></table></div>
     </section>:<div className="practice-empty"><div className="practice-free-icon"><BarChart3 size={22}/></div><h2>No trades placed yet.</h2><p>Open Market Replay, place a simulated trade, and close it to see your trade journal here.</p><button type="button" className="practice-primary" onClick={()=>openReplay()}>Launch Market Replay <ArrowRight size={16}/></button></div>}
     {edit&&<div className="practice-review-backdrop" onClick={()=>setEdit(null)}><form className="practice-review-dialog" role="dialog" aria-modal="true" aria-label="Edit trade review" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();const record=history.find(item=>item.id===edit.recordId);if(record){void saveRecord({...record,annotations:{...(record.annotations||{}),[edit.tradeId]:edit.note.trim().slice(0,1200)}}).then(()=>setEdit(null))}}}><span className="practice-overline">MY PROGRESS</span><h3>Edit trade review</h3><p>What did you see? What would you do differently?</p><textarea aria-label="Trade review" rows={5} maxLength={1200} autoFocus value={edit.note} onChange={e=>setEdit(value=>value?{...value,note:e.target.value}:null)}/><div><button type="button" onClick={()=>setEdit(null)}>Cancel</button><button type="submit" disabled={saving}><Save size={15}/> Save review</button></div></form></div>}
     <div className="practice-danger-zone"><p>Want to start fresh? Remove saved replay sessions, drawings and trade reviews for this account.</p><button type="button" disabled={saving} onClick={()=>void resetProgress()}><Trash2 size={15}/> Reset replay data</button></div>

    </>}
   </div>
  </main>
  <nav className="practice-mobile-nav" aria-label="Mobile navigation">{menu.map(({id,label,icon:Icon})=><button key={id} type="button" aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
 </div>;
}
