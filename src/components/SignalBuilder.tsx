import {useCallback,useEffect,useState} from 'react';
import {Activity,ArrowRight,Bell,Check,Clock3,Plus,RefreshCw,Trash2} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import {ALERT_TF,validateAlertRule,type AlertRule,type Condition} from '../../shared/market-alerts';
import './signal-builder.css';

type Saved={id:string;name:string;asset:string};
type Status={connected:boolean;configured:boolean;personalBot?:string|null};
type SignalRecord={id:string;revision:string;rule:AlertRule;state:string;runtime?:{running:boolean;events?:unknown[];dataStatus?:string}|null;error?:string};
const kinds=[
 {value:'above',label:'Price closes above'}, {value:'below',label:'Price closes below'},
 {value:'touch',label:'Price touches'},
 {value:'rsi_above',label:'RSI rises above'}, {value:'rsi_below',label:'RSI falls below'},
 {value:'sweep_high',label:'Sweeps previous highs'}, {value:'sweep_low',label:'Sweeps previous lows'},
 {value:'break_high',label:'Breaks previous highs'}, {value:'break_low',label:'Breaks previous lows'}
] as const;
type Kind=typeof kinds[number]['value'];
const isPrice=(kind:Kind)=>['above','below','touch'].includes(kind);
const isRsi=(kind:Kind)=>kind.startsWith('rsi');
const isRange=(kind:Kind)=>kind.includes('sweep')||kind.includes('break');
export function readSignalDescription(text:string):{kind:Kind;value:number|null;timeframe:keyof typeof ALERT_TF;lookback:number}|null{
 const t=text.toLowerCase();
 if(!/\b(?:gold|xauusd|price|rsi|sweep|break|high|low)\b/.test(t))return null;
 const tf=(t.match(/\b(m1|m5|m15|m30|h1|h4|d1)\b/i)?.[1]?.toLowerCase()||'m5') as keyof typeof ALERT_TF;
 const lookback=Math.min(200,Math.max(2,Number(t.match(/(?:previous|last)\s+(\d{1,3})\s+(?:candles?|bars?)/)?.[1]||5)));
 if(/\bsweep(?:s|ing)?\b/.test(t))return {kind:/\b(?:low|lows|sellside|sell-side)\b/.test(t)?'sweep_low':'sweep_high',value:null,timeframe:tf,lookback};
 if(/\bbreak(?:s|out)?\b/.test(t)&&/\b(?:high|low|range)\b/.test(t))return {kind:/\b(?:low|lows|below)\b/.test(t)?'break_low':'break_high',value:null,timeframe:tf,lookback};
 const numeric=t.match(/\b(?:above|over|below|under|touch|touches|reaches|cross(?:es)?|at)\s+(?:price\s+)?(\d+(?:[.,]\d+)?)/);
 const rsi=/\brsi\b/.test(t);
 const rsiNumber=t.match(/\brsi\s*(?:14)?\s*(?:above|below|over|under|cross(?:es)?|at|[<>])\s*(\d+(?:\.\d+)?)/);
 const value=Number((rsiNumber?.[1]||numeric?.[1]||'').replace(',','.'));
 if(!Number.isFinite(value)||value<=0)return null;
 const below=/\b(?:below|under|drops?|falls?|down)\b/.test(t);
 return {kind:rsi?(below?'rsi_below':'rsi_above'):/\btouch(?:es)?\b/.test(t)?'touch':below?'below':'above',value,timeframe:tf,lookback};
}
export function SignalBuilder({client,active,bots=[],initialStrategyId='',initialDraftText='',onOpenApps,onViewHistory}:{
 client:CloudClient|null;active:boolean;bots?:Saved[];initialStrategyId?:string;initialDraftText?:string;onOpenApps:()=>void;onViewHistory:()=>void
}){
 const [rows,setRows]=useState<SignalRecord[]>([]),[selected,setSelected]=useState<SignalRecord|null>(null);
 const [status,setStatus]=useState<Status>({connected:false,configured:false}),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [name,setName]=useState(''),[description,setDescription]=useState(''),[kind,setKind]=useState<Kind>('above');
 const [timeframe,setTimeframe]=useState<keyof typeof ALERT_TF>('m5'),[value,setValue]=useState(''),[lookback,setLookback]=useState(5),[period,setPeriod]=useState(14);
 const [strategyId,setStrategyId]=useState('');
 const call=<T,>(url:string,method:'GET'|'POST'='GET',body?:unknown)=>{if(!client)throw Error('Sign in to create signals');return sharingRequest<T>(client,url,method,body)};
 const refresh=useCallback(async()=>{if(!client)return;
  const [list,tg]=await Promise.all([sharingRequest<{alerts:SignalRecord[]}>(client,'/api/market-alerts'),sharingRequest<Status>(client,'/api/telegram/status')]);
  setRows(list.alerts||[]);setStatus(tg);
 },[client]);
 useEffect(()=>{if(!active||!client)return;void refresh().catch(e=>setError(e instanceof Error?e.message:'Could not load signals'));
  const timer=window.setInterval(()=>{if(!document.hidden)void refresh().catch(()=>{})},30000);return()=>window.clearInterval(timer);
 },[active,client,refresh]);
 useEffect(()=>{if(initialStrategyId)setStrategyId(initialStrategyId)},[initialStrategyId]);
 useEffect(()=>{if(!initialDraftText)return;setDescription(initialDraftText);const parsed=readSignalDescription(initialDraftText);if(parsed){setKind(parsed.kind);setTimeframe(parsed.timeframe);setLookback(parsed.lookback);if(parsed.value!==null)setValue(String(parsed.value));}},[initialDraftText]);
 const act=async(label:string,fn:()=>Promise<void>)=>{if(busy)return;setBusy(label);setError('');setNotice('');
  try{await fn()}catch(e){setError(e instanceof Error?e.message:'Signal request failed')}finally{setBusy('')}
 };
 const applyDescription=()=>{const parsed=readSignalDescription(description);if(!parsed){setError('Describe a price level, RSI threshold, sweep or range breakout, or use the condition fields below.');return}setError('');setKind(parsed.kind);setTimeframe(parsed.timeframe);setLookback(parsed.lookback);if(parsed.value!==null)setValue(String(parsed.value));setNotice('Condition recognized. Review the fields below, then create your signal.')};
 const create=()=>void act('create',async()=>{
  const numeric=Number(value),needsValue=isPrice(kind)||isRsi(kind);
  if(needsValue&&(!Number.isFinite(numeric)||numeric<=0))throw Error('Enter a valid price or indicator threshold.');
  const condition:Condition={id:'c1',kind,...(needsValue?{value:numeric}:{}),...(isRsi(kind)?{period}:{}),...(isRange(kind)?{lookback}:{})};
  const nameValue=name.trim()||'Gold '+kinds.find(x=>x.value===kind)?.label.toLowerCase()+(needsValue?' '+numeric:'');
  const rule:AlertRule={name:nameValue.slice(0,80),symbol:'XAUUSD',timeframe,mode:'all',conditions:[condition],
   notifyStages:false,cooldownSeconds:300,sequenceSeconds:3600,expiresAt:Math.floor(Date.now()/1000)+7*86400,
   repeat:true,session:null,basis:kind==='touch'?'live-price':'completed-candle',strategy:null};
  validateAlertRule(rule);
  const row=await call<SignalRecord>('/api/market-alerts','POST',rule);
  setSelected(row);setName('');setDescription('');
  if(status.connected){
   await call('/api/market-alerts/'+encodeURIComponent(row.id)+'/control','POST',{action:'start',revision:row.revision});
   setSelected(await call<SignalRecord>('/api/market-alerts/'+encodeURIComponent(row.id)));
   setNotice('Signal is live. Telegram will notify you when the setup appears.');
  }else{setNotice('Signal saved as a draft. Connect Telegram in Apps to activate it.')}
  await refresh();
 });
 const createStrategy=()=>void act('strategy',async()=>{
  if(!strategyId)throw Error('Choose a saved Gold strategy first.');
  const row=await call<SignalRecord>('/api/market-alerts/from-strategy','POST',{botId:strategyId});
  setSelected(row);setNotice('Strategy-based signal prepared. Review it and activate it when Telegram is connected.');await refresh();
 });
 const control=(action:'start'|'pause'|'delete')=>void act(action,async()=>{
  if(!selected)return;if(action==='delete'&&!window.confirm('Delete this signal? Sent notification history will be retained.'))return;
  await call('/api/market-alerts/'+encodeURIComponent(selected.id)+'/control','POST',{action,...(action==='start'?{revision:selected.revision}:{})});
  setNotice(action==='start'?'Signal started.':action==='pause'?'Signal paused.':'Signal deleted.');
  if(action==='delete')setSelected(null);else setSelected(await call<SignalRecord>('/api/market-alerts/'+encodeURIComponent(selected.id)));
  await refresh();
 });
 const choose=(row:SignalRecord)=>void act('read',async()=>{setSelected(await call<SignalRecord>('/api/market-alerts/'+encodeURIComponent(row.id)))});
 const summary=kinds.find(x=>x.value===kind)?.label||kind;
 return <div className="tv-signal-builder">
  {!client?<div className="tv-signal-panel">Sign in to create signals.</div>:<>
  <div className="tv-signal-builder-grid">
   <section className="tv-signal-panel tv-signal-new" aria-labelledby="tv-create-signal-title">
    <div className="tv-panel-heading"><span className="tv-signal-kicker"><Plus size={14}/> NEW SIGNAL</span><h2 id="tv-create-signal-title">Tell VIBES what to watch.</h2><p>Set a Gold market condition. Trading Vibes checks it live and notifies you when it matches.</p></div>
    <label className="tv-signal-field"><span>Describe your setup <small>optional</small></span><textarea rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Example: Notify me when Gold closes above 4000 on M5"/></label>
    <button type="button" className="tv-secondary-action" disabled={!description.trim()||!!busy} onClick={applyDescription}>Use this description <ArrowRight size={14}/></button>
    <div className="tv-signal-form-row"><label className="tv-signal-field"><span>Market</span><input readOnly value="Gold · XAUUSD" aria-label="Market"/></label>
     <label className="tv-signal-field"><span>Timeframe</span><select value={timeframe} onChange={e=>setTimeframe(e.target.value as keyof typeof ALERT_TF)}>{Object.keys(ALERT_TF).map(tf=><option key={tf} value={tf}>{tf.toUpperCase()}</option>)}</select></label></div>
    <label className="tv-signal-field"><span>Condition</span><select value={kind} onChange={e=>setKind(e.target.value as Kind)}>{kinds.map(k=><option value={k.value} key={k.value}>{k.label}</option>)}</select></label>
    <div className="tv-signal-form-row">
     {(isPrice(kind)||isRsi(kind))&&<label className="tv-signal-field"><span>{isRsi(kind)?'RSI threshold':'Price level'}</span><input type="number" min="0.01" max={isRsi(kind)?100:undefined} step="any" value={value} onChange={e=>setValue(e.target.value)} placeholder={isRsi(kind)?'70':'4000'}/></label>}
     {isRsi(kind)&&<label className="tv-signal-field"><span>RSI period</span><input type="number" min={2} max={200} value={period} onChange={e=>setPeriod(Number(e.target.value))}/></label>}
     {isRange(kind)&&<label className="tv-signal-field"><span>Previous candles</span><input type="number" min={2} max={200} value={lookback} onChange={e=>setLookback(Number(e.target.value))}/></label>}
     <label className="tv-signal-field"><span>Signal name <small>optional</small></span><input maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="My Gold setup"/></label>
    </div>
    <div className="tv-signal-review"><Check size={15}/><span>When <strong>{summary.toLowerCase()}{(isPrice(kind)||isRsi(kind))&&value?' '+value:''}</strong> on {timeframe.toUpperCase()}, notify me. Repeat after the condition resets.</span></div>
    <button type="button" className="tv-signal-primary-action" disabled={!!busy} onClick={create}>{busy==='create'?'Creating…':status.connected?'Create & start signal':'Save signal draft'} <ArrowRight size={16}/></button>
    <p className="tv-signal-small-note">Signals watch conditions. Backtest separately to measure simulated entries, exits and performance.</p>
   </section>
   <aside className="tv-signal-builder-side">
    <section className="tv-signal-panel tv-signal-connection"><span className="tv-signal-kicker"><Bell size={14}/> DELIVERY</span><h3>{status.connected?'Telegram connected':'Connect Telegram'}</h3><p>{status.connected?'Your notifications will be delivered to your connected chat.':'You can save signals now. Connect Telegram in Apps to receive notifications.'}</p><button type="button" className="tv-secondary-action" onClick={onOpenApps}>{status.connected?'Manage Telegram':'Open Telegram settings'} <ArrowRight size={14}/></button></section>
    <section className="tv-signal-panel"><span className="tv-signal-kicker"><Activity size={14}/> FROM BACKTEST</span><h3>Use a saved strategy</h3><p>Already tested a strategy? Track the same BUY/SELL conditions without placing orders.</p><label className="tv-signal-field"><span>Saved Gold strategy</span><select value={strategyId} onChange={e=>setStrategyId(e.target.value)}><option value="">Choose strategy</option>{bots.filter(b=>['XAUUSD','GOLDUSDC'].includes(b.asset)).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="tv-secondary-action" type="button" disabled={!strategyId||!!busy} onClick={createStrategy}>Create from strategy <ArrowRight size={14}/></button></section>
   </aside>
  </div>
  <section className="tv-signal-panel tv-signal-owned"><div className="tv-signal-owned-heading"><div><span className="tv-signal-kicker"><Clock3 size={14}/> YOUR SIGNALS</span><h2>Conditions you're tracking</h2></div><button type="button" className="tv-secondary-action" disabled={!!busy} onClick={()=>void act('refresh',refresh)}><RefreshCw size={14}/> Refresh</button></div>
   {rows.length===0?<div className="tv-signal-empty-copy"><Bell size={20}/><p>No signals yet. Your first condition will appear here.</p></div>:
   <div className="tv-signal-owned-list">{rows.map(row=><button type="button" className={'tv-signal-owned-row'+(selected?.id===row.id?' is-selected':'')} key={row.id} onClick={()=>choose(row)}><span className="tv-signal-owned-symbol">XAU</span><span><strong>{row.rule?.name||'Gold signal'}</strong><small>{row.rule?.timeframe?.toUpperCase()} · {row.rule?.conditions?.length||1} condition(s)</small></span><span className={'tv-signal-status '+(row.state==='active'?'is-active':'')}>{row.state==='active'?'Enabled':row.state==='draft'?'Draft':row.state==='paused'?'Paused':row.state}</span></button>)}</div>}
   {selected&&<div className="tv-signal-selected"><h3>{selected.rule.name}</h3><p>{selected.rule.conditions.map(c=>kinds.find(k=>k.value===c.kind)?.label+' '+(c.value??'')).join(' · ')} · {selected.rule.timeframe.toUpperCase()}</p><div className="tv-signal-action-row"><button className="tv-signal-primary-action" disabled={!!busy||!status.connected||selected.state==='active'} onClick={()=>control('start')}>Start signal</button><button className="tv-secondary-action" disabled={!!busy} onClick={()=>control('pause')}>Pause</button><button className="tv-danger-action" disabled={!!busy} onClick={()=>control('delete')}><Trash2 size={14}/> Delete</button><button className="tv-secondary-action" onClick={onViewHistory}>Sent history <ArrowRight size={14}/></button></div>{selected.runtime&&<p className="tv-signal-runtime">Runtime: {selected.runtime.running?'Watching for conditions':'Not currently monitoring'}{selected.runtime.dataStatus?' · '+selected.runtime.dataStatus:''}</p>}{selected.error&&<p role="status" className="tv-signal-error">{selected.error}</p>}</div>}
  </section>
  {notice&&<p role="status" className="tv-signal-notice">{notice}</p>}{error&&<p role="alert" className="tv-signal-error">{error}</p>}
  </>}
 </div>;
}
