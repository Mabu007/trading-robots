import {displayTime} from '../display-time';
import {useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {Activity,ArrowRight,Bot,Clock3,Code2,Eye,Pencil,Plus,RefreshCw,Search,Sparkles,Trash2,X} from 'lucide-react';
import {Dialog} from './Dialog';
import type {CloudBot, CloudClient} from '../firebase';
import {StrategyWorkbench, type WorkbenchView} from './StrategyWorkbench';
import {PropDAODeployDialog} from './Marketplace';
import {DeployedRobotInspector} from './DeployedRobotInspector';
import type {StrategyRun} from '../strategy-workbench';
import type {Trade} from '../types';
import type {AppTheme} from '../theme';
import type {CodeAnalysis} from '../code-analysis';
import type {PersistentAgent} from '../agents';
import {venueLabel} from '../../shared/venues';
import './code-library.css';

type Runtime={state:string;verified?:boolean;lastSignal?:string|null;nextCheck?:number|null;openPositions?:number|null;error?:string|null};
export type CodeWatchStatus={id:string;running:boolean;verified:boolean;lastCandle?:number|null;nextAlarm?:number|null;lastCheck?:number|null;error?:string|null;events?:{id:string;time:number;kind:string;level:number;price:number;output?:string}[]};
type Props={
 client:CloudClient|null; bots:CloudBot[]; current:CloudBot|null; analyses:CodeAnalysis[];
 watches:Record<string,CodeWatchStatus>; agents:PersistentAgent[]; runtimeStates:Record<string,Runtime>;
 onAsk:(question:string,bot?:CloudBot)=>void; onSaved:(bot:CloudBot)=>void;
 onAuditTrade?:(run:StrategyRun,trade:Trade,bot:CloudBot|null)=>void;
 onConnectBroker?:()=>void; theme?:AppTheme;
 onRenameBot:(bot:CloudBot,name:string)=>Promise<void>; onDeleteBot:(bot:CloudBot)=>Promise<void>;
 onRenameAnalysis:(analysis:CodeAnalysis,name:string)=>Promise<void>; onDeleteAnalysis:(analysis:CodeAnalysis)=>Promise<void>;
 onRunAnalysis:(asset:CodeAnalysis)=>void; onWatch:(asset:CodeAnalysis)=>void; onStopWatch:(asset:CodeAnalysis)=>void;
 onDeploy:(bot:CloudBot,riskPercent:number,codeHash?:string)=>void; deploymentError?:string; onRefreshDeployments:()=>Promise<void>|void;
 onManageDeployment:(agent:PersistentAgent,action:'status'|'stop')=>Promise<any>;
};
export function codeState(bot:CloudBot,agents:PersistentAgent[],states:Record<string,Runtime>):'Running'|'Paused'|'Stopped'|'Checking'|'Saved'{
 const agent=agents.find(a=>a.botId===bot.id&&a.mode==='live');
 if(!agent)return 'Saved';
 const live=states[agent.id];
 if(!live||live.verified!==true)return 'Checking';
 if(live.state==='running')return 'Running';
 if(live.state==='paused')return 'Paused';
 return live.state==='stopped'||live.state==='not-deployed'?'Stopped':'Checking';
}
export function CodeLibrary({client,bots,current,analyses,watches,agents,runtimeStates,onAsk,onSaved,onRenameBot,onDeleteBot,onRenameAnalysis,onDeleteAnalysis,onRunAnalysis,onWatch,onStopWatch,onDeploy,deploymentError,onRefreshDeployments,onManageDeployment,onAuditTrade,onConnectBroker,theme}:Props){
 const deployments=agents.filter(agent=>agent.mode==='live'&&agent.deployment?.grantId).sort((a,b)=>(b.deployment?.authorizedAt||0)-(a.deployment?.authorizedAt||0));
 const [query,setQuery]=useState('');
 const [selectedAnalysis,setSelectedAnalysis]=useState<CodeAnalysis|null>(null);
 const [workbench,setWorkbench]=useState<{bot:CloudBot|null;view:WorkbenchView}|null>(null);
 const [localDeploy,setLocalDeploy]=useState<{bot:CloudBot;riskPercent:number;codeHash?:string}|null>(null);
 const [selectedDeployment,setSelectedDeployment]=useState<PersistentAgent|null>(null);
 const [refreshing,setRefreshing]=useState(false);
 const refreshDeployments=async()=>{
  if(refreshing)return;
  setRefreshing(true);
  try{await Promise.resolve(onRefreshDeployments());setOperationNotice('Refresh requested. Check each robot for broker-confirmed details; unavailable provider reads remain unverified.')}
  catch(cause){setOperationNotice('Could not refresh robot status: '+(cause instanceof Error?cause.message:'Unknown error'))}
  finally{setRefreshing(false)}
 };
 const openWorkbench=(bot:CloudBot|null,view:WorkbenchView)=>setWorkbench({bot,view});
 const [stopAgent,setStopAgent]=useState<PersistentAgent|null>(null),[stopBusy,setStopBusy]=useState(false),[operationNotice,setOperationNotice]=useState('');
 const manage=async(agent:PersistentAgent,action:'status'|'stop')=>{
  setStopBusy(true);setOperationNotice('');
  try{
   const outcome=await onManageDeployment(agent,action);
   if(outcome?.delegatedToChat){setOperationNotice('Opened the existing Chat-based management review for '+String(outcome.venue||'this broker')+'. No broker action has been executed.');return;}
   if(action==='stop'){
    setStopAgent(null);
    setOperationNotice(outcome?.authorizationRevoked?(outcome.runtimeStopped?'New-order authorization revoked and runtime stop confirmed. Existing positions and orders still require broker verification.':'New-order authorization revoked. Worker stop is UNVERIFIED; check broker exposure and reconcile before replacing the strategy.'):'Stop outcome could not be verified. Check the broker and refresh status.');
   }else setOperationNotice(outcome?.uncertain||outcome?.statusUnavailable?'Runtime status unknown. Do not assume there are no active positions.':outcome?.running?'Runtime reported running. Account: '+String(outcome?.accountId||'unavailable'):outcome?.authorizationRevoked?'New-order authorization revoked; Worker status requires verification.':'Runtime status checked. Account: '+String(outcome?.accountId||'unavailable'));
   void refreshDeployments();
  }catch(e){setOperationNotice('Operation could not be verified: '+(e instanceof Error?e.message:'Unknown error'))}
  finally{setStopBusy(false)}
 };
 const [codeAction,setCodeAction]=useState<{kind:'rename'|'delete';type:'bot'|'analysis';item:CloudBot|CodeAnalysis}|null>(null);
 const [actionName,setActionName]=useState(''),[actionError,setActionError]=useState(''),[actionBusy,setActionBusy]=useState(false);
 const chooseAction=(kind:'rename'|'delete',type:'bot'|'analysis',item:CloudBot|CodeAnalysis)=>{setActionError('');setActionName(item.name);setCodeAction({kind,type,item})};
 const confirmAction=async()=>{if(!codeAction||actionBusy)return;setActionBusy(true);setActionError('');try{if(codeAction.kind==='rename'){if(!actionName.trim())throw Error('Enter a name.');if(codeAction.type==='bot')await onRenameBot(codeAction.item as CloudBot,actionName);else await onRenameAnalysis(codeAction.item as CodeAnalysis,actionName)}else if(codeAction.type==='bot')await onDeleteBot(codeAction.item as CloudBot);else await onDeleteAnalysis(codeAction.item as CodeAnalysis);setCodeAction(null);setSelectedAnalysis(null)}catch(e){setActionError(e instanceof Error?e.message:'Could not update Code.')}finally{setActionBusy(false)}};

 const items=useMemo(()=>{const saved=[...bots];if(current&&!saved.some(b=>b.id===current.id))saved.unshift(current);return saved.filter(b=>(b.name+' '+b.asset+' '+b.venue).toLowerCase().includes(query.toLowerCase()))},[bots,current,query]);
 const analysisItems=useMemo(()=>analyses.filter(a=>(a.name+' '+a.asset+' '+a.venue+' '+a.kind).toLowerCase().includes(query.toLowerCase())),[analyses,query]);
 useEffect(()=>{
  if(!selectedAnalysis)return;
  const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelectedAnalysis(null)};
  window.addEventListener('keydown',dismiss);
  return()=>window.removeEventListener('keydown',dismiss);
 },[selectedAnalysis]);
 return <section className="tv-code-library" aria-labelledby="tv-code-title">
  <header className="tv-code-head"><div><span className="tv-code-eyebrow"><Code2 size={15}/> ROBOTS LIBRARY</span><h1 id="tv-code-title">Your robots.</h1><p>Write or generate a robot, backtest it, and review deployment here.</p></div><button type="button" className="tv-code-new" disabled={!client} onClick={()=>openWorkbench(null,'write')}><Plus size={16}/> Write a robot</button></header>
  <div className="tv-code-tools"><label className="tv-code-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search saved code" placeholder="Search code, market or venue…"/></label><span>{items.length+analysisItems.length} {items.length+analysisItems.length===1?'item':'items'}</span></div>
  <section className="tv-code-deployments" aria-labelledby="tv-deployments-title">
   <header><div><h3 id="tv-deployments-title">Deployed robots</h3><p>Every authorized robot, its runtime verification and broker exposure. Inspect a robot for its full operational record.</p></div>
    <button type="button" onClick={()=>void refreshDeployments()} disabled={refreshing}><RefreshCw size={14}/>{refreshing?'Refreshing…':'Refresh status'}</button></header>
   {deploymentError&&<p role="alert">{deploymentError}</p>}
    {operationNotice&&<p role="status">{operationNotice}</p>}
   {deployments.map(agent=>{
    const runtime=runtimeStates[agent.id];
    const state=runtime?.verified===true?runtime.state:'unverified';
    return <article className="tv-code-item" key={agent.id}>
     <span className="tv-code-item-icon"><Activity size={18}/></span>
     <div className="tv-code-item-content"><div className="tv-code-item-title"><strong>{agent.name}</strong><span className={'tv-code-state '+(state==='running'?'running':'')}><i/>{state==='unverified'?'Status unverified':state[0].toUpperCase()+state.slice(1)}</span></div>
      <p>{agent.asset} · {venueLabel[agent.venue]} · v{agent.strategy.revision}</p>
      {runtime?.lastSignal&&<small>Last signal · {runtime.lastSignal}</small>}
      {runtime?.error&&<small>{runtime.error}</small>}
     </div>
     <div className="tv-code-item-actions">
       <button type="button" className="tv-code-inspect-button" onClick={()=>setSelectedDeployment(agent)}><Eye size={15}/> Inspect & manage</button>
      <button type="button" onClick={()=>void manage(agent,'status')}>Quick check</button>
      {(state==='running'||state==='paused'||state==='unverified')&&<button type="button" onClick={()=>{if(agent.venue==='propdao')setStopAgent(agent);else void manage(agent,'stop')}}>{agent.venue==='propdao'?'Stop new entries':'Review stop'}</button>}
     </div>
    </article>;
   })}
    {!deployments.length&&!deploymentError&&<div className="tv-code-empty-deploy">
  <Bot size={21}/><strong>No deployed robots yet</strong>
  <span>Finish a saved backtest and deploy an exact reviewed revision. Only broker-confirmed deployments appear here.</span>
 </div>}
  </section>
  <div className="tv-code-list">{items.map(bot=>{const state=codeState(bot,agents,runtimeStates);const agent=agents.find(a=>a.botId===bot.id&&a.mode==='live');return <article className="tv-code-item" key={bot.id}><span className="tv-code-item-icon"><Code2 size={18}/></span><div className="tv-code-item-content"><div className="tv-code-item-title"><strong>{bot.name||'Untitled code'}</strong><span className={'tv-code-state '+state.toLowerCase()}><i/>{state}</span></div><p>{bot.asset||'Unknown market'} · {venueLabel[bot.venue||'valr']} · Deterministic strategy.js</p><small>{bot.lastBacktest?'Last backtest · '+bot.lastBacktest.from+' to '+bot.lastBacktest.to:'No saved backtest yet'}{agent?.deployment?' · Deployed version '+agent.strategy.version:''}</small></div><div className="tv-code-item-actions"><button type="button" disabled={!client} onClick={()=>openWorkbench(bot,'write')}><Code2 size={15}/> Open</button><button type="button" disabled={!client} onClick={()=>openWorkbench(bot,'backtest')}><Activity size={15}/> Run backtest</button>{bot.lastBacktest&&<button type="button" disabled={!client} onClick={()=>openWorkbench(bot,'result')}>View last result</button>}<button type="button" className="tv-code-icon-action" title="Discuss with AI" aria-label={'Discuss '+bot.name+' with AI'} onClick={()=>onAsk('Explain the saved strategy named "'+bot.name+'".',bot)}><Sparkles size={15}/></button><button type="button" className="tv-code-icon-action" title="Rename" aria-label={'Rename '+bot.name} onClick={()=>chooseAction('rename','bot',bot)}><Pencil size={15}/></button><button type="button" className="tv-code-icon-action" title="Delete" aria-label={'Delete '+bot.name} onClick={()=>chooseAction('delete','bot',bot)}><Trash2 size={15}/></button></div></article>})}{analysisItems.map(asset=><article className="tv-code-item" key={asset.id}><span className="tv-code-item-icon"><Activity size={18}/></span><div className="tv-code-item-content"><div className="tv-code-item-title"><strong>{asset.name}</strong><span className={"tv-code-state "+(watches[asset.id]?.verified&&watches[asset.id]?.running?"running":"")}><i/>{watches[asset.id]?.verified&&watches[asset.id]?.running?"Running":watches[asset.id]&&!watches[asset.id].verified?"Status unknown":"Callable"}</span></div><p>{asset.asset} · {venueLabel[asset.venue]} · {asset.timeframe.toUpperCase()} · {asset.kind==='liquidity_sweeps'?'Liquidity sweeps':'Volatility profile'}</p><small>Read-only deterministic analysis tool. Runs on verified historical candles.</small></div><div className="tv-code-item-actions"><button type="button" onClick={()=>setSelectedAnalysis(asset)}><Code2 size={15}/> View</button><button type="button" onClick={()=>onRunAnalysis(asset)}><Activity size={15}/> Run</button><button type="button" aria-label={'Discuss '+asset.name+' with AI'} onClick={()=>onAsk('Explain the saved Code analysis named "'+asset.name+'" and how its detection works.')}><Sparkles size={15}/></button><button type="button" className="tv-code-icon-action" aria-label={'Rename '+asset.name} onClick={()=>chooseAction('rename','analysis',asset)}><Pencil size={15}/></button><button type="button" className="tv-code-icon-action" aria-label={'Delete '+asset.name} onClick={()=>chooseAction('delete','analysis',asset)}><Trash2 size={15}/></button></div></article>)}{!(items.length||analysisItems.length)&&<div className="tv-code-empty"><Bot size={23}/><strong>No matching code</strong><p>Write a new strategy or search your saved strategies by name.</p><button disabled={!client} onClick={()=>openWorkbench(null,'write')}>Write a robot <ArrowRight size={14}/></button></div>}</div>
  {selectedAnalysis&&<div className="tv-code-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedAnalysis(null)}}><section className="tv-code-modal" role="dialog" aria-modal="true" aria-labelledby="tv-analysis-modal-title"><header><div><span className="tv-code-eyebrow"><Activity size={15}/> REUSABLE ANALYSIS · READ ONLY</span><h2 id="tv-analysis-modal-title">{selectedAnalysis.name}</h2><p>{selectedAnalysis.asset} · {selectedAnalysis.timeframe.toUpperCase()} · {venueLabel[selectedAnalysis.venue]}</p></div><button type="button" aria-label="Close code details" onClick={()=>setSelectedAnalysis(null)}><X size={18}/></button></header><div className="tv-code-modal-body"><div className="tv-code-info"><span>Tool type<strong>{selectedAnalysis.kind.replaceAll('_',' ')}</strong></span><span>Mode<strong>On-demand analysis</strong></span><span>Continuous monitor<strong className={watches[selectedAnalysis.id]?.verified&&watches[selectedAnalysis.id]?.running?'running':''}>{watches[selectedAnalysis.id]?.verified&&watches[selectedAnalysis.id]?.running?'Running':watches[selectedAnalysis.id]&&!watches[selectedAnalysis.id]?.verified?'Status unverified':'Not deployed'}</strong></span></div>{watches[selectedAnalysis.id]?.events?.length?<div className="tv-code-runtime"><strong>Recent monitor detections</strong>{watches[selectedAnalysis.id].events!.slice(-8).reverse().map(event=><span key={event.id}>{displayTime(event.time*1000)} · {event.kind} · {event.price}{event.output?' · '+event.output:''}</span>)}{watches[selectedAnalysis.id].nextAlarm&&<span>Next check: {displayTime(watches[selectedAnalysis.id].nextAlarm)}</span>}</div>:null}<pre tabIndex={0} className="tv-code-source"><code>{selectedAnalysis.source}</code></pre><p>Source is an auditable representation of a trusted scanner. Trading Vibes executes its validated implementation; arbitrary JavaScript is not evaluated.</p></div><footer><button type="button" onClick={()=>{setSelectedAnalysis(null);onAsk('Explain the saved Code analysis "'+selectedAnalysis.name+'".')}}><Sparkles size={15}/> Discuss</button><button type="button" onClick={()=>{const asset=selectedAnalysis;setSelectedAnalysis(null);watches[asset.id]?.verified&&watches[asset.id]?.running?onStopWatch(asset):onWatch(asset)}}><Clock3 size={15}/>{watches[selectedAnalysis.id]?.verified&&watches[selectedAnalysis.id]?.running?"Stop watch":"Review watch"}</button><button type="button" className="tv-code-new" onClick={()=>{const asset=selectedAnalysis;setSelectedAnalysis(null);onRunAnalysis(asset)}}><Activity size={15}/> Run analysis</button></footer></section></div>}
   {workbench&&client&&<StrategyWorkbench bot={workbench.bot} client={client} initialView={workbench.view} theme={theme}
   onSaved={onSaved} onClose={()=>setWorkbench(null)}
   onAuditTrade={(run,trade,bot)=>{setWorkbench(null);onAuditTrade?.(run,trade,bot)}}
   onDeploy={(bot,riskPercent,codeHash)=>{
    setWorkbench(null);
    // Keep this dialog mounted independently through the old workbench's teardown.
    if(bot.venue==='propdao'){setLocalDeploy({bot,riskPercent,codeHash});return}
    onDeploy(bot,riskPercent,codeHash);
   }}/>}
   {selectedDeployment&&client&&typeof document!=='undefined'&&createPortal(
    <DeployedRobotInspector key={selectedDeployment.id} client={client}
     agent={selectedDeployment} onClose={()=>setSelectedDeployment(null)}
     onRefreshAgents={onRefreshDeployments} onStop={onManageDeployment}/>,document.body)}
   {localDeploy&&client&&typeof document!=='undefined'&&createPortal(
   <PropDAODeployDialog key={localDeploy.bot.id+':'+(localDeploy.codeHash||'saved')} client={client}
    botId={localDeploy.bot.id} expectedCodeHash={localDeploy.codeHash}
    onClose={()=>{setLocalDeploy(null);void onRefreshDeployments()}}
    onConnect={()=>{setLocalDeploy(null);onConnectBroker?.()}}
    onLog={line=>{setOperationNotice(line);void onRefreshDeployments()}}/>,document.body)}
  {stopAgent&&<Dialog title="Stop new PropDAO entries" busy={stopBusy} onClose={()=>setStopAgent(null)}>
    <p><strong>{stopAgent.name}</strong> · {stopAgent.asset} · {venueLabel[stopAgent.venue]}</p>
    <p>This revokes new-order permission before asking Cloudflare to stop. It does not cancel pending orders or close existing positions. An unavailable Worker does not prevent revocation; independently verify your broker account.</p>
    <div className="market-buttons"><button type="button" className="ghost" disabled={stopBusy} onClick={()=>setStopAgent(null)}>Cancel</button><button type="button" className="primary" disabled={stopBusy} onClick={()=>void manage(stopAgent,'stop')}>{stopBusy?'Revoking…':'Confirm stop new entries'}</button></div>
   </Dialog>}
   {codeAction&&<Dialog title={codeAction.kind==='rename'?'Rename code':'Delete code?'} busy={actionBusy} onClose={()=>setCodeAction(null)}>
   {codeAction.kind==='rename'?<label className="tv-code-action-label">Name<input autoFocus maxLength={64} value={actionName} onChange={e=>setActionName(e.target.value)}/></label>:<p>Delete <strong>{codeAction.item.name}</strong>? This removes the saved code{codeAction.type==='bot'?', its saved backtest and versions':''}. Stop any running bot or watcher first.</p>}
   {actionError&&<p role="alert" className="tv-skills-error">{actionError}</p>}
   <div className="market-buttons"><button type="button" className="ghost" disabled={actionBusy} onClick={()=>setCodeAction(null)}>Cancel</button><button type="button" className="primary" disabled={actionBusy||codeAction.kind==='rename'&&!actionName.trim()} onClick={()=>void confirmAction()}>{actionBusy?'Working…':codeAction.kind==='rename'?'Save name':'Delete code'}</button></div>
  </Dialog>}
 </section>;
}
