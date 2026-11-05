import {useEffect,useMemo,useState} from 'react';
import {Activity,ArrowRight,Bot,Clock3,Code2,Search,Sparkles,Terminal, X} from 'lucide-react';
import type {CloudBot} from '../firebase';
import type {PersistentAgent} from '../agents';
import {venueLabel} from '../../shared/venues';
import './code-library.css';

type Runtime={state:string;verified?:boolean;lastSignal?:string|null;nextCheck?:number|null;openPositions?:number|null;error?:string|null};
type Props={bots:CloudBot[];current:CloudBot|null;agents:PersistentAgent[];runtimeStates:Record<string,Runtime>;onAsk:(question:string)=>void;onRun:(bot:CloudBot)=>void;onDeploy:(bot:CloudBot)=>void;onCreate:()=>void;onLoadCode:(bot:CloudBot)=>Promise<string>};
export function codeState(bot:CloudBot,agents:PersistentAgent[],states:Record<string,Runtime>):'Running'|'Stopped'|'Checking'|'Saved'{
 const agent=agents.find(a=>a.botId===bot.id&&a.mode==='live');
 if(!agent)return 'Saved';
 const live=states[agent.id];
 if(!live||live.verified!==true)return 'Checking';
 return live.state==='running'?'Running':live.state==='unknown'?'Checking':'Stopped';
}
export function CodeLibrary({bots,current,agents,runtimeStates,onAsk,onRun,onDeploy,onCreate,onLoadCode}:Props){
 const [query,setQuery]=useState(''),[selected,setSelected]=useState<CloudBot|null>(null),[source,setSource]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const items=useMemo(()=>{const saved=[...bots];if(current&&!saved.some(b=>b.id===current.id))saved.unshift(current);return saved.filter(b=>(b.name+' '+b.asset+' '+b.venue).toLowerCase().includes(query.toLowerCase()))},[bots,current,query]);
 useEffect(()=>{if(!selected)return;const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(null)};window.addEventListener('keydown',dismiss);return()=>window.removeEventListener('keydown',dismiss)},[selected]);
 const inspect=async(bot:CloudBot)=>{setSelected(bot);setError('');setSource(null);setLoading(true);try{const loaded=await onLoadCode(bot);setSource(loaded)}catch(e){setError(e instanceof Error?e.message:'Could not load the saved source.')}finally{setLoading(false)}};
 const action=(bot:CloudBot,kind:'ask'|'run'|'deploy')=>{setSelected(null);if(kind==='ask')onAsk('Explain the saved code named "'+bot.name+'". What does it do and how could we reuse it?');else if(kind==='run')onRun(bot);else onDeploy(bot)};
 return <section className="tv-code-library" aria-labelledby="tv-code-title">
  <header className="tv-code-head"><div><span className="tv-code-eyebrow"><Code2 size={15}/> CODE LIBRARY</span><h1 id="tv-code-title">Your code.</h1><p>Strategies and reusable code live here. Ask AI to find, explain, test, or deploy saved code.</p></div><button type="button" className="tv-code-new" onClick={onCreate}><Sparkles size={16}/> Write with AI</button></header>
  <div className="tv-code-tools"><label className="tv-code-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search saved code" placeholder="Search code, market or venue…"/></label><span>{items.length} {items.length===1?'item':'items'}</span></div>
  <div className="tv-code-list">{items.length?items.map(bot=>{const state=codeState(bot,agents,runtimeStates);const agent=agents.find(a=>a.botId===bot.id&&a.mode==='live');return <article className="tv-code-item" key={bot.id}><span className="tv-code-item-icon"><Code2 size={18}/></span><div className="tv-code-item-content"><div className="tv-code-item-title"><strong>{bot.name||'Untitled code'}</strong><span className={'tv-code-state '+state.toLowerCase()}><i/>{state}</span></div><p>{bot.asset||'Unknown market'} · {venueLabel[bot.venue||'valr']} · Deterministic strategy.js</p><small>{bot.lastBacktest?'Last backtest · '+bot.lastBacktest.from+' to '+bot.lastBacktest.to:'No saved backtest yet'}{agent?.deployment?' · Deployed version '+agent.strategy.version:''}</small></div><div className="tv-code-item-actions"><button type="button" onClick={()=>void inspect(bot)}><Code2 size={15}/> View</button><button type="button" onClick={()=>action(bot,'run')}><Activity size={15}/> Run</button><button type="button" className="tv-code-icon-action" title="Discuss with AI" aria-label={'Discuss '+bot.name+' with AI'} onClick={()=>action(bot,'ask')}><Sparkles size={15}/></button></div></article>}):<div className="tv-code-empty"><Bot size={23}/><strong>No matching code</strong><p>Ask AI to write a strategy, or search your existing saved strategies by name.</p><button onClick={onCreate}>Create with AI <ArrowRight size={14}/></button></div>}</div>
  {selected&&<div className="tv-code-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><section className="tv-code-modal" role="dialog" aria-modal="true" aria-labelledby="tv-code-modal-title"><header><div><span className="tv-code-eyebrow"><Terminal size={14}/> SAVED CODE · READ ONLY</span><h2 id="tv-code-modal-title">{selected.name||'Untitled code'}</h2><p>{selected.asset} · {venueLabel[selected.venue||'valr']}</p></div><button type="button" aria-label="Close code details" onClick={()=>setSelected(null)}><X size={18}/></button></header>
   <div className="tv-code-modal-body"><div className="tv-code-info"><span>Runtime <strong className={codeState(selected,agents,runtimeStates).toLowerCase()}>{codeState(selected,agents,runtimeStates)}</strong></span><span>Execution <strong>{agents.find(a=>a.botId===selected.id)?.configuration.executionTimeframe?.toUpperCase()||'Not verified'}</strong></span><span>Last backtest <strong>{selected.lastBacktest?String(selected.lastBacktest.candleCount)+' candles':'Not yet'}</strong></span></div>
    {agents.filter(a=>a.botId===selected.id&&a.mode==='live').map(agent=><div className="tv-code-runtime" key={agent.id}><strong>Durable runtime</strong><span>Last verified state: {runtimeStates[agent.id]?.verified?runtimeStates[agent.id].state:'Not verified'}</span><span>Last signal: {runtimeStates[agent.id]?.lastSignal||'Not reported'}</span><span>Next check: {runtimeStates[agent.id]?.nextCheck?new Date(runtimeStates[agent.id].nextCheck!).toLocaleString():'Not reported'}</span><span>Deployment version: {agent.strategy.version}</span>{runtimeStates[agent.id]?.error&&<span role="alert">{runtimeStates[agent.id].error}</span>}</div>)}
    {loading?<p className="tv-code-message">Loading verified saved source…</p>:error?<p className="tv-code-message" role="alert">{error}</p>:<pre tabIndex={0} className="tv-code-source"><code>{source||'No saved code returned.'}</code></pre>}
   </div>
   <footer><button type="button" onClick={()=>action(selected,'ask')}><Sparkles size={15}/> Discuss</button><button type="button" onClick={()=>action(selected,'run')}><Activity size={15}/> Backtest</button><button type="button" className="tv-code-new" onClick={()=>action(selected,'deploy')}><Clock3 size={15}/> Review deployment</button></footer>
  </section></div>}
 </section>;
}
