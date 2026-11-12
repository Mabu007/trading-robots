import {displayTime} from '../display-time';
import {useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {Activity,ArrowRight,Bot,Clock3,Code2,Eye,Pencil,Play,Plus,RefreshCw,Search,Sparkles,Trash2,X} from 'lucide-react';
import {Dialog} from './Dialog';
import type {CloudBot, CloudClient} from '../firebase';
import {StrategyWorkbench, type WorkbenchView} from './StrategyWorkbench';
import {PropDAODeployDialog} from './Marketplace';
import {DeployedRobotInspector} from './DeployedRobotInspector';
import {robotDisplayState,canClearRobot} from '../robot-lifecycle';
import {sharingRequest} from './BotSharing';
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
 onViewBrokerTrades?:(accountId:string)=>void; onTrackSignal:(bot:CloudBot)=>void;onResetLegacy:()=>Promise<void>;
};
export function codeState(bot:CloudBot,agents:PersistentAgent[],states:Record<string,Runtime>):'Running'|'Paused'|'Stopped'|'Checking'|'Saved'{
 const agent=agents.find(a=>a.botId===bot.id&&a.mode==='live');
 if(!agent)return 'Saved';
 const live=states[agent.id];
 if(robotDisplayState(agent,live)==='stopped')return 'Stopped';
 if(!live||live.verified!==true)return 'Checking';
 if(live.state==='running')return 'Running';
 if(live.state==='paused')return 'Paused';
 return live.state==='stopped'||live.state==='not-deployed'?'Stopped':'Checking';
}
export function CodeLibrary({client,bots,current,analyses,watches,agents,runtimeStates,onAsk,onSaved,onRenameBot,onDeleteBot,onRenameAnalysis,onDeleteAnalysis,onRunAnalysis,onWatch,onStopWatch,onDeploy,deploymentError,onRefreshDeployments,onManageDeployment,onAuditTrade,onConnectBroker,onViewBrokerTrades,onTrackSignal,onResetLegacy,theme}:Props){
 const deployments=agents.filter(agent=>agent.mode==='live'&&agent.deployment?.grantId&&!agent.archivedAt).sort((a,b)=>(b.deployment?.authorizedAt||0)-(a.deployment?.authorizedAt||0));
 const activeDeployments=deployments.filter(agent=>robotDisplayState(agent,runtimeStates[agent.id])!=='stopped');
 const stoppedDeployments=deployments.filter(agent=>robotDisplayState(agent,runtimeStates[agent.id])==='stopped');
 const [resetBusy,setResetBusy]=useState(false);
 const [query,setQuery]=useState('');
 const [selectedAnalysis,setSelectedAnalysis]=useState<CodeAnalysis|null>(null);
 const [workbench,setWorkbench]=useState<{bot:CloudBot|null;view:WorkbenchView}|null>(null);
 const [localDeploy,setLocalDeploy]=useState<{bot:CloudBot;riskPercent:number;codeHash?:string}|null>(null);
 const [selectedDeployment,setSelectedDeployment]=useState<PersistentAgent|null>(null);
 const [clearTarget,setClearTarget]=useState<PersistentAgent|null>(null),[clearBusy,setClearBusy]=useState(false);
 const restart=(agent:PersistentAgent)=>{
  if(robotDisplayState(agent,runtimeStates[agent.id])!=='stopped'){setOperationNotice('Robot stop has not been confirmed. Reconcile the broker first.');return}
  const bot=bots.find(item=>item.id===agent.botId);
  if(!bot){setOperationNotice('Saved robot code is unavailable. Open the robot to recover its exact strategy before restarting.');return}
  if(bot.venue!=='propdao'){onDeploy(bot,1);return}
  setSelectedDeployment(null);setLocalDeploy({bot,riskPercent:1});
 };
 const clear=async(agent:PersistentAgent)=>{
  if(!client||clearBusy||!canClearRobot(agent,runtimeStates[agent.id]))return;
  setClearBusy(true);setOperationNotice('');
  try{await sharingRequest(client,'/api/agents/'+encodeURIComponent(agent.id)+'/archive','POST',{});
   setClearTarget(null);setSelectedDeployment(null);
   setOperationNotice('Stopped robot cleared from the deployed list. Its saved strategy and audit history are preserved.');
   await Promise.resolve(onRefreshDeployments());
  }catch(error){setOperationNotice('Could not clear the robot: '+(error instanceof Error?error.message:'Unknown error'))}
  finally{setClearBusy(false)}
 };
 const [refreshing,setRefreshing]=useState(false);
 const refreshDeployments=async()=>{
  if(refreshing)return;
  setRefreshing(true);
  try{await Promise.resolve(onRefreshDeployments())}
  catch(cause){setOperationNotice('Could not refresh robot status: '+(cause instanceof Error?cause.message:'Unknown error'))}
  finally{setRefreshing(false)}
 };
 const openWorkbench=(bot:CloudBot|null,view:WorkbenchView)=>setWorkbench({bot,view});
 useEffect(()=>{
  if(!selectedDeployment)return;
  const fresh=agents.find(agent=>agent.id===selectedDeployment.id);
  if(fresh&&fresh!==selectedDeployment)setSelectedDeployment(fresh);
 },[agents,selectedDeployment]);

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
  <header className="tv-code-head"><div><span className="tv-code-eyebrow"><Code2 size={15}/> SIGNAL BUILDERS</span><h1 id="tv-code-title">Your signals.</h1><p>Backtest BUY/SELL rules and monitor matching setups. Live trackers deliver Telegram signals, never broker orders.</p></div><div className="tv-code-item-actions"><button type="button" disabled={!client||resetBusy||!bots.length} onClick={()=>{if(!window.confirm('Permanently delete all legacy saved robots, backtests and versions? Active broker deployments must be safely stopped and verified first.'))return;setResetBusy(true);setOperationNotice('');void onResetLegacy().then(()=>setOperationNotice('Legacy strategies deleted.')).catch(e=>setOperationNotice(e instanceof Error?e.message:'Some strategies could not be safely deleted.')).finally(()=>setResetBusy(false))}}>Clear old robots</button><button type="button" className="tv-code-new" disabled={!client} onClick={()=>openWorkbench(null,'write')}><Plus size={16}/> Build a signal</button></div></header>
  <div className="tv-code-tools"><label className="tv-code-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search saved code" placeholder="Search code, market or venue…"/></label><span>{items.length+analysisItems.length} {items.length+analysisItems.length===1?'item':'items'}</span></div>
  {activeDeployments.length>0&&<details className="tv-code-deployments"><summary>Legacy live-trading bots requiring attention ({activeDeployments.length})</summary><p>New broker trading is paused. Stop and reconcile legacy deployments before deleting their strategies. Stopping new entries does not close broker positions.</p>
   {activeDeployments.map(agent=><article className="tv-code-item" key={agent.id}><div className="tv-code-item-content"><strong>{agent.name}</strong><p>{agent.asset} · {venueLabel[agent.venue]} · {runtimeStates[agent.id]?.verified?'Runtime checked':'Status unverified'}</p></div><div className="tv-code-item-actions"><button onClick={()=>void manage(agent,'status')}>Verify status</button><button onClick={()=>setStopAgent(agent)}>Stop new entries</button></div></article>)}
  </details>}
  <div className="tv-code-list">{items.map(bot=>{const state=codeState(bot,agents,runtimeStates);const agent=agents.find(a=>a.botId===bot.id&&a.mode==='live');return <article className="tv-code-item" key={bot.id}><span className="tv-code-item-icon"><Code2 size={18}/></span><div className="tv-code-item-content"><div className="tv-code-item-title"><strong>{bot.name||'Untitled code'}</strong><span className={'tv-code-state '+state.toLowerCase()}><i/>{state}</span></div><p>{bot.asset||'Unknown market'} · {venueLabel[bot.venue||'valr']} · Deterministic strategy.js</p><small>{bot.lastBacktest?'Last backtest · '+bot.lastBacktest.from+' to '+bot.lastBacktest.to:'No saved backtest yet'}{agent?.deployment?' · Deployed version '+agent.strategy.version:''}</small></div><div className="tv-code-item-actions"><button type="button" disabled={!client} onClick={()=>openWorkbench(bot,'write')}><Code2 size={15}/> Open</button><button type="button" disabled={!client} onClick={()=>openWorkbench(bot,'backtest')}><Activity size={15}/> Run backtest</button><button type="button" disabled={!client} onClick={()=>onTrackSignal(bot)}><Clock3 size={15}/> Track signals</button>{bot.lastBacktest&&<button type="button" disabled={!client} onClick={()=>openWorkbench(bot,'result')}>View last result</button>}<button type="button" className="tv-code-icon-action" title="Discuss with AI" aria-label={'Discuss '+bot.name+' with AI'} onClick={()=>onAsk('Explain the saved strategy named "'+bot.name+'".',bot)}><Sparkles size={15}/></button><button type="button" className="tv-code-icon-action" title="Rename" aria-label={'Rename '+bot.name} onClick={()=>chooseAction('rename','bot',bot)}><Pencil size={15}/></button><button type="button" className="tv-code-icon-action" title="Delete" aria-label={'Delete '+bot.name} onClick={()=>chooseAction('delete','bot',bot)}><Trash2 size={15}/></button></div></article>})}{analysisItems.map(asset=><article className="tv-code-item" key={asset.id}><span className="tv-code-item-icon"><Activity size={18}/></span><div className="tv-code-item-content"><div className="tv-code-item-title"><strong>{asset.name}</strong><span className={"tv-code-state "+(watches[asset.id]?.verified&&watches[asset.id]?.running?"running":"")}><i/>{watches[asset.id]?.verified&&watches[asset.id]?.running?"Running":watches[asset.id]&&!watches[asset.id].verified?"Status unknown":"Callable"}</span></div><p>{asset.asset} · {venueLabel[asset.venue]} · {asset.timeframe.toUpperCase()} · {asset.kind==='liquidity_sweeps'?'Liquidity sweeps':'Volatility profile'}</p><small>Read-only deterministic analysis tool. Runs on verified historical candles.</small></div><div className="tv-code-item-actions"><button type="button" onClick={()=>setSelectedAnalysis(asset)}><Code2 size={15}/> View</button><button type="button" onClick={()=>onRunAnalysis(asset)}><Activity size={15}/> Run</button><button type="button" aria-label={'Discuss '+asset.name+' with AI'} onClick={()=>onAsk('Explain the saved Code analysis named "'+asset.name+'" and how its detection works.')}><Sparkles size={15}/></button><button type="button" className="tv-code-icon-action" aria-label={'Rename '+asset.name} onClick={()=>chooseAction('rename','analysis',asset)}><Pencil size={15}/></button><button type="button" className="tv-code-icon-action" aria-label={'Delete '+asset.name} onClick={()=>chooseAction('delete','analysis',asset)}><Trash2 size={15}/></button></div></article>)}{!(items.length||analysisItems.length)&&<div className="tv-code-empty"><Bot size={23}/><strong>No matching code</strong><p>Write a new strategy or search your saved strategies by name.</p><button disabled={!client} onClick={()=>openWorkbench(null,'write')}>Build a signal <ArrowRight size={14}/></button></div>}</div>
  {selectedAnalysis&&<div className="tv-code-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedAnalysis(null)}}><section className="tv-code-modal" role="dialog" aria-modal="true" aria-labelledby="tv-analysis-modal-title"><header><div><span className="tv-code-eyebrow"><Activity size={15}/> REUSABLE ANALYSIS · READ ONLY</span><h2 id="tv-analysis-modal-title">{selectedAnalysis.name}</h2><p>{selectedAnalysis.asset} · {selectedAnalysis.timeframe.toUpperCase()} · {venueLabel[selectedAnalysis.venue]}</p></div><button type="button" aria-label="Close code details" onClick={()=>setSelectedAnalysis(null)}><X size={18}/></button></header><div className="tv-code-modal-body"><div className="tv-code-info"><span>Tool type<strong>{selectedAnalysis.kind.replaceAll('_',' ')}</strong></span><span>Mode<strong>On-demand analysis</strong></span><span>Continuous monitor<strong className={watches[selectedAnalysis.id]?.verified&&watches[selectedAnalysis.id]?.running?'running':''}>{watches[selectedAnalysis.id]?.verified&&watches[selectedAnalysis.id]?.running?'Running':watches[selectedAnalysis.id]&&!watches[selectedAnalysis.id]?.verified?'Status unverified':'Not deployed'}</strong></span></div>{watches[selectedAnalysis.id]?.events?.length?<div className="tv-code-runtime"><strong>Recent monitor detections</strong>{watches[selectedAnalysis.id].events!.slice(-8).reverse().map(event=><span key={event.id}>{displayTime(event.time*1000)} · {event.kind} · {event.price}{event.output?' · '+event.output:''}</span>)}{watches[selectedAnalysis.id].nextAlarm&&<span>Next check: {displayTime(watches[selectedAnalysis.id].nextAlarm)}</span>}</div>:null}<pre tabIndex={0} className="tv-code-source"><code>{selectedAnalysis.source}</code></pre><p>Source is an auditable representation of a trusted scanner. Trading Vibes executes its validated implementation; arbitrary JavaScript is not evaluated.</p></div><footer><button type="button" onClick={()=>{setSelectedAnalysis(null);onAsk('Explain the saved Code analysis "'+selectedAnalysis.name+'".')}}><Sparkles size={15}/> Discuss</button><button type="button" onClick={()=>{const asset=selectedAnalysis;setSelectedAnalysis(null);watches[asset.id]?.verified&&watches[asset.id]?.running?onStopWatch(asset):onWatch(asset)}}><Clock3 size={15}/>{watches[selectedAnalysis.id]?.verified&&watches[selectedAnalysis.id]?.running?"Stop watch":"Review watch"}</button><button type="button" className="tv-code-new" onClick={()=>{const asset=selectedAnalysis;setSelectedAnalysis(null);onRunAnalysis(asset)}}><Activity size={15}/> Run analysis</button></footer></section></div>}
   {workbench&&client&&<StrategyWorkbench bot={workbench.bot} client={client} initialView={workbench.view} theme={theme}
   onSaved={onSaved} onClose={()=>setWorkbench(null)}
   onAuditTrade={(run,trade,bot)=>{setWorkbench(null);onAuditTrade?.(run,trade,bot)}}
   onDeploy={(bot)=>{setWorkbench(null);onTrackSignal(bot)}}/>}
   {clearTarget&&<Dialog title="Clear stopped robot" busy={clearBusy} onClose={()=>setClearTarget(null)}>
     <p>Remove <strong>{clearTarget.name}</strong> from the deployed robots list? This only archives a confirmed stopped deployment record. It does not delete your saved robot, broker positions or audit history.</p>
     <div className="market-buttons"><button type="button" className="ghost" onClick={()=>setClearTarget(null)}>Cancel</button>
     <button type="button" className="primary" disabled={clearBusy} onClick={()=>void clear(clearTarget)}>{clearBusy?'Clearing…':'Clear stopped robot'}</button></div>
   </Dialog>}
   {selectedDeployment&&client&&typeof document!=='undefined'&&createPortal(
    <DeployedRobotInspector key={selectedDeployment.id} client={client}
     agent={selectedDeployment} onClose={()=>setSelectedDeployment(null)}
     onRefreshAgents={onRefreshDeployments} onStop={onManageDeployment}
      onViewAccountTrades={accountId=>{setSelectedDeployment(null);onViewBrokerTrades?.(accountId)}}
      onRestart={restart} onClear={agent=>setClearTarget(agent)}/>,document.body)}
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
