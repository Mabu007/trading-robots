import {useEffect,useState} from 'react';
import {Activity,ArrowRight,BarChart3,CalendarDays,CheckCircle2,ChevronRight,Home,LogOut,Moon,Play,RotateCcw,Sun} from 'lucide-react';
import {mergePracticeHistory,readLocalHistory,syncPracticeHistory,type PracticeRecord} from '../practice-history';
import type {CloudClient} from '../firebase';
import type {AppTheme} from '../theme';
import {MarketReplay} from './MarketReplay';
import './practice-app.css';

type Page='home'|'replay'|'progress';
type Props={client:CloudClient;theme:AppTheme;onSignOut:()=>void;onThemeToggle:()=>void};
const menu=[{id:'home',label:'Home',icon:Home},{id:'replay',label:'Market Replay',icon:Activity},{id:'progress',label:'My Progress',icon:BarChart3}] as const;
const heroImage='https://pub-60ec726f38cd437c94063e4c72071321.r2.dev/Confident%20Trader%20in%20a%20Modern%20Workspace.png';
const formatPaperMoney=(record:PracticeRecord)=>{
 if(!record.tradeCount)return 'Observed';
 if(record.currency!=='ZAR')return 'Legacy session';
 return (record.net>=0?'+':'−')+'R'+Math.abs(record.net).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2});
};
export function PracticeApp({client,theme,onSignOut,onThemeToggle}:Props){
 const [page,setPage]=useState<Page>('home');
 const [history,setHistory]=useState<PracticeRecord[]>([]);
 const [historyState,setHistoryState]=useState<'loading'|'synced'|'local'>('loading');
 const [historyRevision,setHistoryRevision]=useState(0);
 const profile=client.getProfile(),name=profile?.displayName?.trim().split(' ')[0]||'trader';
 useEffect(()=>{const uid=profile?.uid;if(!uid)return;let active=true;
  setHistory(mergePracticeHistory(readLocalHistory(uid),[]));setHistoryState('loading');
  void (async()=>{try{await syncPracticeHistory(uid,client);const remote=await client.listPracticeRecords();if(active){setHistory(mergePracticeHistory(readLocalHistory(uid),remote));setHistoryState('synced')}}catch{if(active){setHistory(mergePracticeHistory(readLocalHistory(uid),[]));setHistoryState('local')}}})();
  return()=>{active=false};
 },[client,profile?.uid,historyRevision]);
 const openReplay=()=>setPage('replay');
 if(page==='replay')return <MarketReplay client={client} theme={theme} onHistoryChange={()=>setHistoryRevision(v=>v+1)} onClose={()=>setPage('home')}/>;
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
      <div className="practice-replay-hero-copy"><span className="practice-overline"><span/> YOUR MARKET. YOUR PACE.</span><h1>Learn to trade<br/><em>by trading the past.</em></h1><p>Pick a real historical market day. Watch the candles unfold, place practice trades and see what your decisions could have done — without risking a rand.</p><button type="button" className="practice-primary" onClick={openReplay}><Play size={16} fill="currentColor"/> Launch Market Replay <ArrowRight size={16}/></button></div>
     </section>
     <div className="practice-section-head"><div><span className="practice-overline">ONE SIMPLE WAY TO GET BETTER</span><h2>Step into the market. Learn as you go.</h2><p>Everything you need to practise, from the first candle to the final review.</p></div></div>
     <div className="practice-info-grid practice-replay-steps">
      <article><span>01</span><CalendarDays size={24}/><h3>Pick your day</h3><p>Choose a historical Gold session and start from the exact time you want.</p></article>
      <article><span>02</span><Activity size={24}/><h3>Trade the replay</h3><p>Reveal candles, draw on the chart and place simulated orders with real decisions.</p></article>
      <article><span>03</span><BarChart3 size={24}/><h3>See your progress</h3><p>Review your trades, capture what you learned and build consistency over time.</p></article>
     </div>
     <div className="practice-home-action"><div><span className="practice-overline"><CheckCircle2 size={14}/> YOUR REPLAY JOURNEY</span><h2>Ready for your next session?</h2><p>Today's practice can sharpen tomorrow's decisions.</p></div><button type="button" className="practice-primary" onClick={openReplay}>Open Market Replay <ArrowRight size={16}/></button></div>
    </>}
    {page==='progress'&&<>
     <div className="practice-page-intro"><span className="practice-overline">MY PROGRESS</span><h1>Every session<br/><em>moves you forward.</em></h1><p>Your replay sessions, trade decisions and reflections in one place. Keep showing up and watch your practice add up.</p><button type="button" className="practice-primary" onClick={openReplay}><Play size={16} fill="currentColor"/> Start a replay <ArrowRight size={16}/></button></div>
     <div className="practice-history-status" role="status">{historyState==='loading'?'Checking your saved sessions…':historyState==='synced'?'Your session history is synced':'Showing sessions on this device · sync will retry'} {historyState==='local'&&<button type="button" onClick={()=>setHistoryRevision(v=>v+1)}>Retry sync</button>}</div>
     <div className="practice-history-stats"><div><span>SESSIONS COMPLETED</span><strong>{history.length}</strong></div><div><span>CANDLES REPLAYED</span><strong>{history.reduce((sum,r)=>sum+r.candlesViewed,0).toLocaleString('en-ZA')}</strong></div><div><span>PAPER TRADES</span><strong>{history.reduce((sum,r)=>sum+r.tradeCount,0)}</strong></div></div>
     {history.length?<section className="practice-history-list"><h2>Recent sessions</h2>{history.map(record=><article key={record.id}><div><span className="practice-overline">MARKET REPLAY</span><h3>Gold · {record.day}</h3><p>{new Date(record.completedAt).toLocaleString()} · {record.candlesViewed} candles · {record.tradeCount} simulated {record.tradeCount===1?'trade':'trades'}</p>{record.notes&&<blockquote>{record.notes}</blockquote>}</div><strong>{formatPaperMoney(record)}</strong></article>)}</section>:<div className="practice-empty"><div className="practice-free-icon"><BarChart3 size={22}/></div><h2>Your first replay is waiting.</h2><p>Complete a Market Replay session and save it to see your progress here. Observing without trading counts too.</p><button type="button" className="practice-primary" onClick={openReplay}>Launch Market Replay <ArrowRight size={16}/></button></div>}
    </>}
   </div>
  </main>
  <nav className="practice-mobile-nav" aria-label="Mobile navigation">{menu.map(({id,label,icon:Icon})=><button key={id} type="button" aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
 </div>;
}
