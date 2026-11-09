import {LandingPage} from './components/LandingPage';
import {displayTime} from './display-time';
import {chatBacktestDates} from './chat-backtest-dates';
import {ChatEvidence} from './components/ChatEvidence';
import {WatchOutputFields,type MonitorOutput} from './components/WatchOutputFields';
import {updateToolTrace,type ToolTrace} from './tool-trace';
import {useChat} from '@ai-sdk/react';
import {sdkChatTransport,type SdkBridgeRequest} from './sdk-chat-transport';
import {createActionReview,consumeActionReview,type ActionReview} from './action-review';
import {venueOf,venueLabel,type Venue} from '../shared/venues';
import {BotMutationQueue} from './bot-mutations';
import {ValrLiveQuote} from './components/ValrLiveQuote';
import {OpenRouterDialog} from './components/OpenRouterDialog';
import { AgentLibrary, MarketsHub, YouHub } from './components/TradingDestinations';
import {CodeLibrary,type CodeWatchStatus} from './components/CodeLibrary';
import {SkillsLibrary} from './components/SkillsLibrary';
import {PersonalityDialog} from './components/PersonalityDialog';
import {ProfileSettingsDialog} from './components/ProfileSettingsDialog';
import {Dialog} from './components/Dialog';
import {ChatModelSelector} from './components/ChatModelSelector';
import {ChatConversationDialog,type ConversationAction} from './components/ChatConversationDialog';
import {skillPrompt,validateSkill,type UserSkill} from './skills';
import {BacktestChatCard,type BacktestCardData} from './components/BacktestChatCard';
import {BacktestTradeInspector} from './components/BacktestTradeInspector';
import {createBacktestTradeAudit} from './trade-audit-context';
import type {StrategyRun} from './strategy-workbench';
import {Streamdown} from 'streamdown';
import {TradingVisualResponse} from './components/TradingVisuals';
import {newsIntent} from './news-intent';
import type {NewsSnapshot,NewsTrend} from '../server/gdelt-news';
import {savedBacktestCard} from './saved-backtest-card';
import {AnalysisChatCard} from './components/AnalysisChatCard';
import {analysisId,analysisSource,analyzeMarket,type CodeAnalysis,type AnalysisKind,type MarketReport} from './code-analysis';
import {resolveCodeReference,codeSuggestions,catalogContext} from './code-catalog';
import {conversationRobot,semanticChatTitle} from './conversation-robot';
import {ChatTaskChoices} from './components/ChatTaskChoices';
import {backtestPreset,completeCreatePrompt,createReady,createTaskFromMessage,defaultTradingPreferences,isEditFollowup,isNewRobotRequest,parseMarket,parseRobotName,parseVenue,type TradingPreferences,type ConversationTask} from './conversation-workflow';
import './components/chat-task-choices.css';

import {strategyDiff} from './strategy-diff';
import {AccountTrades} from './components/AccountTrades';
import {BrokerPicker,type BrokerChoice} from './components/BrokerPicker';
import { useCallback,useEffect,useMemo,useRef,useState,type FormEvent } from 'react';
import Editor from '@monaco-editor/react';
import { createChart, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { Activity, BookOpen, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Bot, Braces, ChartCandlestick, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Code2, Command, ExternalLink, FileCode2, Gauge, LogOut, MessageCircle, Moon, PanelLeftClose, Clock3, PanelLeftOpen, Play, Plus, Redo2, RotateCcw, Save, Settings2, ShieldAlert, Sparkles, Sun, Terminal, Trash2, Pencil, Share2, Undo2, UserRound, X } from 'lucide-react';
import {historicalData} from './history-cache';
import {compressBacktest,decompressBacktest,isCompressedBacktest} from './backtest-storage';
import {savePendingBacktest,loadPendingBacktest,clearPendingBacktest,pendingRunIsNewer} from './backtest-persistence';
import { runBacktest } from './backtest';import { starterCode,parseStrategyConfig,validateStrategySyntax } from './strategy';import type { Candle,Result,Trade } from './types';
import type {AgentAuditEvent,PersistentAgent} from './agents';
import { demoBots, type DemoBot } from './demos';
import { connectFirebase, firebaseConfigured, readableFirebaseError, type BotVersion, type CloudBot, type CloudClient } from './firebase';
import { AiOutputLimitError, chatStreamPath, joinAiContinuation, postApiJson, postApiStream, readApiJson } from './api';
import { DateRangePicker } from './components/ui/DateRangePicker';
import { installChartTools } from './chart-tools';
import { MonetaryControls, type SimulationSettings } from './components/MonetaryControls';
import { simulateMoney, validateMonetaryAssumptions } from './monetary-backtest';
import {simulatePropDAO, type PropDAOSimulation} from './propdao-evaluation';
import './propdao-evaluation.css';
import { backtestMoneySummary } from './backtest-summary';
import { StrategyDocCard } from './components/StrategyDocCard';
import { OutputDock, type OutputTab, createTradeId } from './components/OutputDock';
import { ShareBotDialog, SharedBotPage, sharedIdFromPath, sharingRequest } from './components/BotSharing';
import {CreatorHome,EconomyPublic,economyPath} from './components/Economy';
import {BrokerDialog,PropDAODeployDialog,DeploymentDialog,SubscriptionDialog,MarketplaceDashboard} from './components/Marketplace';
import {ValrDeployment} from './components/ValrDeployment';
import {readThemePreference,saveThemePreference,type AppTheme} from './theme';
type ChatContext={kind:'trade-audit'|'backtest-result'|'market-analysis'|'news-snapshot'|'news-coverage';label:string;data:Record<string,any>};
type Chat={role:'user'|'assistant';content:string;context?:ChatContext;toolTrace?:ToolTrace[];toolReceiptId?:string};
type AssistantChange=({uid:string;chatId:string}&(
 |{kind:'skill';action:'create'|'update'|'delete';before?:UserSkill;after?:UserSkill}
 |{kind:'personality';before:string;after:string}
 |{kind:'code';action:'rename'|'delete';before:CloudBot;newName?:string}
 |{kind:'broker';action:'connect'|'disconnect';broker:BrokerChoice}
));
function ChatText({content}:{content:string}){return <div className="tv-streamdown"><Streamdown>{content}</Streamdown></div>}
type Draft={venue?:Venue;created:boolean;id:string;name:string;asset:string;prompt:string;code:string;view:'code'|'chart';chat:Chat[]};
const fallbackAssets:string[]=[];const defaultPrompt='On the 1-minute chart, find short-term trend pullbacks. Enter after a bullish or bearish candle closes back in the trend direction. Place a protective stop beyond the recent swing and target 2R.';
type AvailableMarket={asset:string;timeframes:string[];dates:string[];datesByTimeframe?:Record<string,string[]>};
const fmt=(n:number,d=2)=>Number.isFinite(n)?n.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
function readDraft(key='tradefoundry:draft'):Partial<Draft>{
 try{
  const raw=JSON.parse(localStorage.getItem(key)||'{}');
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  return {
   venue:venueOf(raw.venue),
   created:raw.created===true,
   id:typeof raw.id==='string'?raw.id:'',
   name:typeof raw.name==='string'?raw.name:'',
   asset:typeof raw.asset==='string'?raw.asset:'',
   prompt:typeof raw.prompt==='string'?raw.prompt:'',
   code:typeof raw.code==='string'?raw.code:starterCode,
   view:raw.view==='chart'?'chart':'code',
   chat:Array.isArray(raw.chat)?raw.chat.filter((item:any)=>item&&['user','assistant'].includes(item.role)&&typeof item.content==='string').slice(-50).map((item:any)=>({...item,content:item.role==='assistant'?conciseAssistantText(item.content):item.content,context:['trade-audit','backtest-result','market-analysis'].includes(item.context?.kind)&&typeof item.context.label==='string'?item.context:undefined})):[],
  };
 }catch{return {}}
}
function makeBotId(){return typeof crypto!=='undefined'&&'randomUUID'in crypto?crypto.randomUUID():`draft-${Date.now()}-${Math.random().toString(36).slice(2,9)}`}
function App(){
 const [sdkTransport]=useState(()=>sdkChatTransport());
 const sdkChat=useChat({transport:sdkTransport});
 const [theme,setTheme]=useState<AppTheme>(readThemePreference);
 const toggleTheme=()=>setTheme(current=>current==='light'?'dark':'light');
 useEffect(()=>{document.documentElement.dataset.theme=theme;saveThemePreference(theme);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='light'?'#f5f7f6':'#0b0c13')},[theme]);
 const [screen,setScreen]=useState<'boot'|'landing'|'auth'|'bots'|'create'|'workspace'|'profile'|'shared'|'dashboard'>(()=>sharedIdFromPath(window.location.pathname)?'shared':'boot'),[profileReturnScreen,setProfileReturnScreen]=useState<'bots'|'create'|'workspace'>('bots'),[authReady,setAuthReady]=useState(false),[firebaseInitError,setFirebaseInitError]=useState('');
 const [savedDraft]=useState(readDraft),[created,setCreated]=useState(()=>savedDraft.created||false),[name,setName]=useState(()=>savedDraft.name||'');const [asset,setAsset]=useState(()=>savedDraft.asset||''),[prompt,setPrompt]=useState(()=>savedDraft.prompt||''),[code,setCode]=useState(()=>savedDraft.code??starterCode),[view,setView]=useState<'code'|'chart'>(()=>savedDraft.view||'code'),[tab,setTab]=useState<'code'|'chart'>('code'),[createError,setCreateError]=useState(''),[aiError,setAiError]=useState(''),[draftId,setDraftId]=useState(()=>savedDraft.id||makeBotId());
 const [venue,setVenue]=useState<Venue>(()=>venueOf(savedDraft.venue));
 const [tradingPreferences,setTradingPreferences]=useState<TradingPreferences>(defaultTradingPreferences),[assistantTask,setAssistantTask]=useState<ConversationTask|null>(null);
 const [conversationId,setConversationId]=useState('general'),[conversationModel,setConversationModel]=useState<string|null>(null),[conversationLibrary,setConversationLibrary]=useState<{id:string;title:string}[]|null>(null),[recentChats,setRecentChats]=useState<{id:string;title:string;model?:string|null}[]>([]);
  const [chatAction,setChatAction]=useState<ConversationAction|null>(null);
  const [skills,setSkills]=useState<UserSkill[]>([]),[skillsRevision,setSkillsRevision]=useState(0),[skillsLoading,setSkillsLoading]=useState(true),[skillsError,setSkillsError]=useState('');
  const [personality,setPersonality]=useState(''),[personalityOpen,setPersonalityOpen]=useState(false),[profileOpen,setProfileOpen]=useState(false),[,setProfileRevision]=useState(0);
  const [assistantChange,setAssistantChange]=useState<AssistantChange|null>(null),[assistantReviewOpen,setAssistantReviewOpen]=useState(false),[assistantReviewBusy,setAssistantReviewBusy]=useState(false),[assistantReviewError,setAssistantReviewError]=useState(''),[proposalReviewOpen,setProposalReviewOpen]=useState(false);
  const [stagedReview,setStagedReview]=useState<{ref:string;expiresAt:number;asset:string;venue:Venue}|null>(null);
 const [strategyReviewError,setStrategyReviewError]=useState('');
 const [codeEditTarget,setCodeEditTarget]=useState<{bot:CloudBot;source:string}|null>(null);
 const [primaryArea,setPrimaryArea]=useState<'chat'|'trades'|'markets'|'agents'|'scheduled'|'you'|'code'|'skills'>(new URLSearchParams(window.location.search).has('tvApps')?'you':'chat'),[agentWorkspace,setAgentWorkspace]=useState<'overview'|'backtest'|'code'>('overview'),[agentSearch,setAgentSearch]=useState('');
  const [sidebarOpen,setSidebarOpen]=useState(()=>window.innerWidth>720);
  const [chatBacktestBotId,setChatBacktestBotId]=useState('');
  const [codeAnalyses,setCodeAnalyses]=useState<CodeAnalysis[]>([]);
  const [codeWatches,setCodeWatches]=useState<Record<string,CodeWatchStatus>>({});
  const [pendingWatchAsset,setPendingWatchAsset]=useState<CodeAnalysis|null>(null);
  const [watchOutput,setWatchOutput]=useState<MonitorOutput>({type:'log'});
 const [requestBrowserWatchAlerts,setRequestBrowserWatchAlerts]=useState(false);
  const watchSeen=useRef(new Set<string>()),watchReady=useRef(false),watchNotifyEnabled=useRef(false);
  const chatBacktestBotRef=useRef('');
  const [pendingCodeOperation,setPendingCodeOperation]=useState<{botId:string;action:'deploy'|'stop'}|null>(null);
  const queuedChatDates=useRef<ReturnType<typeof chatBacktestDates>>(null);
  const [newCodeTarget,setNewCodeTarget]=useState<{id:string;name:string;asset:string;venue:Venue;prompt:string}|null>(null);
 const loadMarketHistory=useCallback((request:{venue:Venue;asset:string;timeframe:string;from:string;to:string})=>historicalData(request),[]);
 const chatTurnRef=useRef<{controller:AbortController;done:Promise<void>;stoppedChat:Chat[];canStop:boolean}|null>(null);
 const conversationSwitching=useRef(false);
 const [chatCanStop,setChatCanStop]=useState(false);
 const aiAbortRef=useRef<AbortController|null>(null);
 const [aiStreaming,setAiStreaming]=useState(false);
 const cancelAi=()=>{
  const reason=new DOMException('Response stopped','AbortError');
  if(chatTurnRef.current?.canStop)chatTurnRef.current.controller.abort(reason);
  else if(!chatTurnRef.current)aiAbortRef.current?.abort(reason);
 };
 const actionReview=useRef<ActionReview|null>(null);
 const [chatOperation,setChatOperation]=useState<'deploy'|'stop'|null>(null);
 const [brokerPickerOpen,setBrokerPickerOpen]=useState(false),[brokerRevision,setBrokerRevision]=useState(0);
 const [brokerConnections,setBrokerConnections]=useState<Record<BrokerChoice,'connected'|'disconnected'|'unknown'>>({propdao:'unknown',ctrader:'unknown',valr:'unknown'});
  const [propDeployOpen,setPropDeployOpen]=useState(false),[propLive,setPropLive]=useState<any>(null),[propLiveRevision,setPropLiveRevision]=useState(0),[propMarket,setPropMarket]=useState<any>(null),[propMonitorMode,setPropMonitorMode]=useState(false);
 const oauthCallback=useRef<{code:string;state:string}|null>(null);
 const marketRequest=useRef(0);
 const propLiveCache=useRef(new Map<string,any>()),propMarketCache=useRef(new Map<string,any>());
 const [logs,setLogs]=useState<string[]>([]),[result,setResult]=useState<Result|null>(null),[lastBacktestCode,setLastBacktestCode]=useState(''),[busy,setBusy]=useState(''),[chat,setChat]=useState<Chat[]>(()=>savedDraft.chat||[]),[chatInput,setChatInput]=useState(''),[proposal,setProposal]=useState(''),[proposalSummary,setProposalSummary]=useState(''),[contextModal,setContextModal]=useState<ChatContext|null>(null),[mobilePanel,setMobilePanel]=useState<'chat'|'terminal'|null>(null),[chatCollapsed,setChatCollapsed]=useState(false),[terminalOpen,setTerminalOpen]=useState(false),[outputTab,setOutputTab]=useState<OutputTab>('terminal'),[selectedTrade,setSelectedTrade]=useState<Trade|null>(null),[from,setFrom]=useState(''),[to,setTo]=useState(''),[codeWarning,setCodeWarning]=useState(false),[dontShowCodeWarning,setDontShowCodeWarning]=useState(false);
 const [cloudClient,setCloudClient]=useState<Awaited<ReturnType<typeof connectFirebase>>>(null),[cloudBots,setCloudBots]=useState<CloudBot[]>([]),[cloudStatus,setCloudStatus]=useState(firebaseConfigured?'connecting':'local'),[cloudMessage,setCloudMessage]=useState(''),[cloudRetry,setCloudRetry]=useState(0),[versions,setVersions]=useState<BotVersion[]>([]),[versionsLoading,setVersionsLoading]=useState(false),[versionError,setVersionError]=useState(''),[chatHydrated,setChatHydrated]=useState(true),[codeHydrated,setCodeHydrated]=useState(true);
 const [agentRecords,setAgentRecords]=useState<PersistentAgent[]>([]),[agentAudits,setAgentAudits]=useState<Record<string,AgentAuditEvent[]>>({}),[agentRuntimeStates,setAgentRuntimeStates]=useState<Record<string,{state:string;verified?:boolean;lastSignal?:string|null;nextCheck?:number|null;openPositions?:number|null;error?:string|null}>>({}),[agentError,setAgentError]=useState(''),[agentRevision,setAgentRevision]=useState(0);
 const [marketAvailability,setMarketAvailability]=useState<AvailableMarket[]>([]),[availabilityError,setAvailabilityError]=useState('');
 const [publicBotId,setPublicBotId]=useState(()=>sharedIdFromPath(window.location.pathname)),[shareTarget,setShareTarget]=useState<CloudBot|null>(null),[shareBusy,setShareBusy]=useState(false),[shareError,setShareError]=useState(''),[pendingSharedAction,setPendingSharedAction]=useState<'backtest'|'connect'|'start'|null>(null),[queuedBacktest,setQueuedBacktest]=useState('');
 const [dashboardMode,setDashboardMode]=useState<'creator'|'customer'>('customer'),[brokerOpen,setBrokerOpen]=useState(false),[aiSettingsOpen,setAiSettingsOpen]=useState(false),[paperId,setPaperId]=useState(''),[deploymentMode,setDeploymentMode]=useState<'paper'|'live'>('paper'),[deploymentId,setDeploymentId]=useState(''),[followingId,setFollowingId]=useState('');
 useEffect(()=>{const params=new URLSearchParams(window.location.search);if(params.get('openrouter_callback')==='1'){oauthCallback.current={code:params.get('code')||'',state:params.get('state')||''};window.history.replaceState({},'',window.location.pathname)}},[]);
 useEffect(()=>{if(!authReady||!cloudClient||!oauthCallback.current)return;const payload=oauthCallback.current;oauthCallback.current=null;void sharingRequest(cloudClient,'/api/openrouter/oauth/complete','POST',payload).then(()=>setAiSettingsOpen(true)).catch(e=>{setCloudMessage(err(e));setAiSettingsOpen(true)})},[authReady,cloudClient]);
 const [libraryDeployment,setLibraryDeployment]=useState<{bot:CloudBot;riskPercent:number;codeHash?:string}|null>(null);
 const [savedTradeInspection,setSavedTradeInspection]=useState<{key:string;card:BacktestCardData;tradeId:number;run:StrategyRun|null;loading:boolean;error:string}|null>(null);
 const [simulationSettings,setSimulationSettings]=useState<{key:string;settings:SimulationSettings}|null>(null);
 const updateSimulationSettings=useCallback((key:string,settings:SimulationSettings)=>setSimulationSettings({key,settings}),[]);
 const [moneyReplay,setMoneyReplay]=useState<{result:Result; decisions:any[]; riskPercent:number}|null>(null);
 const [propRiskPercent,setPropRiskPercent]=useState(0.25);
 useEffect(()=>{try{const stored=Number(localStorage.getItem(`trading-vibes:propdao-risk:${draftId}`));setPropRiskPercent([0.1,0.25,0.5,1].includes(stored)?stored:0.25)}catch{setPropRiskPercent(0.25)}},[draftId]);
 const [liveBusy,setLiveBusy]=useState(false);
 const [paperStatus,setPaperStatus]=useState<{deployed:boolean;state?:{running:boolean;lastCandle:number|null;lastResult:string;position:unknown};lastError?:string}|null>(null),[paperBusy,setPaperBusy]=useState(false),[paperRevision,setPaperRevision]=useState(0);
 const [liveAccount,setLiveAccount]=useState<any>(null),[liveCheck,setLiveCheck]=useState<'checking'|'ready'|'unavailable'>('ready'),[liveRevision,setLiveRevision]=useState(0);const propLiveMode=venue==='propdao'&&propLive?.botId===draftId&&Boolean(propLive?.running||(propLive?.deployed&&propLive?.uncertain)||(propMonitorMode&&propLive?.deployed));const liveLocked=Boolean(liveAccount?.state?.active||liveAccount?.state?.bots?.[draftId]?.running||venue==='propdao'&&created&&(propLive?.botId!==draftId||propLive?.loading||propLive?.running||propLive?.uncertain));
 const [tradeDetailsOpen,setTradeDetailsOpen]=useState(false),[focusTrade,setFocusTrade]=useState<Trade|null>(null);
 const [botCovers,setBotCovers]=useState<Record<string,string>>({}),[coverLoadError,setCoverLoadError]=useState('');
 const screenRef=useRef(screen);screenRef.current=screen;
 const botMutations=useRef(new BotMutationQueue());
 const botMutationKey=(id:string)=>`${cloudClient?.getProfile()?.uid||'local'}:${id}`;
 const coversRevisionRef=useRef(0);
 useEffect(()=>{if(!authReady||!cloudClient){setBotCovers({});return}let active=true;const revision=coversRevisionRef.current;const load=async()=>{let after:string|null=null;const covers:Record<string,string>={};do{const page:{items:{botId:string;coverImage:string}[];next:string|null}=await sharingRequest<{items:{botId:string;coverImage:string}[];next:string|null}>(cloudClient,`/api/economy/covers${after?`?after=${encodeURIComponent(after)}`:''}`);for(const row of page.items)covers[row.botId]=row.coverImage;after=page.next}while(after&&active);if(active){setBotCovers(current=>coversRevisionRef.current===revision?covers:{...covers,...current});setCoverLoadError('')}};void load().catch(()=>{if(active)setCoverLoadError('Could not load saved bot covers. Refresh to retry.')});return()=>{active=false}},[authReady,cloudClient]);
 const availableAssets=marketAvailability.map(market=>market.asset),assetOptions=availableAssets.length?availableAssets:fallbackAssets,selectedMarket=marketAvailability.find(market=>market.asset===asset),executionTimeframe=(()=>{try{return parseStrategyConfig(code).executionTimeframe}catch{return selectedMarket?.timeframes[0]||'m1'}})(),availableDates=selectedMarket?.datesByTimeframe?.[executionTimeframe]||selectedMarket?.dates||[];
 const activeProfile=(()=>{try{return cloudClient?.getProfile()??null}catch{return null}})(),profileLabel=activeProfile?.displayName||activeProfile?.email||'Profile';
 // Stop an opt-in SDK request if its owner or conversation changes.
 useEffect(()=>()=>{chatTurnRef.current?.controller.abort();aiAbortRef.current?.abort();void sdkChat.stop()},[activeProfile?.uid,conversationId,sdkChat.stop]);
 const chatScopeRef=useRef('');
 chatScopeRef.current=(activeProfile?.uid||'')+'\u0000'+conversationId;
 const simulationKey=`trading-vibes:simulation:${activeProfile?.uid||'local'}:${draftId}:${venue}:${asset}`;
 useEffect(()=>{
  if(venue!=='propdao'||!cloudClient||!authReady||!created||screen!=='workspace'){if(venue!=='propdao')setPropLive(null);return}
  let active=true,timer:number|undefined;
  const key=`${cloudClient.getProfile()?.uid||'local'}:${draftId}`;
  const cached=propLiveCache.current.get(key);
  setPropLive(cached||{botId:draftId,loading:true,deployed:false,events:[]});
  const poll=async()=>{
   try{
    const state=await sharingRequest<any>(cloudClient,`/api/venues/propdao/bots/${encodeURIComponent(draftId)}/live`);
    if(active){const next={...state,botId:draftId,loading:false,statusUnavailable:false};propLiveCache.current.set(key,next);setPropLive(next)}
   }catch(e){
    if(active){const old=propLiveCache.current.get(key)||{botId:draftId,deployed:false,events:[]};const next={...old,loading:false,botId:draftId,running:false,uncertain:true,statusUnavailable:true,error:err(e)};propLiveCache.current.set(key,next);setPropLive(next)}
   }finally{if(active)timer=window.setTimeout(poll,10000)}
  };
  void poll();
  return()=>{active=false;if(timer)window.clearTimeout(timer)}
 },[venue,cloudClient,authReady,created,screen,draftId,propLiveRevision]);
 useEffect(()=>{setPropMonitorMode(false)},[draftId]);
 // Live status does not force another chart mode or reset the user's chosen results tab.
 useEffect(()=>{
  if(!propLiveMode||!cloudClient||screen!=='workspace'){if(venue!=='propdao')setPropMarket(null);return}
  let active=true,timer:number|undefined;
  const key=`${cloudClient.getProfile()?.uid||'local'}:${draftId}`,cached=propMarketCache.current.get(key);
  if(cached)setPropMarket(cached);
  const poll=async()=>{
   try{
    const market=await sharingRequest<any>(cloudClient,`/api/venues/propdao/bots/${encodeURIComponent(draftId)}/live/market`);
    if(active){const next={...market,error:undefined};propMarketCache.current.set(key,next);setPropMarket(next)}
   }catch(e){
    if(active)setPropMarket((current:any)=>({...current,error:err(e),fresh:false,candles:current?.candles||[]}))
   }finally{if(active)timer=window.setTimeout(poll,4000)}
  };
  void poll();
  return()=>{active=false;if(timer)window.clearTimeout(timer)}
 },[propLiveMode,cloudClient,screen,draftId,venue]);
 const monetary=useMemo(()=>{if(venue==='propdao')return null;const settings=simulationSettings?.key===simulationKey?simulationSettings.settings:null;if(!result||!moneyReplay||moneyReplay.result!==result||!settings||!Number.isFinite(settings.balance)||settings.balance<=0||validateMonetaryAssumptions(settings.assumptions))return null;return simulateMoney(result.candles,moneyReplay.decisions,settings.balance,moneyReplay.riskPercent,settings.assumptions,(()=>{try{return parseStrategyConfig(lastBacktestCode||code).riskReward}catch{return undefined}})())},[venue,result,moneyReplay,simulationSettings,simulationKey,lastBacktestCode,code]);
 const propEvaluation=useMemo<PropDAOSimulation|null>(()=>{if(venue!=='propdao'||!result||moneyReplay?.result!==result)return null;try{const cfg=parseStrategyConfig(lastBacktestCode||code);return simulatePropDAO(result.candles,moneyReplay.decisions,propRiskPercent,{spread:cfg.backtestSpread||0,slippage:cfg.backtestSlippage||0,commissionR:cfg.backtestCommissionR||0},cfg.riskReward)}catch{return null}},[venue,result,moneyReplay,propRiskPercent,lastBacktestCode,code]);
 const chatScrollRef=useRef<HTMLDivElement>(null),chatComposerRef=useRef<HTMLDivElement>(null),followChat=useRef(true),chatInputRef=useRef<HTMLTextAreaElement>(null),chartRef=useRef<HTMLDivElement>(null),chartApiRef=useRef<any>(null),chartSeriesRef=useRef<any>(null),editorRef=useRef<any>(null),abortRef=useRef<AbortController|null>(null),inputSignatureRef=useRef(''),restoreResultRef=useRef(''),botLoadRef=useRef(''),hydratedWorkspaceRef=useRef(''),startupRestoreRef=useRef(''),logsRef=useRef<string[]>([]);
 inputSignatureRef.current=JSON.stringify([venue,code,asset,from,to]);
 useEffect(()=>{setSelectedTrade(null)},[monetary]);
 const editorIdentityRef=useRef({draftId,code});editorIdentityRef.current={draftId,code};
 useEffect(()=>{setProposal('');setProposalSummary('')},[draftId,code]);
 useEffect(()=>{setChatOperation(null);actionReview.current=null},[draftId,code,venue,activeProfile?.uid]);
 useEffect(()=>{if(!chatOperation)return;const timer=window.setTimeout(()=>{setChatOperation(null);actionReview.current=null},120000);return()=>window.clearTimeout(timer)},[chatOperation]);
 const userBotRequest=async<T,>(path:string,method:'GET'|'PUT'|'POST'|'PATCH'|'DELETE',body?:unknown):Promise<T>=>{if(!cloudClient)throw new Error('Sign in to use cloud robot storage.');const token=await cloudClient.getIdToken();let response:Response;try{response=await fetch(path,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{throw new Error('Cloud robot storage is unreachable. Retry when the connection is available.')}return readApiJson<T>(response,'Robot storage')};
 const refreshAgentRecords=useCallback(async()=>{
  if(!cloudClient){setAgentRecords([]);setAgentRuntimeStates({});return}
  setAgentError('');
  try{
   const records=await userBotRequest<PersistentAgent[]>('/api/agents','GET');setAgentRecords(records);
   const statuses=await Promise.all(records.filter(agent=>agent.mode==='live'&&agent.deployment?.grantId).map(async agent=>{
    try{return [agent.id,await userBotRequest<Record<string,any>>(`/api/agents/${encodeURIComponent(agent.id)}/status`,'GET')] as const}
    catch(error){return [agent.id,{state:'unknown',verified:false,error:err(error)}] as const}
   }));setAgentRuntimeStates(Object.fromEntries(statuses.map(([id,state])=>[id,state])) as typeof agentRuntimeStates);
  }catch(error){setAgentError(err(error))}
 },[cloudClient]);
 useEffect(()=>{if(!authReady||!cloudClient||primaryArea!=='code')return;const timer=window.setInterval(()=>void refreshAgentRecords(),30000);return()=>window.clearInterval(timer)},[authReady,cloudClient,primaryArea,refreshAgentRecords]);
 useEffect(()=>{if(!authReady||!cloudClient||primaryArea!=='agents'&&primaryArea!=='scheduled'&&primaryArea!=='code')return;void refreshAgentRecords()},[authReady,cloudClient,primaryArea,agentRevision,refreshAgentRecords]);
 const loadAgentAudit=async(id:string)=>{if(agentAudits[id])return;try{const events=await userBotRequest<AgentAuditEvent[]>(`/api/agents/${encodeURIComponent(id)}/audit`,'GET');setAgentAudits(current=>({...current,[id]:events}))}catch(error){setAgentError(err(error))}};
 const hydrateAccountDraft=(uid:string)=>{const draft=readDraft(`trading-vibes:draft:${uid}`);setVenue(venueOf(draft.venue));setCreated(Boolean(draft.created));setDraftId(draft.id||makeBotId());setName(draft.name||'');setAsset(draft.asset||'');setPrompt(draft.prompt||'');setCode(draft.code??starterCode);setView(draft.view||'code');setChat(draft.chat||[]);setResult(null);setSelectedTrade(null);setChatHydrated(true);setCodeHydrated(Boolean(draft.code?.trim()));setCreateError(draft.created&&!draft.code?.trim()?'Robot generation did not finish. Retry to write this robot’s script.':'')};
 useEffect(()=>{const signature=JSON.stringify([venue,code,asset,from,to]);if(restoreResultRef.current===signature){restoreResultRef.current='';return}restoreResultRef.current='';setResult(null);setSelectedTrade(null)},[venue,code,asset,from,to]);
 async function loadMarketAvailability(preferredAsset=asset){
 const request=++marketRequest.current;
 setMarketAvailability([]);setAvailabilityError('');
 if(venue==='ctrader'){setAvailabilityError('cTrader broker account discovery is not configured yet.');return}
 try{const response=await fetch(venue==='valr'?'/api/valr/markets':`/api/venues/${venue}/markets`);const data=await readApiJson<{markets:{symbol:string}[]}>(response,'Venue markets');if(request!==marketRequest.current)return;
 const today=Math.floor(Date.now()/86_400_000)*86_400_000;const dates=Array.from({length:366},(_,i)=>new Date(today-(365-i)*86_400_000).toISOString().slice(0,10));const markets=(data.markets||[]).map(pair=>({asset:pair.symbol,timeframes:['m1','m5','m15','m30','h1','h4','d1'],dates}));setMarketAvailability(markets);
 const selected=markets.find(market=>market.asset===preferredAsset)||(!created?markets[0]:undefined);if(!selected){setAvailabilityError('Select an available market for this venue.');return}if(!created)setAsset(selected.asset);const yesterday=dates.at(-2)!;setFrom(current=>dates.includes(current)?current:yesterday);setTo(current=>dates.includes(current)?current:yesterday);
 }catch(error){if(request===marketRequest.current){setAvailabilityError(error instanceof Error?error.message:'Could not load markets.');setMarketAvailability([])}}}

 useEffect(()=>{if(!authReady||!activeProfile||activeProfile.isAnonymous)return;const timer=window.setTimeout(()=>{try{localStorage.setItem(`trading-vibes:draft:${activeProfile.uid}`,JSON.stringify({venue,created,id:draftId,name,asset,prompt,code,view,chat}))}catch{}},350);return()=>window.clearTimeout(timer)},[authReady,activeProfile?.uid,venue,created,draftId,name,asset,prompt,code,view,chat]);
 useEffect(()=>{if(!activeProfile||activeProfile.isAnonymous||hydratedWorkspaceRef.current!==draftId)return;try{localStorage.setItem(`trading-vibes:workspace:${activeProfile.uid}:${draftId}`,JSON.stringify({outputTab,terminalOpen}))}catch{}},[activeProfile?.uid,draftId,outputTab,terminalOpen]);
 useEffect(()=>{followChat.current=true},[conversationId]);
 useEffect(()=>{const node=chatScrollRef.current;if(node&&followChat.current)node.scrollTop=node.scrollHeight},[chat,primaryArea]);
 useEffect(()=>{
  const composer=chatComposerRef.current,scroller=chatScrollRef.current;
  if(primaryArea!=='chat'||!composer||!scroller)return;
  const measure=()=>{
   const margin=parseFloat(getComputedStyle(composer).marginBottom)||0;
   scroller.style.setProperty('--tv-composer-space',`${composer.offsetHeight+margin+22}px`);
  };
  measure();
  if(typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(measure);
  observer.observe(composer);
  return()=>observer.disconnect();
 },[primaryArea,screen,chatCollapsed]);
 useEffect(()=>{const field=chatInputRef.current;if(!field)return;field.style.height='auto';field.style.height=`${Math.min(field.scrollHeight,72)}px`;field.style.overflowY=field.scrollHeight>72?'auto':'hidden'},[chatInput]);
 useEffect(()=>{if(authReady)void loadMarketAvailability();return()=>{marketRequest.current++}},[authReady,venue]);
 useEffect(()=>{if(!marketAvailability.length)return;const market=marketAvailability.find(item=>item.asset===asset);if(!market){setAvailabilityError(`${asset} is not available for the selected venue.`);return}setAvailabilityError('');const dates=market.dates;if(!dates.includes(from)||!dates.includes(to)){const yesterday=dates.at(-2)!;setFrom(yesterday);setTo(yesterday)}},[asset,marketAvailability,executionTimeframe]);
 useEffect(()=>{let active=true;setCloudStatus('connecting');(async()=>{const client=await connectFirebase();if(!client)throw new Error('Firebase web app configuration is incomplete.');const profile=client.getProfile();if(active)setCloudClient(client);if(!profile){if(active){setCloudBots([]);setCloudStatus('local');setAuthReady(false);setScreen(current=>current==='auth'||window.location.pathname==='/sign-in'?'auth':sharedIdFromPath(window.location.pathname)?'shared':'landing')}return}if(profile.isAnonymous){if(active){setCloudStatus('connected');setCloudMessage('');setAuthReady(false);setScreen(current=>current==='auth'||window.location.pathname==='/sign-in'?'auth':sharedIdFromPath(window.location.pathname)?'shared':'auth')}return}let existing:CloudBot[]=[];let botLoadError='';try{existing=await client.listBots()}catch(error){botLoadError=error instanceof Error?error.message:'Could not load your robot library.'}if(active){hydrateAccountDraft(profile.uid);setCloudBots(existing);setCloudStatus(botLoadError?'error':'connected');setCloudMessage(botLoadError);setAuthReady(true);const marker=`trading-vibes:account:${profile.uid}`;const lastKey=`trading-vibes:last-page:${profile.uid}`;let returning=false,lastPage='';try{returning=localStorage.getItem(marker)==='true';lastPage=localStorage.getItem(lastKey)||'';localStorage.setItem(marker,'true')}catch{}const valid=['bots','create','workspace'].includes(lastPage)?lastPage as 'bots'|'create'|'workspace':null;if(window.location.pathname==='/sign-in')window.history.replaceState({},'','/');setPrimaryArea('chat');setScreen(sharedIdFromPath(window.location.pathname)?'shared':'workspace')}})().catch(error=>{if(active){setFirebaseInitError(readableFirebaseError(error));setCloudStatus('error');setCloudMessage(readableFirebaseError(error));setAuthReady(false);setScreen(current=>current==='auth'||window.location.pathname==='/sign-in'?'auth':sharedIdFromPath(window.location.pathname)?'shared':'landing')}});return()=>{active=false}},[cloudRetry]);
 useEffect(()=>{if(!authReady||!cloudClient||!['bots','create','workspace'].includes(screen))return;const profile=cloudClient.getProfile();if(!profile||profile.isAnonymous)return;try{localStorage.setItem(`trading-vibes:last-page:${profile.uid}`,screen)}catch{}},[authReady,cloudClient,screen]);
 useEffect(()=>{if(!created||screen!=='workspace'||!cloudClient||!codeHydrated||!code.trim()||liveLocked||liveCheck!=='ready')return;const timer=window.setTimeout(()=>{setCloudStatus('saving');const previous=cloudBots.find(bot=>bot.id===draftId)?.lastBacktest??null;const metrics=result?Object.fromEntries(Object.entries(result.metrics).map(([key,value])=>[key,typeof value==='number'&&!Number.isFinite(value)?String(value):value])):null;const cash=backtestMoneySummary(monetary);const bot:CloudBot={venue,id:draftId,name,asset,prompt,code,lastBacktest:result?{metrics:metrics as Record<string,number|string>,candleCount:result.candles.length,from,to,...(cash?{money:cash}:{})}:previous};botMutations.current.run(botMutationKey(draftId),async()=>{const {storageKey}=await userBotRequest<{storageKey:string}>(`/api/user-bots/${encodeURIComponent(draftId)}/current`,'PUT',{code,venue});await cloudClient.saveBot(bot,storageKey);return storageKey}).then(storageKey=>{setCloudBots(current=>[{...bot,storageKey},...current.filter(item=>item.id!==bot.id)]);setCloudStatus('connected');setCloudMessage('')}).catch(error=>{setCloudStatus('error');setCloudMessage(error instanceof Error?error.message:'Robot save failed; this device still has the local draft.')})},900);return()=>window.clearTimeout(timer)},[venue,created,cloudClient,draftId,name,asset,prompt,code,result,monetary,from,to,codeHydrated,screen,liveLocked,liveCheck]);
 useEffect(()=>{if(screen!=='workspace'||!authReady||!cloudClient||!chatHydrated||!chat.length)return;const persisted=busy==='chat'&&chat.at(-1)?.role==='assistant'?chat.slice(0,-1):chat;const timer=window.setTimeout(()=>{cloudClient.saveConversation(conversationId,persisted,semanticChatTitle(persisted,cloudBots),assistantTask).then(()=>{
   if(persisted.at(-1)?.role==='assistant')void cloudClient.listConversations().then(items=>setRecentChats(items.slice(0,30))).catch(()=>undefined);
  }).catch(error=>{setCloudStatus('error');setCloudMessage(error instanceof Error?error.message:'Could not sync this conversation.')})},350);return()=>window.clearTimeout(timer)},[authReady,cloudClient,conversationId,chat,chatHydrated,screen,busy,assistantTask]);
 const restoreConversationEvidence=async(client:CloudClient,id:string,messages:Chat[])=>{
  const ids=messages.flatMap(item=>item.toolReceiptId?[item.toolReceiptId]:[]);
  if(!ids.length)return messages;
  const {receipts}=await sharingRequest<{receipts:Record<string,ToolTrace[]>}>(client,'/api/agent/chat-tool-receipts','POST',{conversationId:id,ids}).catch(()=>({receipts:{} as Record<string,ToolTrace[]>}));
  return messages.map(item=>item.toolReceiptId?{...item,toolTrace:receipts[item.toolReceiptId]}:item);
 };
 const switchConversation=async(id:string)=>{
  const pending=chatTurnRef.current;
  if(!cloudClient||conversationSwitching.current||(busy&&(busy!=='chat'||!pending?.canStop)))return;
  conversationSwitching.current=true;
  const scope=chatScopeRef.current;
  if(pending){cancelAi();await pending.done;}
  if(chatScopeRef.current!==scope){conversationSwitching.current=false;return;}
  setBusy('conversation');setChatHydrated(false);setChatOperation(null);setPendingCodeOperation(null);setPendingWatchAsset(null);setNewCodeTarget(null);setProposal('');setCodeEditTarget(null);setStagedReview(null);setAiError('');
  try{
   const previous=pending?.stoppedChat||chat;
   if(previous.length&&chatHydrated)await cloudClient.saveConversation(conversationId,previous,semanticChatTitle(previous,cloudBots),assistantTask);
   const record=await cloudClient.loadConversationRecord(id);
   const messages=await restoreConversationEvidence(cloudClient,id,record?.messages||[]);
   if(chatScopeRef.current!==scope)return;
   setConversationId(id);setConversationModel(record?.model||null);setAssistantTask(record?.task||null);setChat(messages);setConversationLibrary(null);setPrimaryArea('chat');setAgentWorkspace('overview');setChatCollapsed(false);setChatInput('');setSidebarOpen(window.innerWidth>720);
  }catch(error){setCloudMessage(err(error));}finally{conversationSwitching.current=false;setChatHydrated(true);setBusy('');}
 };
 const startNewConversation=()=>{if(busy&&!chatCanStop)return;const id=makeBotId();if(cloudClient){void switchConversation(id);return}setConversationId(id);setConversationModel(null);setAssistantTask(null);setChat([]);setChatInput('');setPrimaryArea('chat');setAgentWorkspace('overview');setMobilePanel(null);setSidebarOpen(window.innerWidth>720)};
 useEffect(()=>{if(!authReady||!cloudClient)return;let active=true;setChatHydrated(false);cloudClient.loadConversationRecord('general').then(async record=>{const messages=await restoreConversationEvidence(cloudClient,'general',record?.messages||[]);if(active){setConversationId('general');setConversationModel(record?.model||null);setAssistantTask(record?.task||null);setChat(messages);setChatHydrated(true)}}).catch(error=>{if(active){setCloudMessage(err(error));setChatHydrated(false)}});return()=>{active=false}},[authReady,cloudClient]);
 useEffect(()=>{watchNotifyEnabled.current=requestBrowserWatchAlerts},[requestBrowserWatchAlerts]);
 useEffect(()=>{watchSeen.current.clear();watchReady.current=false;if(!authReady||!cloudClient){setCodeWatches({});return}
  let active=true;const poll=async()=>{try{const result=await sharingRequest<{watches:CodeWatchStatus[]}>(cloudClient,'/api/code-watches');if(active){const events=(result.watches||[]).flatMap(w=>(w.events||[]).map(e=>({...e,watchName:String((w as any).name||w.id)})));const fresh=watchReady.current?events.filter(e=>!watchSeen.current.has(e.id)):[];for(const event of events)watchSeen.current.add(event.id);watchReady.current=true;setCodeWatches(Object.fromEntries((result.watches||[]).map(w=>[w.id,w])));if(fresh.length){const recent=fresh.slice(-3);setChat(messages=>[...messages,{role:'assistant',content:'**Code watch detection**\n'+recent.map(e=>'- '+e.watchName+' · '+e.kind+' · '+displayTime(e.time*1000)).join('\n')+'\n\nThese are monitor detections, not trades.'}]);if(watchNotifyEnabled.current&&typeof Notification!=='undefined'&&Notification.permission==='granted')for(const event of recent)try{new Notification('Trading Vibes · '+event.kind,{body:event.watchName+' · '+displayTime(event.time*1000)})}catch{}}}}catch{if(active)setCodeWatches(current=>Object.fromEntries(Object.entries(current).map(([id,w])=>[id,{...w,verified:false}])))} };
  void poll();const timer=window.setInterval(()=>void poll(),60000);return()=>{active=false;window.clearInterval(timer)}
 },[authReady,cloudClient]);
 useEffect(()=>{if(!authReady||!cloudClient){setCodeAnalyses([]);return}let active=true;void cloudClient.listCodeAnalyses().then(items=>{if(active)setCodeAnalyses(items)}).catch(error=>{if(active)setCloudMessage(err(error))});return()=>{active=false}},[authReady,cloudClient]);
 useEffect(()=>{
  if(!authReady||!cloudClient){setSkills([]);setSkillsLoading(true);setSkillsError('');return;}
  let active=true;
  setSkillsLoading(true);setSkillsError('');
  void cloudClient.listSkills().then(items=>{if(active)setSkills(items)}).catch(error=>{if(active)setSkillsError('Skills could not be loaded: '+err(error))})
   .finally(()=>{if(active)setSkillsLoading(false)});
  return()=>{active=false};
 },[authReady,cloudClient,activeProfile?.uid,skillsRevision]);
 useEffect(()=>{if(!authReady||!cloudClient){setTradingPreferences(defaultTradingPreferences);return}
  let active=true;cloudClient.loadTradingPreferences().then(prefs=>{if(active)setTradingPreferences(prefs)}).catch(error=>{if(active)setCloudMessage('Could not load trading preferences: '+err(error))});
  return()=>{active=false};
 },[authReady,cloudClient]);
 useEffect(()=>{if(!authReady||!cloudClient){setPersonality('');return}let active=true;void cloudClient.loadPersonality().then(value=>{if(active)setPersonality(value)}).catch(error=>{if(active)setCloudMessage('Personality could not be loaded: '+err(error))});return()=>{active=false}},[authReady,cloudClient]);
 useEffect(()=>{if(!authReady||!cloudClient){setBrokerConnections({propdao:'unknown',ctrader:'unknown',valr:'unknown'});return}let active=true;void Promise.allSettled([sharingRequest<{connected:boolean}>(cloudClient,'/api/venues/propdao/accounts'),sharingRequest<{connected:boolean}>(cloudClient,'/api/venues/ctrader/accounts'),sharingRequest<{connected:boolean}>(cloudClient,'/api/valr/account')]).then(results=>{if(!active)return;const state=(i:number)=>{const result=results[i];return result.status==='fulfilled'?(result.value.connected?'connected':'disconnected'):'unknown'};setBrokerConnections({propdao:state(0),ctrader:state(1),valr:state(2)})});return()=>{active=false}},[authReady,cloudClient,brokerRevision]);
 const updateSkill=async(skill:UserSkill)=>{if(!cloudClient)throw Error('Sign in to save your skills.');const previous=skills.find(item=>item.id===skill.id);
  if(previous?.name.toLocaleLowerCase()!==skill.name.toLocaleLowerCase()&&skills.some(item=>item.id!==skill.id&&item.name.toLocaleLowerCase()===skill.name.toLocaleLowerCase()))throw Error('A skill with that name already exists.');
  await cloudClient.saveSkill(skill);setSkills(current=>[skill,...current.filter(item=>item.id!==skill.id)])};
 const deleteUserSkill=async(id:string)=>{if(!cloudClient)throw Error('Sign in to delete a skill.');await cloudClient.deleteSkill(id);setSkills(current=>current.filter(item=>item.id!==id))};
 const updateConversationAction=async(action:ConversationAction,value:string)=>{
  if(!cloudClient||busy)throw Error('This chat cannot be changed while another operation is running.');
  if(action.type==='rename'){
   await cloudClient.renameConversation(action.id,value);
   setRecentChats(items=>items.map(item=>item.id===action.id?{...item,title:value.trim()}:item));
   return;
  }
  setBusy('conversation');
  try{
   await cloudClient.deleteConversation(action.id);
   setRecentChats(items=>items.filter(item=>item.id!==action.id));
   if(conversationId===action.id){
    const fresh=makeBotId();
    setChatHydrated(false);setConversationId(fresh);setConversationModel(null);setAssistantTask(null);setChat([]);setChatInput('');setProposal('');setChatOperation(null);setPendingWatchAsset(null);setPrimaryArea('chat');setChatHydrated(true);
   }
  }finally{setBusy('')}
 };
 useEffect(()=>{if(!authReady||!cloudClient){setRecentChats([]);return}let active=true;void cloudClient.listConversations().then(items=>{if(active)setRecentChats(items.slice(0,80))}).catch(()=>{if(active)setRecentChats([])});return()=>{active=false}},[authReady,cloudClient,conversationId,chat.length]);
 useEffect(()=>{if(outputTab!=='versions')return;if(!cloudClient){setVersionError('Sign in to see your saved versions.');return}let active=true;setVersionsLoading(true);setVersionError('');cloudClient.listVersions(draftId).then(items=>{if(active)setVersions(items)}).catch(error=>{if(active)setVersionError(error instanceof Error?error.message:'Could not load robot versions.')}).finally(()=>{if(active)setVersionsLoading(false)});return()=>{active=false}},[outputTab,draftId,cloudClient]);
 const log=(line:string)=>{const next=[...logsRef.current,`${displayTime(Date.now(),true)}  ${line}`];logsRef.current=next;setLogs(next)};
 useEffect(()=>{if(venue!=='valr'||!cloudClient||!authReady||!created||screen!=='workspace'){setPaperStatus(null);return}let active=true,timer:number|undefined,last='';const poll=async()=>{try{const data=await sharingRequest<{deployed:boolean;state?:{running:boolean;lastCandle:number|null;lastResult:string;position:unknown};lastError?:string}>(cloudClient,`/api/valr/bots/${encodeURIComponent(draftId)}/paper`);if(!active)return;setPaperStatus(data);const signature=JSON.stringify([data.state?.running,data.state?.lastCandle,data.state?.lastResult,data.lastError]);if(data.deployed&&signature!==last){last=signature;log(`Paper · ${data.state?.running?'running':'stopped'} · ${data.state?.lastResult||'waiting'}${data.lastError?` · ${data.lastError}`:''}`)}}catch(e){if(active){setPaperStatus(null);if(last!=='unavailable'){last='unavailable';log(`Paper status unavailable · ${err(e)}`)}}}finally{if(active)timer=window.setTimeout(poll,15000)}};void poll();return()=>{active=false;if(timer)window.clearTimeout(timer)}},[venue,cloudClient,authReady,created,screen,draftId,paperRevision]);
 useEffect(()=>{if(venue!=='valr'||!cloudClient||!authReady||!created||screen!=='workspace'){setLiveAccount(null);setLiveCheck('ready');return}let active=true;let signature='';const poll=async()=>{try{const status:any=await sharingRequest(cloudClient,`/api/valr/bots/${encodeURIComponent(draftId)}/live`);if(!active)return;setLiveAccount(status);setLiveCheck('ready');const next=JSON.stringify([status.state?.active?.phase,status.state?.active?.lastError,status.lastError,status.lastEvaluation?.candleClose,status.state?.lastSettlement?.eventId]);if(status.deployed&&next!==signature){signature=next;log(`VALR live · ${status.state?.active?.phase||'no unresolved order'}${status.state?.active?.lastError?` · ${status.state.active.lastError}`:''}${status.lastError?` · ${status.lastError}`:''}`);if(status.state?.lastSettlement)log(`Verified exit loss · ${status.state.lastSettlement.loss}`)}}catch(e){if(active){setLiveCheck('unavailable');log(`VALR live status unavailable · ${err(e)}`)}}};void poll();const timer=window.setInterval(()=>void poll(),15000);return()=>{active=false;window.clearInterval(timer)}},[venue,cloudClient,authReady,created,screen,draftId,liveRevision]);
 const stopLive=async()=>{if(!cloudClient||liveBusy)return;setLiveBusy(true);try{await sharingRequest(cloudClient,`/api/valr/bots/${encodeURIComponent(draftId)}/live`,'POST',{action:'stop'});log('VALR live · new entries stopped; existing fill monitoring continues')}catch(e){log(`Live stop not confirmed · ${err(e)}`)}finally{setLiveBusy(false);setLiveRevision(v=>v+1)}};
 const controlPaper=async()=>{if(!cloudClient||!paperStatus?.deployed||!paperStatus.state||paperBusy)return;const action=paperStatus.state.running?'stop':'start';setPaperBusy(true);try{await sharingRequest(cloudClient,`/api/valr/bots/${encodeURIComponent(draftId)}/paper`,'POST',{action});log(`Paper robot · ${action} confirmed`);setPaperRevision(v=>v+1)}catch(e){log(`Paper ${action} not confirmed · ${err(e)}`);setPaperRevision(v=>v+1)}finally{setPaperBusy(false)}};
 const clearLogs=()=>{logsRef.current=[];setLogs([]);if(result&&cloudClient)void userBotRequest<{saved:boolean}>(`/api/user-bots/${encodeURIComponent(draftId)}/backtest`,'PATCH',{logs:[]}).catch(()=>undefined)};
 const deleteSavedBacktest=async()=>{if(!cloudClient)throw new Error('Sign in to delete this saved backtest.');await userBotRequest<{deleted:boolean}>(`/api/user-bots/${encodeURIComponent(draftId)}/backtest`,'DELETE');await clearPendingBacktest(`${cloudClient.getProfile()?.uid||'local'}:${draftId}`).catch(()=>undefined);const savedBot=cloudBots.find(bot=>bot.id===draftId);if(savedBot)await cloudClient.saveBot({...savedBot,lastBacktest:null},savedBot.storageKey||'');setCloudBots(items=>items.map(bot=>bot.id===draftId?{...bot,lastBacktest:null}:bot));setResult(null);setLastBacktestCode('');logsRef.current=[];setLogs([]);setOutputTab('terminal');setSelectedTrade(null)};
 const create=async(retry=false)=>{
  hydratedWorkspaceRef.current=draftId;
  if(!name.trim()||!prompt.trim()||busy||!assetOptions.includes(asset))return;
  setCreateError('');setAiError('');setCreated(true);setScreen('workspace');setView('code');setTab('code');if(!retry){setCode('');setCodeHydrated(false);setResult(null);setProposal('');setProposalSummary('')}setBusy('generate');clearLogs();
  setChatHydrated(true);setChat([{role:'assistant',content:`Writing ${name} for ${asset}…`}]);if(window.innerWidth<=640){setChatCollapsed(false);setMobilePanel('chat');}
  log(`Creating ${name||'Untitled bot'} · ${asset}`);
  try{
   const text=await ai([
    {role:'system',content:'Generate one complete, valid JavaScript trading strategy as an editor payload. Use only the available historical price timeframes listed in the user message. Set config.executionTimeframe to one listed timeframe and include only listed timeframes in config.timeframes; multiple listed timeframes are allowed. Define export function onCandle(ctx). Include riskPercent: 1 and riskReward: 2. Do not request a timeframe that was not supplied. Native JS only. ctx.timeframes[tf] has the most recent 1000 completed candles only; ctx.candle is the current execution candle. Return {action:"BUY"|"SELL"|"WAIT", stopLoss:number, takeProfit:number}. Every entry must have stop and target on the correct side of expected entry. The selected asset is supplied by the app. Never claim profitability. Use VALR market data and calculate trades from runtime ctx candles; never invent fixed market prices. Return complete code inside exactly one ```js block, preceded by a short English summary. The app inserts code into the editor and never shows it in chat.'},
    {role:'user',content:`Bot name: ${name}\nAsset: ${asset}\nAvailable price timeframes: ${selectedMarket?.timeframes.join(', ')||'m1'}\nStrategy: ${prompt}`}
   ],asset,()=>{},6000,true);
   const generated=extractCode(text);const generatedConfig=parseStrategyConfig(generated);const storedTimeframes=selectedMarket?.timeframes||[];if(storedTimeframes.length&&generatedConfig.timeframes.some((tf:string)=>!storedTimeframes.includes(tf)))throw new Error(`AI requested ${generatedConfig.timeframes.join(', ')} history, but available ${asset} prices use ${storedTimeframes.join(', ')}. Retry generation.`);
   if(!/export\s+function\s+onCandle\s*\(/.test(generated))throw new Error('AI response did not include the required onCandle(ctx) strategy export. Retry generation.');validateStrategySyntax(generated);
   setCode(generated);setCodeHydrated(true);setAiError('');setChat([{role:'assistant',content:conciseAssistantText(text)||'Your strategy is ready in the code editor. Review it, then run a backtest.'}]);
   log('AI strategy generated and contract checked. Review the code before backtesting.');
  }catch(error){
   const message=error instanceof Error&&error.name==='AbortError'?'AI request timed out. Retry generation.':err(error);setAiError(message);setCreateError(message);setChat([{role:'assistant',content:`Robot generation failed: ${message}`}]);
   log(`Generation failed · ${message}`);
  }finally{setBusy('')}
 };
 const backtest=async(override?:{code:string;asset:string;name:string})=>{if(liveLocked||liveCheck!=='ready'){setTerminalOpen(true);setOutputTab('terminal');log('Backtest unavailable · confirm that the instance is stopped, or create a copy.');return}const runCode=override?.code||code,runAsset=override?.asset||asset,runName=override?.name||name,runSignature=JSON.stringify([venue,runCode,runAsset,from,to]);const controller=new AbortController();abortRef.current=controller;let durableRun:{botId:string;runId:string}|null=null;let heartbeatTimer:number|undefined;let heartbeatInFlight:Promise<unknown>|null=null;let pendingFinish:{outcome:'completed'|'failed';summary?:Record<string,number|string>;error?:string}|null=null;const stopDurableTimer=()=>{if(heartbeatTimer!==undefined){window.clearInterval(heartbeatTimer);heartbeatTimer=undefined}};const finishDurableRun=async(outcome:'completed'|'failed',summary?:Record<string,number|string>,error?:string)=>{const run=durableRun;if(!run||!cloudClient)return;stopDurableTimer();if(heartbeatInFlight)await heartbeatInFlight;pendingFinish={outcome,summary,error};const syncFinish=async()=>{if(!pendingFinish||!durableRun||durableRun.runId!==run.runId)return true;const pending=pendingFinish;try{await userBotRequest('/api/agents/backtest','POST',{action:pending.outcome,botId:run.botId,runId:run.runId,...(pending.summary?{summary:pending.summary}:{}),...(pending.error?{error:pending.error}:{})});durableRun=null;pendingFinish=null;stopDurableTimer();setAgentRevision(value=>value+1);return true}catch(syncError){log('Agent history sync failed · '+err(syncError));return false}};if(!await syncFinish()){heartbeatTimer=window.setInterval(()=>{if(heartbeatInFlight)return;heartbeatInFlight=syncFinish().finally(()=>{heartbeatInFlight=null})},30000)}};setBusy('backtest');setResult(null);setSelectedTrade(null);setOutputTab('terminal');setTerminalOpen(true);clearLogs();try{log(`Validating ${runName||'strategy'} · ${runAsset}…`);const cfg=parseStrategyConfig(runCode);const market=marketAvailability.find(item=>item.asset===runAsset);const unavailable=market?cfg.timeframes.filter((tf:string)=>!market.timeframes.includes(tf)):[];if(unavailable.length)throw new Error(`${runAsset} price history is listed at ${market!.timeframes.join(', ')} only. This strategy requires ${unavailable.join(', ')}. Edit the strategy timeframe.`);const rangeStart=Date.parse(`${from}T00:00:00Z`),rangeEnd=Date.parse(`${to}T23:59:59Z`),intervalMs:Record<string,number>={m1:60_000,m5:300_000,m15:900_000,m30:1_800_000,h1:3_600_000,h4:14_400_000,d1:86_400_000};for(const tf of cfg.timeframes){const estimated=Math.ceil((rangeEnd-rangeStart)/(intervalMs[tf]||60_000))+500;if(!Number.isFinite(rangeStart)||!Number.isFinite(rangeEnd)||rangeEnd<=rangeStart)throw new Error('Choose a valid date range before backtesting.');if(estimated>50_000)throw new Error(`${tf.toUpperCase()} range is too large for one reliable run. Choose a shorter date range (the server limit is 50,000 candles per timeframe).`);const available=market?.datesByTimeframe?.[tf]||market?.dates;if(available?.length&&!available.some((date:string)=>date>=from&&date<=to))throw new Error(`No ${tf.toUpperCase()} candles are available between ${from} and ${to}. Choose dates shown for that timeframe.`)}log(`Strategy valid · requesting ${cfg.timeframes.join(', ')} history`);if(cloudClient&&cloudBots.some(bot=>bot.id===draftId)){try{const started=await userBotRequest<{runId:string}>('/api/agents/backtest','POST',{action:'start',botId:draftId,code:runCode,asset:runAsset});durableRun={botId:draftId,runId:started.runId};heartbeatTimer=window.setInterval(()=>{if(!durableRun||pendingFinish||heartbeatInFlight)return;heartbeatInFlight=userBotRequest('/api/agents/backtest','POST',{action:'heartbeat',botId:draftId,runId:started.runId}).catch(syncError=>{log('Backtest agent heartbeat unavailable · '+err(syncError))}).finally(()=>{heartbeatInFlight=null})},60000);setAgentRevision(value=>value+1);log('Backtest record started · '+(runName||'strategy')+' · '+runAsset)}catch(agentError){log('Agent history unavailable for this run · '+err(agentError))}}const all:Record<string,Candle[]>={},sources=new Set<string>();for(const tf of cfg.timeframes){log(`Loading ${runAsset} ${tf} price history…`);const data=await historicalData({venue,asset:runAsset,timeframe:tf,from:new Date(rangeStart - 200 * intervalMs[tf]).toISOString(),to:new Date(`${to}T23:59:59Z`).toISOString()},controller.signal,()=>log('VALR rate limit reached · waiting one minute before retrying.'));if(!Array.isArray(data.candles))throw Error(`Market data returned an invalid ${tf} candle payload.`);all[tf]=data.candles;if(data.source)sources.add(data.source);log(`Loaded ${all[tf].length.toLocaleString()} ${tf} candles, including warm-up.`);const warmupCount=all[tf].filter(c=>c.time*1000<rangeStart).length;if(warmupCount<200)log(`Data note · ${tf.toUpperCase()} has ${warmupCount} of 200 requested warm-up candles; indicators may need more history.`);if(data.observedGaps)log(`Data note · ${data.observedGaps} gaps between returned candles; market closures may account for gaps.`)}const out=await runBacktest(runCode,all,0,controller.signal,rangeStart/1000);if(inputSignatureRef.current!==runSignature){log('Backtest discarded because strategy, asset, or dates changed during the run.');await finishDurableRun('failed',undefined,'Backtest result discarded because its inputs changed during execution.');return}const {decisions,...theoretical}=out;const completed={...theoretical,source:[...sources].join(' + ')||'Market data',timeframe:cfg.executionTimeframe,logs:[]};setLastBacktestCode(runCode);setResult(completed);setMoneyReplay({result:completed,decisions,riskPercent:cfg.riskPercent});await finishDurableRun('completed',{netReturn:out.metrics.netReturn,winRate:out.metrics.winRate,profitFactor:out.metrics.profitFactor,maxDrawdown:out.metrics.maxDrawdown,trades:out.metrics.trades,wins:out.metrics.wins,losses:out.metrics.losses});out.logs.forEach(log);setOutputTab(venue==='propdao'?'prop-results':'results');setTerminalOpen(true);log(`Net result ${fmt(out.metrics.netReturn)}R · max drawdown ${fmt(out.metrics.maxDrawdown)}R`);if(chatBacktestBotRef.current===draftId){
    chatBacktestBotRef.current='';setChatBacktestBotId('');
    const card:BacktestCardData={botId:draftId,name:runName,asset:runAsset,venue,from,to,completedAt:new Date().toISOString(),metrics:out.metrics,
      trades:completed.trades.slice(0,100).map((t:Trade)=>({id:t.id,side:t.side,entryTime:t.entryTime,exitTime:t.exitTime,entry:t.entry,exit:t.exit,pnl:t.pnl,reason:t.reason})),
      candleCount:completed.candles.length,source:completed.source};
    setChat(current=>[...current,{role:'assistant',content:out.metrics.trades?'**'+runName+'** took '+out.metrics.trades+' trades and finished at **'+fmt(out.metrics.netReturn)+'R**. Its deepest drawdown was **'+fmt(out.metrics.maxDrawdown)+'R**. The trades below show how it got there.':'**'+runName+'** ran through '+completed.candles.length.toLocaleString()+' candles without opening a trade. This run shows no trade performance to evaluate.',context:{kind:'backtest-result',label:'Backtest · '+runName,data:card}}]);
   }if(cloudClient){const sparseSignals=decisions.flatMap((decision:any,index:number)=>decision?.action==='BUY'||decision?.action==='SELL'?[{index,action:decision.action,stopLoss:decision.stopLoss,takeProfit:decision.takeProfit}]:[]);const savedState={venue,result:completed,sparseSignals,riskPercent:cfg.riskPercent,propRiskPercent:venue==='propdao'?propRiskPercent:undefined,logs:logsRef.current,from,to,outputTab:'results',terminalOpen:true,strategyCode:runCode,asset:runAsset,savedAt:new Date().toISOString()};setBusy('sync');log('Backing up the completed run and syncing it to cloud storage…');const backupKey=`${cloudClient.getProfile()?.uid||'local'}:${draftId}`;try{const compressed=await compressBacktest(savedState);try{await savePendingBacktest(backupKey,compressed)}catch(backupError){log(`Local backup unavailable · ${err(backupError)}`)}await userBotRequest<{saved:boolean}>(`/api/user-bots/${encodeURIComponent(draftId)}/backtest`,'PUT',compressed);await clearPendingBacktest(backupKey).catch(()=>undefined);log('Completed backtest confirmed saved in cloud storage.')}catch(saveError){log(`Cloud sync not confirmed · ${err(saveError)}. Any completed local backup will retry when you reopen this bot.`)}}setTab('chart');setView('chart')}catch(e){await finishDurableRun('failed',undefined,err(e));setOutputTab('terminal');setTerminalOpen(true);log(`Backtest stopped · ${err(e)}`);if(chatBacktestBotRef.current===draftId){chatBacktestBotRef.current='';setChatBacktestBotId('');setChat(current=>[...current,{role:'assistant',content:'The backtest did not finish: '+err(e)+'. No result was saved as completed.'}])}}finally{abortRef.current=null;setBusy('')}};
 const selectChatTaskChoice=(choice:string)=>{
  const task=assistantTask;if(!task||busy)return;
  if(task.kind==='backtest'){
   let dates:{from:string;to:string}|null=null;
   if(choice==='preset:7'||choice==='preset:30')dates=backtestPreset(choice==='preset:7'?7:30);
   if(choice.startsWith('dates:')){const split=choice.slice(6).split(':');if(split.length===2)dates={from:split[0],to:split[1]}}
   if(!dates||dates.to<dates.from)return;
   void sendChat('Backtest "'+task.botName+'" from '+dates.from+' to '+dates.to+' UTC');
   return;
  }
  void sendChat(choice);
 };
 const retryChat=()=>{const last=[...chat].reverse().find(item=>item.role==='user');if(last)void sendChat(last.content,last.context,true)};
 const getRuntimeStatus=async():Promise<string>=>{
  if(!cloudClient)return 'Sign in to check agent status.';
  if(!created)return 'No bot is selected. Open your robot library to select an agent.';
  if(venue==='propdao'){
   try{
    const data=await sharingRequest<any>(cloudClient,`/api/venues/propdao/bots/${encodeURIComponent(draftId)}/live`);
    setPropLive({...data,botId:draftId,loading:false});
    const state=data.uncertain||data.statusUnavailable?'UNKNOWN':data.running?'RUNNING':data.paused?'PAUSED':data.deployed?'DEPLOYED BUT STOPPED':'NOT DEPLOYED';
    return `PropDAO agent: ${state}. Last signal: ${String(data.lastSignal??data.lastResult??'not reported')}. ${data.error?'Runtime error: '+String(data.error):''} State reflects the latest runtime response, not a guarantee of execution.`;
   }catch(error){setPropLiveRevision(v=>v+1);return `PropDAO status UNVERIFIED: ${err(error)}. Do not assume this agent is stopped.`;}
  }
  if(venue==='valr'){
   const statuses:string[]=[];
   try{
    const paper=await sharingRequest<any>(cloudClient,`/api/valr/bots/${encodeURIComponent(draftId)}/paper`);
    setPaperStatus(paper);
    statuses.push(`Paper: ${paper.state?.running?'RUNNING':paper.deployed?'STOPPED':'NOT DEPLOYED'}, signal: ${String(paper.state?.lastResult||'not reported')}`);
   }catch(error){statuses.push(`Paper: UNVERIFIED (${err(error)})`);}
   try{
    const live=await sharingRequest<any>(cloudClient,`/api/valr/bots/${encodeURIComponent(draftId)}/live`);
    setLiveAccount(live);setLiveCheck('ready');
    statuses.push(`Live: ${live.state?.bots?.[draftId]?.running?'RUNNING':live.deployed?'DEPLOYED / NOT CONFIRMED RUNNING':'NOT DEPLOYED'}`);
   }catch(error){setLiveCheck('unavailable');statuses.push(`Live: UNVERIFIED (${err(error)})`);}
   return statuses.join('\n')+'\nBroker fills and protective orders must be independently reconciled.';
  }
  return `${venueLabel[venue]} does not currently provide a verified execution-status tool in this workspace.`;
 };
 const sendChat=async(messageOverride?:string,attachedContext?:ChatContext,retryPrevious=false,requestedCode?:{tool:'find_code'|'backtest'|'deploy'|'stop'|'status';botId:string})=>{
  const submittedMessage=(messageOverride??chatInput).trim();let message=submittedMessage;
  if(!message||busy||!chatHydrated||chatTurnRef.current||conversationSwitching.current)return;
  // Rename a pending NEW robot proposal without dropping its already validated code.
  const proposedName=newCodeTarget&&/\b(?:new name|name it|named|called)\b/i.test(submittedMessage)?parseRobotName(submittedMessage):null;
  if(proposedName&&newCodeTarget){
   setNewCodeTarget(current=>current?{...current,name:proposedName}:current);
   setChatInput('');
   setChat(items=>[...items,{role:'user',content:submittedMessage},{role:'assistant',content:'Updated the proposed robot name to **'+proposedName+'**. Review the strategy.js diff and save when you approve it.'}]);
   return;
  }
  followChat.current=true;
  const submittedScope=chatScopeRef.current;
  const controller=new AbortController();
  const sameChatScope=()=>chatScopeRef.current===submittedScope&&!controller.signal.aborted;
  const checkpoint=()=>controller.signal.throwIfAborted();
  const request=<T,>(path:string,method='GET',body?:unknown)=>sharingRequest<T>(cloudClient!,path,method,body,{signal:controller.signal});
  let finish!:()=>void;
  setChatOperation(null);setPendingCodeOperation(null);setProposal('');setStagedReview(null);setCodeEditTarget(null);setNewCodeTarget(null);setPendingWatchAsset(null);
  const prior=retryPrevious?chat.slice(0,-2):chat;
  const visibleMessage=assistantTask?.kind==='choose-robot'&&submittedMessage.startsWith('robot:')?
  'Selected '+(cloudBots.find(bot=>bot.id===submittedMessage.slice(6))?.name||'robot'):submittedMessage;
  const userMessage:Chat={role:'user',content:visibleMessage,...(attachedContext?{context:attachedContext}:{})};
  const next=[...prior,userMessage];
  const turn={controller,done:new Promise<void>(resolve=>{finish=resolve}),stoppedChat:[...next,{role:'assistant',content:'Response stopped.'} as Chat],canStop:true};
  chatTurnRef.current=turn;
  setChatCanStop(true);
  const lockWorkspace=()=>{checkpoint();turn.canStop=false;setChatCanStop(false);};
  const sdkPrimary=chatStreamPath(import.meta.env.VITE_AI_SDK_CHAT_ENABLED)==='/api/ai-sdk/stream';
  try{
  // Paint the submitted turn before waiting for the planner or network.
  setChatInput('');setAiError('');setChat([...next,{role:'assistant',content:'Thinking…'}]);
   let command:string|null=null;
   let forcedCommand:string|null=null,forcedBotId:string|null=null;
   let planArgs:Record<string,unknown>={};
   if(/^(?:cancel|never mind|nevermind|forget it|abort)(?: the task)?[.! ]*$/i.test(submittedMessage)&&assistantTask){
    setAssistantTask(null);setChat([...next,{role:'assistant',content:'Cancelled this request. Your saved robots and broker connections are unchanged.'}]);return;
   }
   const startCreate=isNewRobotRequest(submittedMessage);
   const anotherAction=/^\s*(?:backtest|retest|deploy|stop|check status|inspect|analyse|analyze)\b/i.test(submittedMessage);
   if(startCreate||(assistantTask?.kind==='create'&&!anotherAction)){
    const working=createTaskFromMessage(submittedMessage,startCreate?null:assistantTask,tradingPreferences,prior);
    if(!createReady(working)){
     setAssistantTask(working);
     setChat([...next,{role:'assistant',content:'I have the new robot idea. Choose a market below and I’ll build the proposal using what you’ve already told me.'}]);return;
    }
    setAssistantTask(null);forcedCommand='create';
    message=completeCreatePrompt(working,tradingPreferences);
   }
   if(assistantTask?.kind==='backtest'&&!startCreate){
    const manualDates=chatBacktestDates(submittedMessage);
    if(manualDates){
     forcedCommand='backtest';forcedBotId=assistantTask.botId;setAssistantTask(null);
     message='Backtest "'+assistantTask.botName+'" from '+manualDates.from+' to '+manualDates.to;
    }else if(!anotherAction){
     setChat([...next,{role:'assistant',content:'Choose the historical From and To dates in the card below. I’ll use that range for **'+assistantTask.botName+'**.'}]);return;
    }else setAssistantTask(null);
   }
   if(assistantTask?.kind==='choose-robot'){
    const direct=resolveCodeReference(submittedMessage,cloudBots)?.bot;
    const clicked=submittedMessage.startsWith('robot:')?cloudBots.find(bot=>bot.id===submittedMessage.slice(6)):null;
    const chosen=clicked||direct;
    if(!chosen){
     setChat([...next,{role:'assistant',content:'I could not match that name to a saved robot. Select one of the options below or type its exact name.'}]);return;
    }
    forcedBotId=chosen.id;forcedCommand=assistantTask.action;message=assistantTask.action+' "'+chosen.name+'"';
    setAssistantTask(null);
   }

  let focusedCode:{bot:CloudBot;source:string}|null=null;
  let creatingCode:{id:string;name:string;asset:string;venue:Venue;prompt:string}|null=null;
  const requestedBot=forcedBotId?cloudBots.find(bot=>bot.id===forcedBotId):requestedCode?cloudBots.find(bot=>bot.id===requestedCode.botId):undefined;
  const named=resolveCodeReference(message,cloudBots);
  const subject=requestedCode||forcedBotId?null:conversationRobot(message,prior,cloudBots);
  const referenced=requestedBot?{bot:requestedBot,confidence:'exact' as const}:requestedCode?null:named??(subject?{bot:subject,confidence:'unique' as const}:null);
  const matchingAnalysis=codeAnalyses.find(a=>message.toLowerCase().includes(a.name.toLowerCase()));
  const directWatch=/\b(track|monitor|watch|notify|alert)\b/i.test(message)&&/\b(sweep|liquidity|volatility|atr)\b/i.test(message);
  const directMarketAnalysis=(/\b(liquidity sweeps?|volatility profile|market volatility|atr\s*14|volatility of)\b/i.test(message)&&/\b(how many|today|yesterday|last|what|show|scan|calculate|run|check|analy[sz]e|find|count|profile)\b/i.test(message))||Boolean(matchingAnalysis&&/\b(run|execute|scan|check|analy[sz]e|calculate)\b/i.test(message));
  setBusy('chat');
  try{
   const newsRequest=!attachedContext&&!requestedCode?newsIntent(message):null;
   if(newsRequest?.coverage){
    const snapshot=await request<NewsSnapshot|NewsTrend>('/api/news/'+(newsRequest.coverage?'trend':'snapshot')+'?topic='+encodeURIComponent(newsRequest.topic)+'&span='+encodeURIComponent(newsRequest.span),'GET');
    checkpoint();
    setChat([...next,{role:'assistant',content:'GDELT '+(newsRequest.coverage?'article coverage':'indexed headlines')+' for **'+newsRequest.topic.toUpperCase()+'** over **'+newsRequest.span+'**. Source timestamps are indexing times, not verified publication times. News does not establish what caused a price move.',context:{kind:newsRequest.coverage?'news-coverage':'news-snapshot',label:'GDELT '+newsRequest.topic+' '+(newsRequest.coverage?'coverage':'headlines'),data:snapshot}}]);
    return;
   }
   if(requestedCode&&!requestedBot)throw Error('That saved strategy is no longer available.');
   if(!attachedContext){
    if(!cloudClient)throw Error('Sign in to use your AI.');
    if(forcedCommand){command=forcedCommand}
    else if(requestedCode&&referenced){command=requestedCode.tool}
    else if(isEditFollowup(submittedMessage)){command='edit'}
    else if(referenced&&/^(?:nice|okay|ok|now|please|yeah|yes)?[,\s!]*(?:deploy|start bot|run live)\s+/i.test(submittedMessage)){command='deploy'}
    else if(referenced&&/^(?:nice|okay|ok|now|please)?[,\s!]*(?:backtest|retest)\b/i.test(submittedMessage)){command='backtest'}
    else if(/^\s*(?:please\s+)?(?:build|create|write|generate)\b/i.test(message)&&/\b(?:propdao|valr|hyperliquid|ctrader)\b/i.test(message)&&/\bstrategy\b/i.test(message)&&/\b(?:test|backtest|replay)\b/i.test(message)){command='create'}
    else if(referenced&&/^\s*(?:please\s+)?(?:make (?:it|this|the robot|a) (?:a )?better version|improve (?:it|this|the robot)|rewrite (?:it|this|the robot)|update (?:it|this|the robot)|change (?:it|this|the robot))\b/i.test(message)){command='edit'}
     else if(referenced&&/^\s*(?:please\s+)?(?:backtest|retest)\b/i.test(message)){command='backtest'}
    else if(referenced&&/^\s*(?:please\s+)?(?:explain|describe|inspect|review|what does)\b/i.test(message)){command='find_code'}
    else if(directWatch){command='watch'}else if(directMarketAnalysis){command='analyze_market'}else if(/\b(backtest|retest|run|deploy|stop|pause|status|create|build|write|generate|edit|update|modify|change|rename|delete|remove|add|skill|personality|connect|disconnect|broker|find|code|strategy|robot|bot)\b/i.test(message)){const planned=await request<{tool:string|null;args?:Record<string,unknown>}>(sdkPrimary?'/api/chat/sdk-plan':'/api/chat/plan','POST',{message,skills:skills.map(s=>s.name),personality,...(conversationModel?{model:conversationModel}:{})});checkpoint();command=planned.tool;planArgs=planned.args||{};}
   }
  }catch(error){checkpoint();const reason=err(error);setAiError(reason);setChat([...next,{role:'assistant',content:'Could not prepare this request: '+reason}]);setBusy('');return;}
   if(command==='edit_personality'&&!/\b(personality|profile|speaking style|conversation tone|chat personality)\b/i.test(submittedMessage)){
    command=referenced&&isEditFollowup(submittedMessage)?'edit':null;
   }
   if(sdkPrimary&&command==='manage_broker'&&planArgs.action==='inspect')command=null;
  if(command&&['manage_skill','edit_personality','rename_code','delete_code','manage_broker'].includes(command)){
   try{
    if(!cloudClient||!activeProfile?.uid)throw Error('Sign in to manage your saved workspace.');
    const identity={uid:activeProfile.uid,chatId:conversationId};
    let change:AssistantChange;
    if(command==='manage_skill'){
     if(skillsLoading||skillsError)throw Error('Open Skills and finish loading your library before editing it from chat.');
     const action=String(planArgs.action),target=String(planArgs.name||'').trim();
     const matches=skills.filter(s=>s.name.trim().toLocaleLowerCase()===target.toLocaleLowerCase());
     if(!['create','update','delete'].includes(action)||!target)throw Error('Please name the skill and the change.');
     if(action==='create'){
      if(matches.length)throw Error('A skill with that name already exists. Choose a different name or ask to update it.');
      const after=validateSkill({id:'skill-'+crypto.randomUUID(),name:target,description:String(planArgs.description||''),instructions:String(planArgs.instructions||''),triggers:Array.isArray(planArgs.triggers)?planArgs.triggers.map(String):[],alwaysOn:planArgs.alwaysOn===true,enabled:planArgs.enabled!==false});
      change={...identity,kind:'skill',action:'create',after};
     }else{
      if(matches.length!==1)throw Error(matches.length?'More than one skill has that name. Rename one in Skills first.':'I could not find that skill.');
      const before=matches[0];
      const after=action==='update'?validateSkill({...before,...(typeof planArgs.newName==='string'?{name:planArgs.newName.trim()}:{}),...(typeof planArgs.instructions==='string'?{instructions:planArgs.instructions}:{}),...(typeof planArgs.description==='string'?{description:planArgs.description}:{}),...(Array.isArray(planArgs.triggers)?{triggers:planArgs.triggers.map(String)}:{}),...(typeof planArgs.alwaysOn==='boolean'?{alwaysOn:planArgs.alwaysOn}:{}),...(typeof planArgs.enabled==='boolean'?{enabled:planArgs.enabled}:{})}):undefined;
      change={...identity,kind:'skill',action:action as 'update'|'delete',before,after};
     }
    }else if(command==='edit_personality'){
     if(typeof planArgs.instructions!=='string'||planArgs.instructions.length>4000)throw Error('The proposed personality is invalid.');
     change={...identity,kind:'personality',before:personality,after:planArgs.instructions.trim()};
    }else if(command==='rename_code'||command==='delete_code'){
     const target=String(planArgs.name||'').trim().toLocaleLowerCase();const matches=cloudBots.filter(bot=>bot.name.trim().toLocaleLowerCase()===target);
     if(matches.length!==1)throw Error(matches.length?'More than one saved Code item has that name. Rename one in Code first.':'I could not find that saved Code item.');
     const newName=String(planArgs.newName||'').trim();if(command==='rename_code'&&!newName)throw Error('Provide the new name.');
     change={...identity,kind:'code',action:command==='rename_code'?'rename':'delete',before:matches[0],...(newName?{newName}:{})};
    }else{
     const broker=String(planArgs.broker) as BrokerChoice,action=String(planArgs.action);
     if(!['propdao','ctrader','valr'].includes(broker)||!['connect','disconnect','inspect'].includes(action))throw Error('Choose a supported broker.');
     if(action==='inspect'){
      const status=await request<any>(broker==='propdao'?'/api/venues/propdao/accounts':broker==='ctrader'?'/api/venues/ctrader/accounts':'/api/valr/account');
      checkpoint();
      const summary=status.connected?(broker==='propdao'?'Connected PropDAO accounts: '+(status.accounts||[]).map((a:any)=>String(a.accountId)+' · '+String(a.status)).join(', '):broker==='ctrader'?'Connected cTrader accounts: '+(status.accounts||[]).map((a:any)=>String(a.brokerTitleShort||'cTrader')+' · '+(a.isLive?'real':'demo')).join(', '):'VALR is connected'+(status.label?' · '+String(status.label):'')):'No '+broker.toUpperCase()+' account is connected.';
      setChat([...next,{role:'assistant',content:summary}]);return;
     }
     if(broker!=='propdao')throw Error('Only PropDAO connections are available at launch.');
     change={...identity,kind:'broker',action:action as 'connect'|'disconnect',broker};
    }
    setAssistantChange(change);setAssistantReviewError('');setAssistantReviewOpen(true);
    setChat([...next,{role:'assistant',content:'I prepared the requested change. Review it in the confirmation before anything is changed.'}]);
   }catch(error){checkpoint();setChat([...next,{role:'assistant',content:'I could not prepare that change: '+err(error)}]);}
   return;
  }
   if(command==='create'&&!/\b(propdao|valr|hyperliquid|ctrader)\b/i.test(message)){
    const waiting=createTaskFromMessage(submittedMessage,null,tradingPreferences,prior);
    if(!createReady(waiting)){setAssistantTask(waiting);setChat([...next,{role:'assistant',content:'Choose a market below. I’ll remember your answer and build the robot without restarting the conversation.'}]);return;}
    message=completeCreatePrompt(waiting,tradingPreferences);setAssistantTask(null);
   }

  if(command==='watch'){
   if(/\btelegram\b/i.test(message)){setChat([...next,{role:'assistant',content:'Telegram delivery is paused. I can prepare a watch that records detections or summarizes them with OpenRouter.'}]);return;}
   if(!cloudClient){setChat([...next,{role:'assistant',content:'Sign in to prepare a Code watcher.'}]);return;}
   const kind:AnalysisKind=matchingAnalysis?.kind||(/\b(sweep|liquidity)\b/i.test(message)?'liquidity_sweeps':'volatility_profile');
   const targetAsset=message.match(/\b([A-Z]{2,12}(?:USDC|USDT|ZAR|USD))\b/)?.[1]||matchingAnalysis?.asset||(/\bgold\b/i.test(message)?'GOLDUSDC':asset);
   const watchVenue=matchingAnalysis?.venue||venue,watchTf=matchingAnalysis?.timeframe||((message.match(/\b(m1|m5|m15|h1)\b/i)?.[1]?.toLowerCase()||'m1') as 'm1'|'m5'|'m15'|'h1');
   if(!targetAsset){setChat([...next,{role:'assistant',content:'Which asset should the watcher track? For example: Track GOLDUSDC liquidity sweeps on M1.'}]);return;}
   const spec:CodeAnalysis={id:analysisId(kind,watchVenue,targetAsset,watchTf),name:(kind==='liquidity_sweeps'?'Liquidity Sweep Scanner':'Volatility Profile')+' · '+targetAsset,kind,asset:targetAsset,venue:watchVenue,timeframe:watchTf,lookback:5,source:analysisSource(kind)};
   setWatchOutput(/\b(?:summari[sz]e|ai call|use ai)\b/i.test(message)?{type:'ai'}:{type:'log'});
   setPendingWatchAsset(spec);
   setChat([...next,{role:'assistant',content:'Prepared **'+spec.name+'**. Review the market and timeframe below before saving and starting the read-only watcher.'}]);
   return;
  }
  if(command==='analyze_market'){
   if(!cloudClient){setChat([...next,{role:'assistant',content:'Sign in to run saved Code analysis.'}]);return;}
   setChatInput('');setBusy('chat');
   try{
    const kind:AnalysisKind=matchingAnalysis?.kind||(/\b(sweep|liquidity)\b/i.test(message)?'liquidity_sweeps':'volatility_profile');
    const requestedAsset=message.match(/\b([A-Z]{2,12}(?:USDC|USDT|ZAR|USD))\b/)?.[1]||matchingAnalysis?.asset||(/\bgold\b/i.test(message)?'GOLDUSDC':asset);
    const requestedVenue=matchingAnalysis?.venue||venue;
    const timeframe=matchingAnalysis?.timeframe||((message.match(/\b(m1|m5|m15|h1)\b/i)?.[1]?.toLowerCase()||'m1') as 'm1'|'m5'|'m15'|'h1');
    if(!requestedAsset)throw Error('Choose a market, for example GOLDUSDC, before running the scanner.');
    const now=Date.now(),day=Math.floor(now/86400000)*86400000;
    const start=/\byesterday\b/i.test(message)?day-86400000:/\b(last\s+(?:7\s+days|week))\b/i.test(message)?day-7*86400000:day;
    const end=/\byesterday\b/i.test(message)?day:now;
    setChat([...next,{role:'assistant',content:'Scanning verified '+requestedAsset+' '+timeframe.toUpperCase()+' candles from '+new Date(start).toISOString()+'…'}]);
    const history=await historicalData({venue:requestedVenue,asset:requestedAsset,timeframe,from:new Date(start).toISOString(),to:new Date(end).toISOString()},controller.signal);
    checkpoint();
    const report=analyzeMarket({kind,asset:requestedAsset,timeframe,from:new Date(start).toISOString(),to:new Date(end).toISOString(),lookback:matchingAnalysis?.lookback||5},history.candles);
    if(report.bars<15)throw Error('Not enough completed historical candles were returned to produce a verified analysis.');
    const analysis:CodeAnalysis={id:analysisId(kind,requestedVenue,requestedAsset,timeframe),name:(kind==='liquidity_sweeps'?'Liquidity Sweep Scanner':'Volatility Profile')+' · '+requestedAsset,kind,asset:requestedAsset,venue:requestedVenue,timeframe,lookback:matchingAnalysis?.lookback||5,source:analysisSource(kind)};
    let saved=false;
    try{lockWorkspace();await cloudClient.saveCodeAnalysis(analysis);checkpoint();setCodeAnalyses(current=>[analysis,...current.filter(x=>x.id!==analysis.id)]);saved=true}catch(error){checkpoint();setCloudMessage('Code analysis was not saved: '+err(error))}
    setChat(current=>[...next,{role:'assistant',content:'Completed '+requestedAsset+' '+timeframe.toUpperCase()+' analysis using '+report.bars+' completed candles. '+(saved?'The reusable detector is saved in Code.':'The analysis ran, but the reusable detector could not be saved.'),context:{kind:'market-analysis',label:'Analysis · '+requestedAsset,data:report}}]);
   }catch(error){checkpoint();setChat([...next,{role:'assistant',content:'The historical scan could not be verified: '+err(error)+'. No result was invented.'}])}
   finally{setBusy('')}
   return;
  }
  // SDK discussion resolves the saved source on the server, with a recorded tool receipt.
  const sdkStrategyId=sdkPrimary&&command==='find_code'?referenced?.bot.id:undefined;
  const sdkBacktestId=sdkPrimary&&command==='backtest'&&referenced?.bot.venue==='hyperliquid'&&!/\bsaved historical data\b/i.test(message)?referenced.bot.id:undefined;
  if(sdkStrategyId||sdkBacktestId)command=null;
  if(command==='find_code'){
   if(!referenced){const suggestions=codeSuggestions(message,cloudBots);const matchingTools=codeAnalyses.filter(a=>message.toLowerCase().includes(a.asset.toLowerCase())||/\b(code|tools|library|scanner|analyses)\b/i.test(message));setChatInput('');setChat([...next,{role:'assistant',content:suggestions.length||matchingTools.length?'I found these saved Code items:\n'+[...suggestions.map(b=>'- **'+b.name+'** · '+b.asset+' · '+venueLabel[b.venue||'valr']),...matchingTools.map(a=>'- **'+a.name+'** · '+a.timeframe.toUpperCase()+' · callable analysis')].join('\n')+'\n\nWhich one do you mean? You can also open Code in the sidebar.':'I could not find matching saved code. Open Code to browse or ask me to create one.'}]);return;}
   try{const loaded=await request<{code:string}>('/api/user-bots/'+encodeURIComponent(referenced.bot.id)+'/current','GET');checkpoint();focusedCode={bot:referenced.bot,source:loaded.code};command=null}
   catch(error){setChat([...next,{role:'assistant',content:'Found '+referenced.bot.name+', but could not load its source: '+err(error)}]);return;}
  }
  if(command==='create'){
   const venueMatch=message.match(/\b(propdao|valr|hyperliquid|ctrader)\b/i);
   const requestedVenue=venueMatch?venueOf(venueMatch[1].toLowerCase()):null;
   const marketMatch=requestedVenue==='hyperliquid'
    ?message.match(/\b([A-Za-z0-9_:.@-]{1,64})\s+(?:trading\s+)?strategy\b/i)
    :message.match(/\b([A-Z]{2,12}(?:USDC|USDT|ZAR|USD))\b/i)|| (requestedVenue==='propdao'?message.match(/\b(gold)\b/i):null);
   if(!requestedVenue||!marketMatch){setChatInput('');setChat([...next,{role:'assistant',content:'Specify a market and venue, for example: Create a GOLDUSDC strategy on PropDAO named Gold Sweeper.'}]);return;}
   const marketName=requestedVenue==='propdao'&&/^gold$/i.test(marketMatch[1])?'GOLDUSDC':marketMatch[1];
   if(requestedVenue==='ctrader'){setChat([...next,{role:'assistant',content:'cTrader strategy creation needs a verified broker market catalogue first. Choose a connected supported venue.'}]);return;}
   let requestedAsset:string;
   try{
    const response=await fetch(requestedVenue==='valr'?'/api/valr/markets':'/api/venues/'+requestedVenue+'/markets',{signal:controller.signal});
    const data=await readApiJson<{markets:{symbol:string}[]}>(response,'Venue markets');checkpoint();
    const market=data.markets?.find(m=>m.symbol.toLowerCase()===marketName.toLowerCase());
    if(!market)throw Error('This market was not listed by the venue.');
    requestedAsset=market.symbol;
   }catch(error){checkpoint();setChat([...next,{role:'assistant',content:'Cannot verify '+marketName+' on '+venueLabel[requestedVenue]+': '+err(error)}]);return;}
   const title=(message.match(/(?:named|called)\s+["“]?([^"“”,.]{3,48})/i)?.[1]||requestedAsset+' AI strategy').trim().slice(0,64);
   creatingCode={id:makeBotId(),name:title,asset:requestedAsset,venue:requestedVenue,prompt:message};setNewCodeTarget(creatingCode);
    const learned={...tradingPreferences,preferredAsset:requestedAsset,preferredVenue:requestedVenue};
    setTradingPreferences(learned);
    void cloudClient?.saveTradingPreferences(learned).catch(()=>undefined);
  }
  if(command&&command!=='edit'&&command!=='create'){
   setChatInput('');setAiError('');
   if(command==='backtest'){
    if(!referenced&&(codeSuggestions(message,cloudBots).length>0||/["“][^"”]+["”]/.test(message))){setChat([...next,{role:'assistant',content:'The strategy name could match more than one saved item. Select the exact strategy in the Library before backtesting; no test has started.'}]);return;}
    const target=referenced?.bot||cloudBots.find(bot=>bot.id===draftId);
    if(!target){setChat([...next,{role:'assistant',content:'Choose saved code first. Mention the name, for example: Backtest MySol Robot.'}]);return;}
     let dates:ReturnType<typeof chatBacktestDates>;
     try{dates=chatBacktestDates(message)}catch(error){setChat([...next,{role:'assistant',content:err(error)}]);return;}
     if(!dates&&!/\bsaved historical data\b/i.test(message)){
      setAssistantTask({kind:'backtest',botId:target.id,botName:target.name});
      setChat([...next,{role:'assistant',content:'**'+target.name+'** is selected. Choose the historical range below; I’ll backtest that exact saved robot using UTC dates.'}]);return;
     }
     setAssistantTask(null);
     lockWorkspace();
    queuedChatDates.current=null;
    chatBacktestBotRef.current=target.id;setChatBacktestBotId(target.id);
    if(target.id!==draftId){
     setChat([...next,{role:'assistant',content:'Loading **'+target.name+'** for the historical run…'}]);
     try{
      const saved=await openCloudBot(target,{keepChat:true});checkpoint();
      const card=savedBacktestCard(target,saved);
      if(!dates&&/\bsaved historical data\b/i.test(message)&&!card)throw Error('No saved run. Give me the start and end dates.');
      if(dates){queuedChatDates.current=dates;setFrom(dates.from);setTo(dates.to);}
      if(card&&!dates)setChat([...next,{role:'assistant',content:'Here’s the previous result while the new run gets ready. It may use an earlier strategy version.',context:{kind:'backtest-result',label:'Saved backtest · '+target.name,data:card}}]);
      setBusy('backtest-queued');setQueuedBacktest(target.id);
     }catch(error){checkpoint();chatBacktestBotRef.current='';setChatBacktestBotId('');setChat(current=>[...current,{role:'assistant',content:'Could not prepare '+target.name+': '+err(error)}]);}
     return;
    }
    if(dates){
     queuedChatDates.current=dates;setFrom(dates.from);setTo(dates.to);setBusy('backtest-queued');setQueuedBacktest(target.id);
     setChat([...next,{role:'assistant',content:'Getting **'+target.name+'** ready for '+dates.from+' to '+dates.to+' (UTC).'}]);
     return;
    }
    let previousCard:BacktestCardData|null=null;
    if(target.lastBacktest){try{const payload=await userBotRequest<any>('/api/user-bots/'+encodeURIComponent(target.id)+'/backtest','GET');const saved=isCompressedBacktest(payload)?await decompressBacktest<any>(payload):payload;previousCard=savedBacktestCard(target,saved)}catch{}}
    const priorCardMessage:Chat[]=previousCard?[{role:'assistant',content:'Here is the last saved backtest. It may use an older code version.',context:{kind:'backtest-result',label:'Saved backtest · '+target.name,data:previousCard}}]:[];
    const useSavedRange=/\bsaved historical data\b/i.test(message);
    if(useSavedRange&&previousCard&&/^\d{4}-\d{2}-\d{2}$/.test(previousCard.from)&&/^\d{4}-\d{2}-\d{2}$/.test(previousCard.to)&&!liveLocked&&liveCheck==='ready'&&(from!==previousCard.from||to!==previousCard.to)){
     setChat([...next,...priorCardMessage,{role:'assistant',content:'Preparing a new run for the saved date range.'}]);setFrom(previousCard.from);setTo(previousCard.to);setBusy('backtest-queued');setQueuedBacktest(target.id);return;
    }
    const issue=useSavedRange&&!previousCard?'No completed saved backtest was found. Choose a date range to run a new test.':!created?'Open a saved bot or create one before running a backtest.':!codeHydrated||!code.trim()?'Strategy code is still loading.':!asset?'Choose a market first.':!from||!to||!availableDates.length?'No valid historical date range is selected. Open Backtest and choose a date range.':liveLocked||liveCheck!=='ready'?'The live strategy is locked or its status cannot be verified. Create a copy before testing.':unavailableTimeframes.length?'Required market timeframes are unavailable: '+unavailableTimeframes.join(', '):'';
    setChat([...next,...priorCardMessage,{role:'assistant',content:issue||`Running the historical backtest for ${name||'this strategy'} on ${asset}, ${from} to ${to}. Results will appear in this chat when available.`}]);
    if(!issue)void backtest();else{chatBacktestBotRef.current='';setChatBacktestBotId('')}
    return;
   }
   if(command==='status'){
    if(referenced?.bot&&referenced.bot.id!==draftId){
     const target=referenced.bot;try{
      if(target.venue==='propdao'){const state=await request<any>('/api/venues/propdao/bots/'+encodeURIComponent(target.id)+'/live');checkpoint();setChat([...next,{role:'assistant',content:'**'+target.name+'** · '+(state.uncertain||state.statusUnavailable?'Status unverified':state.running?'Running':state.deployed?'Stopped':'Not deployed')+'. Last signal: '+String(state.lastSignal||'not reported')+'.'+(state.error?' Runtime issue: '+String(state.error):'')}]);}
      else setChat([...next,{role:'assistant',content:'Open '+target.name+' in Code to verify its deployment status. There is no verified direct status shortcut for this venue.'}]);
     }catch(error){checkpoint();setChat([...next,{role:'assistant',content:'Could not verify '+target.name+': '+err(error)}])}return;
    }
    setChat([...next,{role:'assistant',content:'Checking the current execution runtime status…'}]);
    setBusy('chat');
    try{const status=await getRuntimeStatus();checkpoint();setChat([...next,{role:'assistant',content:status}]);}
    catch(error){setChat([...next,{role:'assistant',content:`Agent status could not be verified: ${err(error)}`}]);}
    finally{setBusy('');}
    return;
   }
    if(command!=='deploy'&&command!=='stop')return;
    if(command==='deploy'&&referenced?.bot){
     const bot=referenced.bot;
     if(bot.venue==='propdao'){
      setAssistantTask(null);setLibraryDeployment({bot,riskPercent:1});
      setChat([...next,{role:'assistant',content:'Opening **Deploy** for **'+bot.name+'** ('+bot.asset+' · PropDAO). Select the account and risk settings, then review and explicitly confirm the exact deployment. Nothing is running from this message alone.'}]);
      return;
     }
    }
    if(!referenced){
     const candidates=(codeSuggestions(message,cloudBots).length?codeSuggestions(message,cloudBots):cloudBots).slice(0,5);
     if(candidates.length){
      setAssistantTask({kind:'choose-robot',action:command,robotIds:candidates.map(bot=>bot.id)});
      setChat([...next,{role:'assistant',content:'Which saved robot should I '+command+'? Choose below, or type a different name.'}]);return;
     }
     setChat([...next,{role:'assistant',content:'No saved robots were found. Create one before managing its deployment.'}]);return;
    }
   if(referenced?.bot&&referenced.bot.id!==draftId){
    const target=referenced.bot;setChat([...next,{role:'assistant',content:'Loading '+target.name+' for the '+command+' review.'}]);
    try{lockWorkspace();await openCloudBot(target,{keepChat:true});checkpoint();setPendingCodeOperation({botId:target.id,action:command})}catch(error){checkpoint();setChat(current=>[...current,{role:'assistant',content:'Could not load '+target.name+': '+err(error)}])}return;
   }
   actionReview.current=createActionReview({uid:activeProfile?.uid||'',botId:draftId,code,venue});
   setChatOperation(command);
   setChat([...next,{role:'assistant',content:command==='deploy'?'I can open the existing deployment review. You must explicitly approve settings before anything starts.':'I can prepare a stop request. Please confirm it in the card below; no command has been sent yet.'}]);
   return;
  }
  if(command==='edit'&&(referenced||cloudBots.some(bot=>bot.id===draftId))){
   const target=referenced?.bot||cloudBots.find(bot=>bot.id===draftId)!;
   try{const loaded=await request<{code:string}>('/api/user-bots/'+encodeURIComponent(target.id)+'/current','GET');checkpoint();if(loaded.code.length>45000)throw Error('This source is too long to edit safely in one chat request.');focusedCode={bot:target,source:loaded.code};setCodeEditTarget(focusedCode)}
   catch(error){setChat([...next,{role:'assistant',content:'Could not load '+target.name+' for editing: '+err(error)}]);return;}
  }else setCodeEditTarget(null);
  if(command==='edit'&&!created&&!focusedCode){setChat([...next,{role:'assistant',content:'Name a saved strategy to edit, or ask me to create one.'}]);return;}
  if(command==='edit'&&!referenced&&!/\b(current editor|this draft|open robot)\b/i.test(message)){
   const candidates=(codeSuggestions(submittedMessage,cloudBots).length?codeSuggestions(submittedMessage,cloudBots):cloudBots).slice(0,5);
   if(candidates.length){setAssistantTask({kind:'choose-robot',action:'edit',robotIds:candidates.map(bot=>bot.id)});setChat([...next,{role:'assistant',content:'Which saved robot would you like me to edit? Choose below. I will not modify the current editor unless it is your selected robot.'}]);return;}

   setChat([...next,{role:'assistant',content:'Which saved robot should I improve? Name it or open it from the Robots library. I won’t edit the unrelated robot currently loaded in the workspace.'}]);
   return;
  }
  if(command==='edit'&&!focusedCode&&code.length>45000){setChat([...next,{role:'assistant',content:'This source is too long to edit safely in one chat request. Use a shorter strategy or edit it directly.'}]);return;}
  if(command==='edit')setNewCodeTarget(null);
  if(!focusedCode&&referenced&&command!=='create'&&command!=='backtest'){
   try{
    const response=await request<{code:string}>('/api/user-bots/'+encodeURIComponent(referenced.bot.id)+'/current','GET');
    checkpoint();
    if(response.code.length>200000)throw Error('Saved robot source exceeds the 200,000-character chat context limit.');
    focusedCode={bot:referenced.bot,source:response.code};
    if(command==='edit')setCodeEditTarget(focusedCode);
   }catch(error){
    setChat([...next,{role:'assistant',content:'I found **'+referenced.bot.name+'**, but I cannot safely inspect its source: '+err(error)+'. No changes were prepared.'}]);
    return;
   }
  }
  const wantsCode=command==='edit'||command==='create';
  const selectedSkillText=skillPrompt(message,skills);
  const personalityText=personality?'Personality preferences: '+personality:'';
  const userGuidance=[personalityText.slice(0,Math.max(0,6998-selectedSkillText.length)),selectedSkillText].filter(Boolean).join('\n\n');
  const skillInventory=skills.map(item=>item.name+' · '+(item.enabled?'enabled':'disabled')).join('\n').slice(0,3000)||'No saved skills.';

  const requestedEditor={draftId,code};
  setChatInput('');setAiError('');setChat([...next,{role:'assistant',content:wantsCode?'Preparing a strategy edit…':'Thinking…'}]);setBusy('chat');
  try{
   const appContext=sdkBacktestId?'Report the verified historical simulation tool result for strategy '+sdkBacktestId+' and its limitations.':sdkStrategyId?'Use the saved strategy tool result for this question. The requested strategy ID is '+sdkStrategyId+'.':focusedCode?'Retrieved saved code: '+focusedCode.bot.name+' on '+focusedCode.bot.asset+' · '+venueLabel[focusedCode.bot.venue||'valr']+'\nSaved backtest summary for THIS robot: '+JSON.stringify(focusedCode.bot.lastBacktest||'No saved backtest summary available.')+'\nExact saved source:\n'+focusedCode.source.slice(0,200000)+(focusedCode.source.length>200000?'\n[Source capped at 200,000 characters; file is incomplete. Report it clearly. Do not describe omitted code.]':''):command==='create'?'NEW strategy.js request for venue '+String(creatingCode?.venue||'propdao')+', market '+String(creatingCode?.asset||'GOLDUSDC')+'. User-confirmed original task and preferences: '+String(creatingCode?.prompt||message).slice(0,4000)+'. Produce a complete strategy implementing config and onCandle. This is not an edit of existing source.':created?`Bot: ${name||'Untitled'}
Asset: ${asset}
Available price timeframes: ${selectedMarket?.timeframes.join(', ')||'unknown'}
Current JavaScript strategy (authoritative):
${attachedContext?.kind==='trade-audit'?'[Included in the attached audit context below.]':code}
Latest backtest errors or output:
${logs.slice(-8).join('\n')||'None'}
Latest backtest metrics: ${result?JSON.stringify(result.metrics):'No completed backtest yet'}`:'No agent selected. The user can learn and converse without a strategy. Do not describe starter code as their strategy.';
   const system=`CONVERSATION ROBOT TARGET: ${focusedCode?'Robot '+focusedCode.bot.name+', saved robot ID '+focusedCode.bot.id+', venue '+focusedCode.bot.venue+', market '+focusedCode.bot.asset+' (not the editor bot '+name+')':'No verified named robot loaded; never assume the current editor is the robot the user refers to.'}. Never confuse two saved robot identities. An edit proposal and Apply button must name this exact robot; no code changes are saved until approved.
SAVED TRADING PREFERENCES (user-controlled defaults, not trade authorization): ${JSON.stringify(tradingPreferences)}. Reuse the user's known market, venue, timeframe and backtest preferences when reasonable. New explicit instructions always override preferences. Do not repeatedly ask details already established in this chat or saved defaults. If a necessary target is ambiguous, ask one short, concrete question; for supported robot workflows the interface supplies two selectable options and a third custom answer. Never announce an action as completed without a confirmed result.
OpenRouter and PropDAO are the available connections at launch. External app actions and new cTrader or VALR connections are paused.
Trade audits: lead with the practical outcome and why it happened, in clear conversational paragraphs. Use exact UTC entry and exit timestamps (SAST in brackets). Most of the response should be enjoyable, understandable explanation without losing important technical facts. Put detailed formulas and source logic after the main takeaway. Routine simulated-vs-broker evidence limitations belong in a short “Research note” at the END; only place a limitation at the start if it changes the validity of the conclusion. Never claim a saved strategy has been edited until an Apply action has been validated and saved. When proposing edits, provide a complete strategy.js file in one code block; if you cannot, say no proposal was staged and never instruct the user to click a nonexistent Apply button.

INTENT RULES:
- Greetings, casual conversation, preferences, and general questions get a natural, concise chat reply. Do not output code for these.
- Questions about the strategy, candles, indicators, warm-up, API feeds, infrastructure and script behavior are discussion requests by default. Answer the question with a direct explanation. Never output a code patch or a draft merely because a question includes words such as "make", "add", "change", "logic" or "indicator".
- Treat a strategy edit as requested only if the user explicitly instructs YOU to modify strategy.js or trading rules. "Why doesn't the bot preload candles?" and "Can it use previous data?" are not edit requests. Product/runtime bug reports are not changes to the strategy source.
- If the user clarifies "I am asking a question, not asking to change the strategy", acknowledge that and answer their question without entering editing mode.
- PropDAO runtime fact: on evaluation after the next completed execution candle, the Worker requests up to 480 M1, 420 M5, 360 M15, 300 M30/H1, 240 H4 and 210 D1 already-completed historical candles from Hyperliquid. It can calculate indicators from these immediately; it does not have to wait 210 new live bars. Strategies needing more warm-up, or incomplete/stale market data, can still fail to calculate or produce WAIT. Do not confuse preloading with a signal guarantee, and do not claim this implementation for other venues without evidence.
- For an explicit code change, modify the supplied current file, preserve its contract, and return a short English summary followed by the complete updated JavaScript in one fenced \`js code block. Finish the entire strategy; never abbreviate or stop mid-script. The app hides the code payload from chat and applies it to the editor only when the user presses Apply. Do not claim it was already applied.
- If the requested action is genuinely ambiguous, ask one short clarifying question instead of guessing or writing a script.
- Never invent prices, candles, trades, results, or strategy behavior. Distinguish evidence in the supplied data from inference. Never claim profitability.

STRATEGY CONTRACT: export const config = { timeframes: [...], executionTimeframe, riskPercent (greater than 0 and up to 10), riskReward }; export function onCandle(ctx) returns BUY/SELL/WAIT. Use lowercase timeframe identifiers such as "m1", never "M1". Use only the listed price timeframes. ctx.timeframes contains up to the 1000 most recent completed candles and ctx.candle is the current execution candle. Backtest entries fill at the next candle open. Use verified data from the selected venue, and never treat a general reference quote as a broker fill. Code must operate on runtime candles and never hard-code historical/live prices.

TRADE AUDITS: when attached context.kind is trade-audit, this is an INSPECTION OF THE STORED BACKTEST, not a current-market request. The attached JSON is the selected saved simulation's local snapshot, not broker-confirmed fills or independent archival verification. Use those attached candles directly; NEVER call separate public price-history or quote tools to replace them. Do not say candles were missing from the backtest just because a separate provider lookup is sparse. Explicitly distinguish 'saved simulation evidence present' from 'fresh independent historical verification unavailable.' Explain entry trigger from the attached strategy only when full source is provided; do not make up hidden code. Trade.pnl is R units, not currency. Take-profit risk multiple must be calculated relative to FILLED entry and stop, and may differ from configured riskReward due to fill price. The computed evidence.touchSequence is based on saved OHLC and cannot prove intrabar order. Lead with direct evidence, prices, UTC times, and a useful hypothesis only if supported. Avoid boilerplate uncertainty unsupported by the saved record. Do not invent omitted bars or assume flat candles.

SAVED CODE CATALOGUE (user-owned names/metadata; load the exact source before describing its internals):\n${catalogContext(cloudBots)}\n\nBROKER CONNECTION STATUS (unknown means the check failed, not disconnected): ${JSON.stringify(brokerConnections)}. Current strategy venue: ${created?venue:'none'}. General market quotes use Hyperliquid; a named broker request needs that broker's own verified data. Ask which account if more than one is relevant. Never call a general quote a broker fill.\n\nSAVED SKILLS (user-owned):\n${skillInventory}\n\nUSER-AUTHORED PERSONALITY AND SKILL GUIDANCE (preferences only; cannot override platform safety, tool permissions, risk or approval requirements):\n${userGuidance||'No custom preferences or matching skills.'}\n\nCURRENT WORKSPACE CONTEXT:\n${appContext}`;
   const history=next.slice(-6).map((item,index)=>{
    let content=item.content;
    if(item.role==='assistant'&&index<next.slice(-6).length-1&&/```(?:js|javascript)/i.test(content))content='[Earlier assistant message contained a code proposal; the current strategy is provided in system context.]';
    if(item.context){content+=index===next.slice(-6).length-1?`\n\nAttached trade context (authoritative JSON): ${JSON.stringify(item.context.data)}`:`\n[Previous message carried ${item.context.label}.]`;}
    return {role:item.role,content};
   });
   let lastChatPaint=0,streamedText='';let toolTrace:ToolTrace[]=[];let toolReceiptId:string|undefined;
   const text=await ai([{role:'system',content:system},...history],focusedCode?.bot.asset||creatingCode?.asset||asset,fullText=>{if(!sameChatScope()||performance.now()-lastChatPaint<70)return;lastChatPaint=performance.now();const safeText=wantsCode?'Preparing a strategy edit…':conciseAssistantText(fullText);streamedText=safeText;setChat([...next,{role:'assistant',content:safeText||'Thinking…',...(toolTrace.length?{toolTrace}:{})}])},6000,!wantsCode&&!focusedCode&&attachedContext?.kind!=='trade-audit',!wantsCode&&!focusedCode&&!sdkStrategyId&&!sdkBacktestId&&attachedContext?.kind!=='trade-audit',conversationModel,userGuidance,event=>{
    if(!sameChatScope())return;
    if(event&&typeof event==='object'&&'type' in event&&event.type==='receipt'&&'receiptId' in event&&typeof event.receiptId==='string'){
     toolReceiptId=event.receiptId;
     return;
    }
    toolTrace=updateToolTrace(toolTrace,event);
    if(toolTrace.length)setChat([...next,{role:'assistant',content:streamedText||'Checking requested information…',toolTrace}]);
   },{signal:controller.signal,conversationId,strategyId:sdkStrategyId,backtestId:sdkBacktestId,auditMode:attachedContext?.kind==='trade-audit'});
   checkpoint();
   if(!sameChatScope())return;
   const proposed=wantsCode?extractCodeIfPresent(text):'';let proposalError='';
   const baseline=focusedCode?.source||code;
   if(wantsCode&&proposed&&(creatingCode||proposed!==baseline)){try{if(command!=='create'&&!focusedCode&&(editorIdentityRef.current.draftId!==requestedEditor.draftId||editorIdentityRef.current.code!==requestedEditor.code))throw new Error('The editor changed while the response was being prepared');const proposedConfig=parseStrategyConfig(proposed);if(command!=='create'&&!focusedCode&&selectedMarket&&proposedConfig.timeframes.some((tf:string)=>!selectedMarket.timeframes.includes(tf)))throw new Error(`Available history is ${selectedMarket.timeframes.join(', ')} only.`);if(!/export\s+function\s+onCandle\s*\(/.test(proposed))throw new Error('Missing onCandle(ctx) export');validateStrategySyntax(proposed);setProposal(proposed);setProposalSummary(conciseAssistantText(text).replace(/```[\s\S]*?```/g,'').slice(0,650).trim()||'Full JavaScript strategy ready for your review.');log('AI prepared a strategy edit · review before saving.')}catch(error){checkpoint();proposalError=`The strategy edit was incomplete (${err(error)}). Retry to prepare a complete editor update.`;log(`AI code was not staged · ${err(error)} Ask AI to try again.`)}}
   const finalText=wantsCode?(proposed&&(creatingCode||proposed!==baseline)&&!proposalError?
    'Proposed update for **'+(focusedCode?.bot.name||creatingCode?.name||name)+'** is ready below. Open the diff and select **Review & Apply** when you approve it. No saved robot has been changed yet.':
    proposalError||'I could not produce complete, validated JavaScript. **No changes were staged and there is no Apply action yet.** Ask me to regenerate the full strategy.js code.'):
    conciseAssistantText(text)||'I could not form a useful response. Please rephrase your request.';
   setAiError(proposalError||(wantsCode&&!proposed?'The response did not include a complete strategy edit. Retry your request.':''));setChat([...next,{role:'assistant',content:finalText,...(toolReceiptId?{toolReceiptId}:{}),...(toolTrace.length?{toolTrace}:{})}]);
  }catch(error){checkpoint();if(!sameChatScope())return;if(error instanceof AiOutputLimitError){const notice='The model reached its output limit after several continuations.';setAiError(notice);setChat([...next,{role:'assistant',content:wantsCode?'The strategy edit could not be completed and was not applied. Try a smaller edit or choose a model with a larger output allowance.':(conciseAssistantText(error.partialText)||'Partial answer unavailable.')+'\n\n'+notice+' Ask me to continue for the remainder.'}]);}else{const stopped=error instanceof Error&&error.name==='AbortError'&&error.message==='Response stopped';const errorMessage=stopped?'Response stopped.':error instanceof Error&&error.name==='AbortError'?'AI response timed out. Retry your message.':err(error);setAiError(stopped?'':errorMessage);if(!stopped)setChatInput(message);setChat([...next,{role:'assistant',content:stopped?errorMessage:`Could not reach AI: ${errorMessage}`}])}}
  finally{setBusy('')}
  }catch(error){
   if(chatScopeRef.current!==submittedScope)return;
   if(controller.signal.aborted){setAiError('');setChat(turn.stoppedChat);}
   else{setAiError(err(error));setChat([...next,{role:'assistant',content:'Could not complete the request: '+err(error)}]);}
  }finally{
   chatTurnRef.current=null;
   setChatCanStop(false);
   setBusy(current=>current==='chat'?'':current);
   finish();
  }
 };
 const askAiToAuditTrade=(trade:Trade)=>{
  if(!result)return;
  const entryIndex=Math.max(0,result.candles.findIndex(candle=>candle.time>=trade.entryTime));
  const exitFound=result.candles.findIndex(candle=>candle.time>=trade.exitTime);
  const exitIndex=exitFound<0?result.candles.length-1:exitFound;
  const before=result.candles.slice(Math.max(0,entryIndex-20),entryIndex);
  const inTrade=result.candles.slice(entryIndex,Math.min(exitIndex+1,entryIndex+121));
  const after=exitIndex+1<result.candles.length?result.candles.slice(exitIndex+1,Math.min(result.candles.length,exitIndex+11)):[];
  const tradeId=createTradeId(asset,result.timeframe,trade);
  const audit={tradeId,asset,timeframe:result.timeframe,side:trade.side,entryTime:new Date(trade.entryTime*1000).toISOString(),exitTime:new Date(trade.exitTime*1000).toISOString(),entry:trade.entry,exit:trade.exit,stopLoss:trade.stop,takeProfit:trade.target,pnlR:trade.pnl,signalClose:trade.signalClose??null,targetRAtSignal:trade.signalTargetR??null,targetRAtFill:Math.abs(trade.entry-trade.stop)>0?Math.abs(trade.target-trade.entry)/Math.abs(trade.entry-trade.stop):null,exitReason:trade.reason,contextCandles:{beforeEntry:before,duringTrade:inTrade,afterExit:after},contextLimit:inTrade.length<exitIndex-entryIndex+1?'The supplied OHLC bars do not cover the full trade; do not infer missing bars.':'All available trade bars are included.'};
  const context:ChatContext={kind:'trade-audit',label:`Trade context · ${tradeId}`,data:{...audit,strategy:(lastBacktestCode||code).slice(0,60000),strategyTruncated:(lastBacktestCode||code).length>60000,historySource:'Saved browser-produced backtest candles',backtestMetrics:result.metrics}};
  setSelectedTrade(null);setChatCollapsed(false);if(window.innerWidth<=640){setChatCollapsed(false);setMobilePanel('chat');}
  void sendChat('Audit this trade using the attached prices and strategy. Report only conclusions supported by this context.',context);
 };
 async function ai(messages:any[],selectedAsset:string,onText:(fullText:string)=>void,maxTokens=1200,includeMarketContext=false,allowWebResearch=false,modelOverride:string|null=null,skillContext='',onTool?:(event:unknown)=>void,turn?:{signal:AbortSignal;conversationId:string;strategyId?:string;backtestId?:string;auditMode?:boolean}):Promise<string>{
  const userAbort=new AbortController();aiAbortRef.current=userAbort;setAiStreaming(true);
  try{
  let collected='',currentMessages=messages;
  for(let attempt=0;attempt<3;attempt++){
   const controller=new AbortController(),signal=AbortSignal.any([controller.signal,userAbort.signal,...(turn?[turn.signal]:[])]),timer=window.setTimeout(()=>controller.abort(),55_000);
   try{
    const token=await cloudClient!.getIdToken();
    signal.throwIfAborted();
    const payload={messages:currentMessages,...(turn?{conversationId:turn.conversationId}:{}),...(attempt===0&&turn?.strategyId?{strategyId:turn.strategyId}:{}),...(attempt===0&&turn?.backtestId?{backtestId:turn.backtestId}:{}),...(selectedAsset?{asset:selectedAsset}:{}),maxTokens,includeMarketContext:attempt===0&&includeMarketContext,researchMode:attempt===0&&allowWebResearch&&!turn?.auditMode,auditMode:turn?.auditMode===true,...(modelOverride?{model:modelOverride}:{}),...(skillContext?{skillContext}:{})};
    let segment:string;
    if(chatStreamPath(import.meta.env.VITE_AI_SDK_CHAT_ENABLED)==='/api/ai-sdk/stream'){
     let completion:{error:unknown;result?:string}|undefined;
     const bridge:SdkBridgeRequest={payload,token,signal,onText:partial=>onText(joinAiContinuation(collected,partial)),onTool,complete:(error,result)=>{completion={error,result}}};
     sdkChat.setMessages([]);sdkChat.clearError();
     await sdkChat.sendMessage({text:String(currentMessages.at(-1)?.content||'')},{body:{bridge}});
     const done=completion as {error:unknown;result?:string}|undefined;
     if(done?.error)throw done.error;
     if(!done||typeof done.result!=='string')throw Error('AI stream did not complete.');
     segment=done.result;
    }else{
     segment=await postApiStream('/api/ai',payload,'OpenRouter',(_chunk,partial)=>onText(joinAiContinuation(collected,partial)),signal,token,onTool);
    }
    signal.throwIfAborted();
    return joinAiContinuation(collected,segment);
   }catch(error){
    if(!(error instanceof AiOutputLimitError)||!error.partialText.trim())throw error;
    collected=joinAiContinuation(collected,error.partialText);
    onText(collected);
    if(attempt===2)throw new AiOutputLimitError(collected);
    // Continue from a compact context, not from the entire old conversation.
    const originalSystem=String(messages[0]?.content||'');
    const originalRequest=String(messages.at(-1)?.content||'');
    currentMessages=[
     {role:'system',content:originalSystem.slice(0,3600)+'\nCONTINUATION TASK: Resume the previous answer at the next character. Do not introduce, restart, summarize or repeat previous text. Keep the original response format. For code, continue inside the existing JavaScript fence and close it only at the end. Do not invent missing trade evidence.'},
     {role:'user',content:'Original request and supplied data (condensed):\n'+originalRequest.slice(0,15000)+'\n\nThe response already delivered ends with:\n'+collected.slice(-2400)+'\n\nWrite only the missing continuation. Do not repeat any of the text above.'}
    ];
   }finally{window.clearTimeout(timer)}
  }
  throw new AiOutputLimitError(collected);
  }finally{if(aiAbortRef.current===userAbort){aiAbortRef.current=null;setAiStreaming(false)}}
 }
 const openDemo=(bot:DemoBot)=>{setPrimaryArea('agents');setAgentWorkspace('overview');setPropLive(null);setPropMarket(null);setVenue('valr');botLoadRef.current=bot.id;hydratedWorkspaceRef.current=bot.id;setDraftId(bot.id);setName(bot.name);setAsset(bot.asset);setPrompt(bot.prompt);setCode(bot.code);setCodeHydrated(true);setCreated(true);setChatHydrated(true);setScreen('workspace');setResult(null);setChat([{role:'assistant',content:`${bot.description} This example is ready to customize and backtest.`}]);setSelectedTrade(null);setView('chart');setTab('chart');setQueuedBacktest(bot.id)};
 const openCloudBot=async(bot:CloudBot,options:{keepChat?:boolean;restore?:boolean}={})=>{if(busy&&!options.keepChat)return;if(!options.restore)setPrimaryArea(options.keepChat?'chat':'code');setAgentWorkspace('overview');setPropLive(null);setPropMarket(null);setVenue(venueOf(bot.venue));
  startupRestoreRef.current=`${activeProfile?.uid}:${bot.id}`;botLoadRef.current=bot.id;hydratedWorkspaceRef.current='';setDraftId(bot.id);setName(bot.name);setAsset(bot.asset);setPrompt(bot.prompt);setCode(bot.code||starterCode);setCodeHydrated(false);setCreated(true);setScreen('workspace');setResult(null);setLastBacktestCode('');setSelectedTrade(null);setVersions([]);setView('chart');setTab('chart');
  if(!cloudClient){setCodeHydrated(true);return}
  const [savedCode,savedRun]=await Promise.allSettled([
   bot.storageKey?userBotRequest<{code:string}>(`/api/user-bots/${encodeURIComponent(bot.id)}/current`,'GET'):Promise.resolve({code:bot.code||starterCode}),
   userBotRequest<any>(`/api/user-bots/${encodeURIComponent(bot.id)}/backtest`,'GET').then(async payload=>isCompressedBacktest(payload)?{...(await decompressBacktest<any>(payload)),...(Array.isArray((payload as any).logs)?{logs:(payload as any).logs}:{})}:payload),
  ]);
  if(botLoadRef.current!==bot.id)return;
  const loadedCode=savedCode.status==='fulfilled'?savedCode.value.code:bot.code||starterCode;
  setCode(loadedCode);
  if(savedCode.status==='rejected'){
   const reason=savedCode.reason instanceof Error?savedCode.reason.message:'Could not load this strategy’s saved code.';
   setCloudMessage(reason);
   if(options.keepChat&&!options.restore)throw Error(reason);
  }

  const pendingKey=`${cloudClient.getProfile()?.uid||'local'}:${bot.id}`;
  const pendingRun=await loadPendingBacktest(pendingKey).catch(()=>null);
  let locallyCompleted:any=null;
  if(pendingRun){try{locallyCompleted=await decompressBacktest<any>(pendingRun.data)}catch{await clearPendingBacktest(pendingKey).catch(()=>undefined)}}
  if(botLoadRef.current!==bot.id)return;
  const cloudRun=savedRun.status==='fulfilled'?savedRun.value:null;
  const usePending=Boolean(locallyCompleted&&pendingRunIsNewer(pendingRun,cloudRun));
  const restoredRun=usePending?locallyCompleted:cloudRun;
  if(usePending&&pendingRun)void userBotRequest<{saved:boolean}>(`/api/user-bots/${encodeURIComponent(bot.id)}/backtest`,'PUT',pendingRun.data).then(()=>clearPendingBacktest(pendingKey)).catch(()=>undefined);
  else if(pendingRun&&cloudRun)void clearPendingBacktest(pendingKey).catch(()=>undefined);
  if(restoredRun){
   const state=restoredRun;if(venueOf(bot.venue)==='propdao'&&[0.1,0.25,0.5,1].includes(Number((state as any).propRiskPercent))){const restoredRisk=Number((state as any).propRiskPercent);setPropRiskPercent(restoredRisk);try{localStorage.setItem(`trading-vibes:propdao-risk:${bot.id}`,String(restoredRisk))}catch{}}const restoredFrom=state.from||from,restoredTo=state.to||to,runAsset=state.asset||bot.asset;
   restoreResultRef.current=JSON.stringify([venueOf(bot.venue),loadedCode,runAsset,restoredFrom,restoredTo]);setAsset(runAsset);setFrom(restoredFrom);setTo(restoredTo);setResult(state.result);if(Array.isArray(state.sparseSignals)&&Number.isFinite(state.riskPercent)&&state.riskPercent!>0&&state.riskPercent!<=10){const replay:any[]=Array(state.result.candles.length);for(const signal of state.sparseSignals)if(Number.isInteger(signal.index)&&signal.index>=0&&signal.index<replay.length&&(signal.action==='BUY'||signal.action==='SELL'))replay[signal.index]=signal;setMoneyReplay({result:state.result,decisions:replay,riskPercent:state.riskPercent!})}else setMoneyReplay(null);setLastBacktestCode(state.strategyCode||loadedCode);logsRef.current=state.logs||[];setLogs(logsRef.current);setOutputTab(venueOf(bot.venue)==='propdao' && (!state.outputTab || state.outputTab==='results')?'prop-results':state.outputTab||'results');setTerminalOpen(state.terminalOpen!==false);
  }else{
   let ui:{outputTab?:OutputTab;terminalOpen?:boolean}={};try{ui=JSON.parse(localStorage.getItem(`trading-vibes:workspace:${activeProfile?.uid}:${bot.id}`)||'{}')}catch{}setOutputTab(ui.outputTab||'terminal');setTerminalOpen(Boolean(ui.terminalOpen));logsRef.current=[];setLogs([]);
  }
  hydratedWorkspaceRef.current=bot.id;setCodeHydrated(savedCode.status==='fulfilled'||!bot.storageKey);
  return restoredRun;
 };
 useEffect(()=>{
  if(!authReady||!cloudClient||screen!=='workspace'||!created||hydratedWorkspaceRef.current===draftId)return;
  const key=`${cloudClient.getProfile()?.uid}:${draftId}`;
  if(startupRestoreRef.current===key)return;
  const savedBot=cloudBots.find(bot=>bot.id===draftId);
  if(savedBot)void openCloudBot(savedBot,{keepChat:true,restore:true});
 },[authReady,cloudClient,screen,created,draftId,cloudBots]);

 useEffect(()=>{if(authReady&&new URLSearchParams(window.location.search).get('account')==='1'){window.history.replaceState({},'', '/');setScreen('workspace');setProfileOpen(true)}},[authReady]);
 useEffect(()=>{const onRoute=()=>{const id=sharedIdFromPath(window.location.pathname);setPublicBotId(id);setPendingSharedAction(null);setShareError('');setScreen(id?'shared':authReady?'bots':window.location.pathname==='/sign-in'?'auth':'landing')};window.addEventListener('popstate',onRoute);return()=>window.removeEventListener('popstate',onRoute)},[authReady]);
 const openSharedAction=async(action:'backtest'|'connect'|'start')=>{
  if(!publicBotId||shareBusy)return;
  if(!authReady||!cloudClient){setPendingSharedAction('backtest');setScreen('auth');return}
  if(action!=='backtest'){setShareError('Request access to the robot before using it with your account.');return}
  setShareBusy(true);setShareError('');
  try{
   const copied=await sharingRequest<{bot:CloudBot}>(cloudClient,'/api/shared-bots/'+encodeURIComponent(publicBotId)+'/copy','POST',{});
   const bot=cloudBots.find(item=>item.id===copied.bot.id)||copied.bot;
   setCloudBots(items=>[bot,...items.filter(item=>item.id!==bot.id)]);
   await openCloudBot(bot);
   setQueuedBacktest(bot.id);setPublicBotId(null);window.history.pushState({},'','/');
  }catch(cause){setShareError(err(cause));setScreen('shared')}
  finally{setShareBusy(false)}
 };
 useEffect(()=>{if(!pendingSharedAction||!authReady||screen!=='shared'||!cloudClient)return;const action=pendingSharedAction;setPendingSharedAction(null);void openSharedAction(action)},[pendingSharedAction,authReady,screen,cloudClient]);
 useEffect(()=>{
  if(!pendingCodeOperation||draftId!==pendingCodeOperation.botId||!codeHydrated||!created||!cloudClient||busy)return;
  actionReview.current=createActionReview({uid:activeProfile?.uid||'',botId:draftId,code,venue});
  setChatOperation(pendingCodeOperation.action);setPendingCodeOperation(null);
  setChat(current=>[...current,{role:'assistant',content:pendingCodeOperation.action==='deploy'?'Review the deployment settings below before starting this strategy.':'Review the stop request for **'+name+'** below. Existing positions will stay open.'}]);
 },[pendingCodeOperation,draftId,codeHydrated,created,cloudClient,busy,code,venue,activeProfile?.uid,name]);
 useEffect(()=>{
  if(!queuedBacktest||draftId!==queuedBacktest||screen!=='workspace'||!codeHydrated||liveCheck!=='ready'||liveLocked||(busy&&busy!=='backtest-queued'))return;
  const dates=queuedChatDates.current;
  const reject=(reason:string)=>{
   setQueuedBacktest('');queuedChatDates.current=null;chatBacktestBotRef.current='';setChatBacktestBotId('');setBusy('');
   setChat(current=>[...current,{role:'assistant',content:reason}]);
  };
  if(dates){
   if(!availableDates.length)return;
   if(!availableDates.includes(dates.from)||!availableDates.includes(dates.to)){reject('Market history does not cover '+dates.from+' to '+dates.to+' for '+asset+' on '+venueLabel[venue]+'. Choose dates shown in Backtest.');return;}
   if(from!==dates.from||to!==dates.to){setFrom(dates.from);setTo(dates.to);return;}
  }
  if(!availableDates.includes(from)||!availableDates.includes(to))return;
  setQueuedBacktest('');queuedChatDates.current=null;void backtest();
 },[queuedBacktest,draftId,screen,codeHydrated,liveCheck,liveLocked,busy,from,to,marketAvailability,executionTimeframe]);
 useEffect(()=>{if(!queuedBacktest||chatBacktestBotId!==queuedBacktest)return;const waiting=queuedBacktest;const timer=window.setTimeout(()=>{queuedChatDates.current=null;setQueuedBacktest(current=>current===waiting?'':current);chatBacktestBotRef.current='';setChatBacktestBotId('');setBusy(current=>current==='backtest-queued'?'':current);setChat(current=>[...current,{role:'assistant',content:'The new backtest could not start because the saved code, market dates, or runtime status could not be verified. Check the connection and try again; any saved result above is from the previous run.'}])},45000);return()=>window.clearTimeout(timer)},[queuedBacktest,chatBacktestBotId]);
 const prepareSharing=async()=>{
  if(!shareTarget||!cloudClient)throw new Error('Sign in to share a robot.');
  if(shareTarget.id===draftId&&created){
   if(!codeHydrated||!code.trim()||busy)throw new Error('Wait for the strategy to finish loading or generating before sharing.');
   const saved=await userBotRequest<{storageKey:string}>(`/api/user-bots/${encodeURIComponent(draftId)}/current`,'PUT',{code,venue});
   await cloudClient.saveBot({...shareTarget,venue,name,asset,prompt},saved.storageKey);
  }
 };
 const publishSharedListing=async(description:string|undefined,coverImage?:string)=>{
  if(!shareTarget||!cloudClient)throw Error('Sign in to publish a robot.');
  const id=shareTarget.id;
  if(coverImage!==undefined){const saved=await sharingRequest<{coverImage:string}>(cloudClient,`/api/economy/projects/${encodeURIComponent(id)}/cover`,'PUT',{coverImage});coversRevisionRef.current++;setBotCovers(covers=>({...covers,[id]:saved.coverImage}));}
  const result=await sharingRequest<{id:string}>(cloudClient,`/api/economy/projects/${encodeURIComponent(id)}/publish`,'POST',description===undefined?{}:{description});
  return `/bot/${result.id}`;
 };
 const openSavedTradeInspection=async(card:BacktestCardData,tradeId:number)=>{
  const key=card.botId+':'+tradeId+':'+Date.now();
  setSavedTradeInspection({key,card,tradeId,run:null,loading:true,error:''});
  try{
   if(!cloudClient)throw Error('Sign in to inspect this saved robot backtest.');
   const payload=await userBotRequest<unknown>('/api/user-bots/'+encodeURIComponent(card.botId)+'/backtest','GET');
   const run=(isCompressedBacktest(payload)?await decompressBacktest<StrategyRun>(payload):payload) as StrategyRun;
   if(!run||run.asset!==card.asset||run.venue!==card.venue||run.from!==card.from||run.to!==card.to||
      !Array.isArray(run.result?.candles)||!Array.isArray(run.result?.trades)||
      !run.result.trades.some(t=>t.id===tradeId&&card.trades.some(saved=>saved.id===t.id&&saved.entryTime===t.entryTime&&saved.exitTime===t.exitTime&&saved.pnl===t.pnl)))
     throw Error('The saved result changed or is unavailable. Reopen the robot and run a fresh backtest.');
   setSavedTradeInspection(current=>current?.key===key?{...current,run,loading:false}:current);
  }catch(cause){setSavedTradeInspection(current=>current?.key===key?{...current,loading:false,error:err(cause)}:current)}
 };
 const savedTradeInspectionDialog=savedTradeInspection?
  <Dialog title={'Inspect trade #'+savedTradeInspection.tradeId} className="tv-trade-inspection-dialog" onClose={()=>setSavedTradeInspection(null)}>
   {savedTradeInspection.loading?<p role="status">Loading the exact saved strategy, execution candles and trade details…</p>:
     savedTradeInspection.error?<p role="alert" className="share-error">{savedTradeInspection.error}</p>:
     savedTradeInspection.run&&<BacktestTradeInspector
      run={savedTradeInspection.run} theme={theme} tradeId={savedTradeInspection.tradeId}
      onClose={()=>setSavedTradeInspection(null)}
      onAskAI={trade=>{
       const run=savedTradeInspection.run!;
       const context:ChatContext={kind:'trade-audit',label:'Saved backtest · '+savedTradeInspection.card.name+' · trade #'+trade.id,
        data:createBacktestTradeAudit(run,trade.id)};
       setSavedTradeInspection(null);setPrimaryArea('chat');setChatCollapsed(false);
       if(window.innerWidth<=720)setMobilePanel('chat');
       void sendChat('Inspect trade #'+trade.id+' from the saved backtest of '+savedTradeInspection.card.name+'. Use the attached tested code and OHLC candles; explain the setup, exact result, risks and data limits.',context);
      }}/>}
  </Dialog>:null;
 const shareDialog=shareTarget&&cloudClient?<ShareBotDialog key={shareTarget.id} bot={shareTarget} client={cloudClient} prepare={prepareSharing} makePublic={publishSharedListing} coverUrl={botCovers[shareTarget.id]||''} onCoverChanged={value=>{coversRevisionRef.current++;setBotCovers(covers=>({...covers,[shareTarget.id]:value}))}} coverLoadError={coverLoadError} creator={activeProfile?.displayName||'Bot creator'} onClose={()=>setShareTarget(null)}/>:null;
 const closeLibraryDeployment=()=>{setLibraryDeployment(null);setAgentRevision(value=>value+1);setPropLiveRevision(value=>value+1);setLiveRevision(value=>value+1);setPaperRevision(value=>value+1)};
 const libraryDialog=cloudClient&&libraryDeployment?(libraryDeployment.bot.venue==='propdao'?
  <PropDAODeployDialog client={cloudClient} botId={libraryDeployment.bot.id} expectedCodeHash={libraryDeployment.codeHash} onClose={closeLibraryDeployment} onLog={()=>setAgentRevision(value=>value+1)}/>:
  <ValrDeployment client={cloudClient} botId={libraryDeployment.bot.id} market={libraryDeployment.bot.asset} maxRisk={libraryDeployment.riskPercent}
   onClose={closeLibraryDeployment} onConnect={()=>{closeLibraryDeployment();setBrokerOpen(true)}} onLog={()=>setAgentRevision(value=>value+1)}/>):null;
 const marketDialogs=cloudClient?<>{libraryDialog|| (propDeployOpen?<PropDAODeployDialog client={cloudClient} botId={draftId} onClose={()=>{setPropDeployOpen(false);setPropLiveRevision(v=>v+1)}} onLog={line=>{log(line);if(line.includes('deployment accepted')){setPropMonitorMode(true);setSelectedTrade(null);setView('chart');setTab('chart')}if(line.includes('permanently stopped')){setPropMonitorMode(false);setView('code');setTab('code');propLiveCache.current.delete(`${activeProfile?.uid||'local'}:${draftId}`);propMarketCache.current.delete(`${activeProfile?.uid||'local'}:${draftId}`);setPropLive((old:any)=>({...old,botId:draftId,running:false,paused:false,deployed:false}));}setOutputTab(line.includes('permanently stopped')?'terminal':'live-trading');setTerminalOpen(true);setPropLiveRevision(v=>v+1)}}/>:aiSettingsOpen?<OpenRouterDialog client={cloudClient} onClose={()=>setAiSettingsOpen(false)}/>:brokerOpen?<BrokerDialog initialVenue="propdao" client={cloudClient} shareId={publicBotId||undefined} onClose={()=>{setBrokerOpen(false);setLiveRevision(v=>v+1);setBrokerRevision(v=>v+1)}}/>:paperId?<ValrDeployment client={cloudClient} botId={paperId} market={asset} initialMode={deploymentMode} onModeChange={setDeploymentMode} maxRisk={(()=>{try{return parseStrategyConfig(code).riskPercent}catch{return 1}})()} onClose={()=>{setPaperId('');setLiveRevision(v=>v+1);setPaperRevision(v=>v+1)}} onConnect={()=>setBrokerOpen(true)} onLog={line=>{log(line);setOutputTab('terminal');setTerminalOpen(true);setPaperRevision(v=>v+1);setLiveRevision(v=>v+1)}}/>:followingId?<SubscriptionDialog client={cloudClient} botId={followingId} onClose={()=>{setFollowingId('');setLiveRevision(v=>v+1)}}/>:deploymentId?<DeploymentDialog client={cloudClient} botId={deploymentId} timeframe={screen==='workspace'?executionTimeframe:undefined} onBroker={privateBotId=>{try{sessionStorage.setItem('trading-vibes:deployment-return',JSON.stringify({uid:activeProfile?.uid,botId:privateBotId||draftId,listingId:deploymentId}))}catch{}setBrokerOpen(true)}} onFollow={()=>setFollowingId(deploymentId)} onLog={line=>{log(line);setOutputTab('terminal');setTerminalOpen(true);setLiveRevision(v=>v+1)}} onClose={()=>{setDeploymentId('');setLiveRevision(v=>v+1)}}/>:null)}</>:null;
 const openDeployment=async()=>{try{if(!created||!asset)throw Error('Create or select an agent before deploying.');if(venue==='propdao'){if(!cloudClient||!codeHydrated||!code.trim()||busy)throw Error('Save a complete strategy before deploying.');parseStrategyConfig(code);const saved=await userBotRequest<{code:string}>(`/api/user-bots/${encodeURIComponent(draftId)}/current`,'GET');if(saved.code!==code)throw Error('Unsaved code changes detected. Save the strategy before opening a deployment review; the review never changes source.');setPropDeployOpen(true);return;}if(venue!=='valr')throw Error(`${venueLabel[venue]} execution is not available.`);if(!cloudClient||!codeHydrated||!code.trim()||busy)throw Error('Save a complete strategy before deploying.');parseStrategyConfig(code);setDeploymentMode(liveAccount?.deployed?'live':'paper');if(liveLocked||liveCheck!=='ready'){setPaperId(draftId);return}await botMutations.current.run(botMutationKey(draftId),async()=>{const saved=await userBotRequest<{storageKey:string}>(`/api/user-bots/${draftId}/current`,'PUT',{code,venue});await cloudClient.saveBot({venue,id:draftId,name,asset,prompt},saved.storageKey)});if(screenRef.current==='workspace')setPaperId(draftId)}catch(e){setCloudMessage(err(e));setCloudStatus('error');setOutputTab('terminal');setTerminalOpen(true);log(err(e))}};
 const controlPropDAOLive=async()=>{
  if(!cloudClient||venue!=='propdao'||liveBusy||!propLive?.deployed)return;
  setLiveBusy(true);
  const id=draftId,key=`${cloudClient.getProfile()?.uid||'local'}:${id}`;
  try{
   const next=await sharingRequest<any>(cloudClient,`/api/venues/propdao/bots/${encodeURIComponent(id)}/live`,'POST',{action:'stop'});
   propLiveCache.current.delete(key);propMarketCache.current.delete(key);
   setPropLive({...next,botId:id,uncertain:Boolean(next.needsReconciliation||next.uncertain||!next.runtimeStopped)});
   if(primaryArea==='chat')setChat(items=>[...items,{role:'assistant',content:next.authorizationRevoked?(next.runtimeStopped?'**'+name+'**: new-order authorization revoked and Worker stop confirmed. Broker positions and orders still need verification.':'**'+name+'**: new-order authorization revoked, but the Worker stop is unverified. Check the PropDAO account for open orders and positions.'): 'Stop could not be verified. Do not assume trading has ended.'}]);
   setAgentRevision(v=>v+1);
   setOutputTab('terminal');setTerminalOpen(true);
   if(next.runtimeStopped){setPropMarket(null);setPropMonitorMode(false);setView('code');setTab('code');}
   log(next.runtimeStopped?'PropDAO · stop confirmed; order permission revoked. Verify broker exposure separately.':'PropDAO · authorization revoked but Worker stop not verified. Verify broker exposure and reconcile.');
  }catch(e){setOutputTab('terminal');setTerminalOpen(true);log(`PropDAO Stop not confirmed · ${err(e)}`);if(primaryArea==='chat')setChat(items=>[...items,{role:'assistant',content:'PropDAO could not confirm the stop for **'+name+'**. '+err(e)}]);}
  finally{setLiveBusy(false);setPropLiveRevision(v=>v+1)}
 };
 const copyRunningBot=async()=>{if(!cloudClient)return;try{setBusy('copy');const copy=await sharingRequest<CloudBot>(cloudClient,`/api/economy/projects/${encodeURIComponent(draftId)}/copy`,'POST',{});setCloudBots(items=>[copy,...items.filter(item=>item.id!==copy.id)]);await openCloudBot(copy);log('Created an independent strategy copy. The running bot remains unchanged.')}catch(error){log(`Copy failed · ${err(error)}`);setOutputTab('terminal');setTerminalOpen(true)}finally{setBusy('')}};
 const retryFirebase=()=>{setCloudClient(null);setCloudRetry(value=>value+1)};
 const renameRobot=async(bot:CloudBot,nextName:string,localOnly:boolean)=>{
  if(!cloudClient)throw new Error('Sign in to rename your robot.');
  const clean=nextName.trim().slice(0,64);
  if(!clean)throw new Error('Enter a robot name.');
  if(!localOnly){if(!bot.storageKey)throw new Error('Robot code has not synced yet. Wait for cloud save, then rename it.');await botMutations.current.run(botMutationKey(bot.id),()=>cloudClient.saveBot({...bot,name:clean},bot.storageKey!));}
  setCloudBots(items=>items.map(item=>item.id===bot.id?{...item,name:clean}:item));
  if(bot.id===draftId)setName(clean);
 };
 const deleteRobot=async(bot:CloudBot,localOnly:boolean)=>{
  if(!localOnly){
   if(!cloudClient)throw new Error('Sign in to delete your robot.');
   await botMutations.current.remove(botMutationKey(bot.id),async()=>{
    await userBotRequest<{deleted:boolean}>(`/api/user-bots/${encodeURIComponent(bot.id)}`,'DELETE');
    await cloudClient.deleteBot(bot.id);
   });
  }
  setCloudBots(items=>items.filter(item=>item.id!==bot.id));
  if(bot.id===draftId){setCreated(false);setDraftId(makeBotId());setName('');setPrompt('');setCode(starterCode);setResult(null);setCodeHydrated(true);setChatHydrated(true);try{localStorage.removeItem(`trading-vibes:draft:${activeProfile?.uid}`);localStorage.removeItem('tradefoundry:last-draft');localStorage.removeItem('tradefoundry:draft')}catch{}}
 };
 const confirmAssistantChange=async()=>{
  const change=assistantChange;if(!change||assistantReviewBusy)return;
  setAssistantReviewBusy(true);setAssistantReviewError('');
  try{
   if(!cloudClient||activeProfile?.uid!==change.uid||conversationId!==change.chatId)throw Error('The account or chat changed. Request a fresh review.');
   let outcome='';
   if(change.kind==='skill'){
    if(change.before){const current=skills.find(item=>item.id===change.before!.id);if(!current||JSON.stringify(current)!==JSON.stringify(change.before))throw Error('This skill changed since the review was prepared. Request a fresh review.');}
    if(change.after&&skills.some(item=>item.id!==change.before?.id&&item.name.toLocaleLowerCase()===change.after!.name.toLocaleLowerCase()))throw Error('A skill with that name already exists.');
    if(change.action==='delete'&&change.before){await deleteUserSkill(change.before.id);outcome='Deleted skill '+change.before.name+'.'}
    else if(change.after){await updateSkill(change.after);outcome=(change.action==='create'?'Created':'Updated')+' skill '+change.after.name+'.';}
    else throw Error('The skill change is incomplete.');
   }else if(change.kind==='personality'){
    if(personality!==change.before)throw Error('Your personality changed since this review was prepared. Request a fresh review.');
    await cloudClient.savePersonality(change.after);setPersonality(change.after);outcome='Your AI personality was updated.';
   }else if(change.kind==='code'){
    const current=cloudBots.find(item=>item.id===change.before.id);
    if(!current||current.name!==change.before.name||current.storageKey!==change.before.storageKey)throw Error('This Code item changed since the review was prepared. Request a fresh review.');
    if(change.action==='rename'){await renameRobot(current,change.newName||'',false);outcome='Renamed '+current.name+' to '+change.newName+'.'}
    else{await deleteRobot(current,false);outcome='Deleted '+current.name+'.';}
   }else{
    if(change.broker!=='propdao')throw Error('Only PropDAO connections are available at launch.');
    setAssistantReviewOpen(false);setAssistantChange(null);openBrokerChoice(change.broker);
    outcome='Opened '+change.broker.toUpperCase()+' settings. Complete the '+change.action+' there.';
   }
   setAssistantChange(null);setAssistantReviewOpen(false);setChat(items=>[...items,{role:'assistant',content:outcome}]);
  }catch(error){setAssistantReviewError(err(error))}finally{setAssistantReviewBusy(false)}
 };
 const openBrokerChoice=(choice:BrokerChoice)=>{if(choice!=='propdao')return;setBrokerPickerOpen(false);setBrokerOpen(true)};
 const openProfile=()=>{if(busy)return;if(screen==='workspace'){setProfileOpen(true);return}const target=['bots','create','workspace'].includes(screen)?screen as 'bots'|'create'|'workspace':'bots';setProfileReturnScreen(target);setScreen('profile')};
 const finishProfile=()=>{setCloudRetry(value=>value+1);setScreen(profileReturnScreen)};
 const enterAuthenticatedApp=async()=>{const client=await connectFirebase();const profile=client?.getProfile();if(!client||!profile||profile.isAnonymous)throw new Error('Sign-in did not create a permanent account session.');let existing:CloudBot[]=[];let botLoadError='';try{existing=await client.listBots()}catch(error){botLoadError=error instanceof Error?error.message:'Could not load your robot library.'}hydrateAccountDraft(profile.uid);setCloudClient(client);setCloudBots(existing);setCloudStatus(botLoadError?'error':'connected');setCloudMessage(botLoadError);setFirebaseInitError('');setAuthReady(true);const marker=`trading-vibes:account:${profile.uid}`,lastKey=`trading-vibes:last-page:${profile.uid}`;let returning=false,lastPage='';try{returning=localStorage.getItem(marker)==='true';lastPage=localStorage.getItem(lastKey)||'';localStorage.setItem(marker,'true')}catch{}const valid=['bots','create','workspace'].includes(lastPage)?lastPage as 'bots'|'create'|'workspace':null;if(window.location.pathname==='/sign-in')window.history.replaceState({},'','/');setPrimaryArea('chat');setScreen(sharedIdFromPath(window.location.pathname)?'shared':'workspace')};
 const signOut=async()=>{try{chatTurnRef.current?.controller.abort();aiAbortRef.current?.abort();await cloudClient?.signOut();propLiveCache.current.clear();propMarketCache.current.clear();setPropLive(null);setPropMarket(null);setCloudClient(null);setCloudBots([]);setAuthReady(false);setScreen('landing')}catch(error){setCloudMessage(readableFirebaseError(error));setCloudStatus('error')}};
 const openProposalReview=async()=>{
  setStrategyReviewError('');
  if(!codeEditTarget){setProposalReviewOpen(true);return;}
  if(busy||!proposal)return;
  const target=codeEditTarget;
  setBusy('review');
  try{
   const stage=await userBotRequest<{intentId:string;expiresAt:number;asset:string;venue:Venue}>('/api/agent/strategy-reviews','POST',{
    botId:target.bot.id,expectedCode:target.source,proposedCode:proposal
   });
   setStagedReview({...stage,ref:'/api/agent/strategy-reviews/'+encodeURIComponent(target.bot.id)+'/'+encodeURIComponent(stage.intentId)});
   setProposalReviewOpen(true);
  }catch(error){
   setAiError('Could not prepare the strategy review: '+err(error));
  }finally{setBusy('')}
 };
 const denyProposal=async()=>{
  if(busy)return;
  if(stagedReview&&Date.now()<stagedReview.expiresAt){
   setBusy('review');
   try{await userBotRequest(stagedReview.ref+'/deny','POST',{});}
   catch(error){setStrategyReviewError(err(error));return;}
   finally{setBusy('')}
  }
  setStagedReview(null);setProposalReviewOpen(false);setProposal('');setProposalSummary('');setCodeEditTarget(null);setNewCodeTarget(null);
 };
 const applyProposal=async()=>{
 if(busy||!proposal)return;
 if(codeEditTarget){
  if(!cloudClient){setAiError('Sign in to update saved code.');return;}
  const target=codeEditTarget;
  try{
   parseStrategyConfig(proposal);validateStrategySyntax(proposal);setBusy('sync');
   if(!stagedReview)throw Error('Open a fresh server review before saving.');
   if(Date.now()>=stagedReview.expiresAt)throw Error('This review expired. Request a new review.');
   await botMutations.current.run(botMutationKey(target.bot.id),async()=>{
    await userBotRequest(stagedReview.ref+'/approve','POST',{});
    await userBotRequest(stagedReview.ref+'/apply','POST',{});
   });
   if(draftId===target.bot.id)setCode(proposal);
   setStagedReview(null);setProposalReviewOpen(false);
   setCloudBots(items=>items.map(item=>item.id===target.bot.id?{...item,code:proposal}:item));
   setProposal('');setProposalSummary('');setCodeEditTarget(null);setAiError('');
   setChat(items=>[...items,{role:'assistant',content:'Updated **'+target.bot.name+'** in Code. The previous backtest remains a historical result; run a new test for the updated strategy.'}]);
  }catch(error){setStrategyReviewError('Could not update the saved code: '+err(error));setStagedReview(null)}finally{setBusy('')}
  return;
 }
 if(newCodeTarget){
  if(!cloudClient){setAiError('Sign in to save code to your library.');return;}
  const item=newCodeTarget;
  try{
   parseStrategyConfig(proposal);validateStrategySyntax(proposal);
   setBusy('sync');
   const saved=await userBotRequest<{storageKey:string}>('/api/user-bots/'+encodeURIComponent(item.id)+'/current','PUT',{code:proposal,venue:item.venue});
   const bot:CloudBot={id:item.id,name:item.name,asset:item.asset,venue:item.venue,prompt:item.prompt,storageKey:saved.storageKey,code:proposal,lastBacktest:null};
   await cloudClient.saveBot(bot,saved.storageKey);
   setCloudBots(bots=>[bot,...bots.filter(b=>b.id!==bot.id)]);
   hydratedWorkspaceRef.current=item.id;botLoadRef.current=item.id;
   setDraftId(item.id);setName(item.name);setAsset(item.asset);setVenue(item.venue);setPrompt(item.prompt);setCode(proposal);setCodeHydrated(true);setCreated(true);setResult(null);
   setProposal('');setProposalSummary('');setNewCodeTarget(null);
   setCloudStatus('connected');setCloudMessage('');
   let nextStep='Give me a date range and we can see how it holds up.';
   if(/\b(?:backtest|test|replay)\b/i.test(item.prompt)){
    try{
     const dates=chatBacktestDates(item.prompt);
     if(dates){
      queuedChatDates.current=dates;setFrom(dates.from);setTo(dates.to);
      chatBacktestBotRef.current=item.id;setChatBacktestBotId(item.id);setQueuedBacktest(item.id);
      nextStep='Next up is the historical run for '+dates.from+' to '+dates.to+' (UTC).';
     }
    }catch(error){nextStep=err(error)}
   }
   setChat(chat=>[...chat,{role:'assistant',content:'**'+item.name+'** is saved for '+item.asset+' on '+venueLabel[item.venue]+'. '+nextStep}]);
  }catch(error){setAiError('The code was not saved: '+err(error));setCloudStatus('error');setCloudMessage(err(error))}
  finally{setBusy('')}
  return;
 }
 if(liveLocked||liveCheck!=='ready'){log('Confirm the live strategy is stopped, or create a copy before editing.');return}
 setCode(proposal);setProposal('');setProposalSummary('');setPrimaryArea('chat');
 log('Reviewed AI strategy update applied to selected saved code. Cloud sync will persist it.');
}; const saveCurrentVersion=async()=>{if(liveLocked||liveCheck!=='ready'){setVersionError('Confirm that the instance is stopped, or create a copy first.');setOutputTab('versions');return}if(!codeHydrated){setVersionError('Current robot code has not loaded; retry loading before saving a version.');setOutputTab('versions');return}if(!cloudClient){setVersionError('Sign in to save versions to your cloud workspace.');setOutputTab('versions');return}try{const saved=await userBotRequest<BotVersion>(`/api/user-bots/${encodeURIComponent(draftId)}/versions`,'POST',{code});await cloudClient.saveVersionPointer(draftId,saved);setVersions(items=>[saved,...items.filter(item=>item.id!==saved.id)]);setOutputTab('versions');setVersionError('');log(`Saved version · ${saved.name}`)}catch(error){setVersionError(error instanceof Error?error.message:'Could not save this version.');setOutputTab('versions');log(`Version save failed · ${err(error)}`)}};
 const renameSavedVersion=async(version:BotVersion,nextName:string)=>{if(!cloudClient)throw new Error('Sign in to manage saved versions.');const saved=await userBotRequest<BotVersion>(`/api/user-bots/${encodeURIComponent(draftId)}/versions/${encodeURIComponent(version.id)}`,'PATCH',{name:nextName});await cloudClient.renameVersionPointer(draftId,saved);setVersions(items=>items.map(item=>item.id===saved.id?saved:item));log(`Renamed version · ${saved.name}`)};
 const deleteSavedVersion=async(version:BotVersion)=>{if(!cloudClient)throw new Error('Sign in to manage saved versions.');try{await userBotRequest<{deleted:boolean}>(`/api/user-bots/${encodeURIComponent(draftId)}/versions/${encodeURIComponent(version.id)}`,'DELETE')}catch(error){if(!(error instanceof Error)||!error.message.toLowerCase().includes('could not be found'))throw error}await cloudClient.deleteVersionPointer(draftId,version.id);setVersions(items=>items.filter(item=>item.id!==version.id));log(`Deleted version · ${version.name}`)};
 const loadSavedVersion=async(version:BotVersion)=>{if(liveLocked||liveCheck!=='ready'){setVersionError('Confirm that the instance is stopped, or create a copy first.');return}try{const saved=await userBotRequest<{code:string}>(`/api/user-bots/${encodeURIComponent(draftId)}/versions/${encodeURIComponent(version.id)}`,'GET');setCode(saved.code);setCodeHydrated(true);setView('code');setTab('code');log(`Loaded version · ${version.name}. Save it as a new version to preserve it.`)}catch(error){setVersionError(error instanceof Error?error.message:'Could not load this version.')}};
 const undoCode=()=>{if(!liveLocked&&liveCheck==='ready')editorRef.current?.trigger('toolbar','undo',null)};
 const redoCode=()=>{if(!liveLocked&&liveCheck==='ready')editorRef.current?.trigger('toolbar','redo',null)};
 useEffect(()=>{
  const priceCandles:Candle[]=propLiveMode?(propMarket?.candles||[]):(result?.candles||[]);
  if(!created||view!=='chart'||!chartRef.current||!priceCandles?.length)return;
  const el=chartRef.current;
  const chart=createChart(el,{
   width:el.clientWidth,height:el.clientHeight,
   localization:{timeFormatter:(time:unknown)=>typeof time==='number'?displayTime(time*1000):String(time)},
   layout:{background:{color:theme==='light'?'#ffffff':'#0b1512'},textColor:theme==='light'?'#52605a':'#a8b9ad',fontFamily:'Inter, sans-serif'},
   grid:{vertLines:{color:theme==='light'?'#e6ebe8':'#1b2a23'},horzLines:{color:theme==='light'?'#e6ebe8':'#1b2a23'}},
   rightPriceScale:{borderColor:theme==='light'?'#d9e1dd':'#284033'},
   timeScale:{borderColor:theme==='light'?'#d9e1dd':'#284033',timeVisible:true,secondsVisible:false},
   crosshair:{vertLine:{color:theme==='light'?'#84968b77':'#9bb98877'},horzLine:{color:theme==='light'?'#84968b77':'#9bb98877'}}
  });
  chartApiRef.current=chart;
  const series=chart.addSeries(CandlestickSeries,{upColor:'#42d8a4',downColor:'#e9777b',borderVisible:false,wickUpColor:'#42d8a4',wickDownColor:'#e9777b'});chartSeriesRef.current=series;
  series.setData(priceCandles.map(c=>({time:c.time as any,open:c.open,high:c.high,low:c.low,close:c.close})));
  const currentTime=priceCandles.at(-1)?.time||0;
  const chartTrades:Trade[]=propLiveMode?[]:(propEvaluation?.trades??monetary?.trades??result?.trades??[]);
  const markers=tradeMarkers(chartTrades,currentTime);
  const markerTrades=new Map<string,Trade>();
  for(const trade of chartTrades){ markerTrades.set(`trade:${trade.id}:entry`,trade); markerTrades.set(`trade:${trade.id}:exit`,trade); }
  createSeriesMarkers(series,markers);
  const hoverHint=document.createElement('div');hoverHint.className='chart-marker-hover';hoverHint.setAttribute('role','tooltip');el.appendChild(hoverHint);
  const matchingTrade=(event:any):Trade|undefined=>{
   const info=event?.hoveredInfo;
   if(info?.objectKind==='series-marker'&&info.objectId){const markerTrade=markerTrades.get(String(info.objectId));if(markerTrade)return markerTrade}
   return;
  };
  const onChartHover=(event:any)=>{
   const trade=window.matchMedia('(hover: hover)').matches?matchingTrade(event):undefined;
   if(!trade){el.style.cursor='';hoverHint.style.display='none';return}
   el.style.cursor='pointer';hoverHint.textContent=`Trade #${trade.id} · Click to inspect`;
   const point=event.point||{};hoverHint.style.left=`${Math.max(8,Math.min((point.x||0)+12,el.clientWidth-210))}px`;hoverHint.style.top=`${Math.max(8,Math.min((point.y||0)+12,el.clientHeight-36))}px`;hoverHint.style.display='block';
  };
  chart.subscribeCrosshairMove(onChartHover);
  const onChartClick=(event:any)=>{
   const trade=matchingTrade(event);
   if(trade){setSelectedTrade(trade);setTradeDetailsOpen(true);setOutputTab('trades');setTerminalOpen(true);if(window.innerWidth<=640)setMobilePanel('terminal')}
  };
  chart.subscribeClick(onChartClick);
  chart.timeScale().fitContent();
  const removeChartTools=installChartTools(el,chart,series,priceCandles,`trading-vibes:drawings:${activeProfile?.uid||'local'}:${draftId}:${asset}`);
  const observer=new ResizeObserver(()=>chart.applyOptions({width:el.clientWidth,height:el.clientHeight}));
  observer.observe(el);
  return()=>{removeChartTools();chartApiRef.current=null;chartSeriesRef.current=null;observer.disconnect();chart.unsubscribeClick(onChartClick);chart.unsubscribeCrosshairMove(onChartHover);hoverHint.remove();chart.remove()};
 },[created,view,theme,propLiveMode,Boolean(propMarket?.candles?.length),propLiveMode?null:result,propLiveMode?null:monetary,propLiveMode?null:propEvaluation,activeProfile?.uid,draftId,asset]);
 useEffect(()=>{if(!propLiveMode||!chartSeriesRef.current||!Array.isArray(propMarket?.candles)||!propMarket.candles.length)return;
  chartSeriesRef.current.setData(propMarket.candles.map((c:Candle)=>({time:c.time as any,open:c.open,high:c.high,low:c.low,close:c.close})));
 },[propLiveMode,propMarket]);
 useEffect(()=>{if(propLiveMode||!focusTrade||view!=='chart'||!result||!chartApiRef.current)return;const index=result.candles.findIndex(c=>c.time>=focusTrade.entryTime);if(index<0)return;const first=result.candles[Math.max(0,index-20)],last=result.candles[Math.min(result.candles.length-1,index+20)];if(first&&last&&first.time<last.time)chartApiRef.current.timeScale().setVisibleRange({from:first.time,to:last.time});setFocusTrade(null)},[focusTrade,view,result,propLiveMode]);
 const requiredTimeframes=(()=>{try{return parseStrategyConfig(code).timeframes as string[]}catch{return []}})();const unavailableTimeframes=selectedMarket?requiredTimeframes.filter(tf=>!selectedMarket.timeframes.includes(tf)):[];
 const currentAgent:CloudBot|null=created?{...(cloudBots.find(bot=>bot.id===draftId)||{} as CloudBot),id:draftId,name,asset,venue,prompt}:null;
 const currentRuntime=(()=>{if(!created)return{state:'not-deployed' as const};if(venue==='propdao'){if(propLive?.botId!==draftId)return{state:'unknown' as const,detail:'status has not been loaded'};return{state:propLive.uncertain?'uncertain' as const:propLive.running?'running' as const:propLive.paused?'paused' as const:propLive.deployed?'stopped' as const:'not-deployed' as const}}const botState=liveAccount?.state?.bots?.[draftId];if(botState)return{state:liveCheck!=='ready'?'uncertain' as const:botState.running?'running' as const:'stopped' as const};if(paperStatus?.state)return{state:paperStatus.state.running?'running' as const:'stopped' as const};return{state:'not-deployed' as const}})();
 const goToBotList=()=>{if(busy)return;const snapshot={created:true,id:draftId,name,prompt,asset,code,view,chat};try{localStorage.setItem('tradefoundry:last-draft',JSON.stringify(snapshot));localStorage.setItem('tradefoundry:draft',JSON.stringify(snapshot))}catch{}setScreen('bots');setMobilePanel(null);if(cloudClient)void cloudClient.listBots().then(setCloudBots).catch(error=>{setCloudStatus('error');setCloudMessage(error instanceof Error?error.message:'Could not refresh your robot library.')})};
 const beginCreateRobot=()=>{if(busy)return;setPropLive(null);setPropMarket(null);botLoadRef.current='';const nextId=makeBotId();hydratedWorkspaceRef.current=nextId;setDraftId(nextId);setName('');setPrompt('');setAsset(assetOptions[0]||'');setCode(starterCode);setCodeHydrated(true);setChat([]);setChatHydrated(true);setChatInput('');setProposal('');setProposalSummary('');setResult(null);clearLogs();setCreated(false);setScreen('create')};
 const openLocalDraft=(draft:any)=>{setPrimaryArea('code');setAgentWorkspace('overview');setPropLive(null);setPropMarket(null);setVenue(venueOf(draft.venue));botLoadRef.current=typeof draft.id==='string'?draft.id:'';hydratedWorkspaceRef.current=typeof draft.id==='string'?draft.id:'';setDraftId(typeof draft.id==='string'?draft.id:makeBotId());setName(typeof draft.name==='string'?draft.name:'Untitled robot');setPrompt(typeof draft.prompt==='string'?draft.prompt:'');setAsset(typeof draft.asset==='string'?draft.asset:'');setCode(typeof draft.code==='string'?draft.code:starterCode);setCodeHydrated(Boolean(draft.code?.trim()));setCreateError(draft.code?.trim()?'':'Robot generation did not finish. Retry to write this robot’s script.');setChat(Array.isArray(draft.chat)?draft.chat:[]);setChatHydrated(true);setCreated(true);setScreen('workspace');setView('chart');setTab('chart')};
 const requestCodeView=()=>{if(view==='code')return;if(!codeHydrated){setVersionError('Could not load the saved robot code. Check your connection and reopen this robot before editing.');setOutputTab('versions');setTerminalOpen(true);return}let skipped=false;try{skipped=localStorage.getItem('tradefoundry:skip-code-warning')==='true'}catch{}if(skipped){setView('code');setTab('code')}else{setDontShowCodeWarning(false);setCodeWarning(true)}};
 const continueToCode=()=>{if(dontShowCodeWarning){try{localStorage.setItem('tradefoundry:skip-code-warning','true')}catch{}}setCodeWarning(false);setView('code');setTab('code')};
 const restoreLast=()=>{try{const d=JSON.parse(localStorage.getItem('tradefoundry:last-draft')||'null');if(d)openLocalDraft(d)}catch{}};
 if((economyPath(window.location.pathname)||screen==='shared'&&publicBotId)&&screen!=='auth')return <><EconomyPublic path={window.location.pathname} client={authReady?cloudClient:null} onSignIn={()=>{setScreen('auth')}} onOpen={async bot=>{await openCloudBot(bot);setPublicBotId(null);window.history.pushState({},'','/');}} onFollow={id=>{if(!authReady){setPendingSharedAction('start');setScreen('auth')}else setFollowingId(id)}} fallback={publicBotId?<SharedBotPage client={authReady?cloudClient:null} onSettings={()=>window.location.assign("/?account=1")} onSignIn={()=>{setScreen("auth")}} shareId={publicBotId} busy={shareBusy} error={shareError} onBacktest={()=>void openSharedAction('backtest')} onConnect={()=>void openSharedAction('connect')} onStart={()=>void openSharedAction('start')}/>:undefined}/>{marketDialogs}</>;
 if(screen==='shared'&&publicBotId)return <><SharedBotPage client={authReady?cloudClient:null} onSettings={()=>window.location.assign("/?account=1")} onSignIn={()=>{setScreen("auth")}} shareId={publicBotId} busy={shareBusy} error={shareError} onBacktest={()=>void openSharedAction('backtest')} onConnect={()=>void openSharedAction('connect')} onStart={()=>void openSharedAction('start')}/>{marketDialogs}</>;
 if(screen==='boot')return <main className="tv-boot"><img src="/logo.png" alt=""/><span>Trading Vibes</span><i/></main>;
 if(screen==='landing')return <LandingPage/>;
 if(screen==='auth')return <AuthPage client={cloudClient} initError={firebaseInitError||cloudMessage} onBack={()=>{setPendingSharedAction(null);if(window.location.pathname==='/sign-in')window.history.replaceState({},'','/');setScreen(publicBotId?'shared':'landing')}} onSuccess={enterAuthenticatedApp}/>;
 if(screen==='dashboard'&&cloudClient)return <><MarketplaceDashboard client={cloudClient} mode={dashboardMode} onBack={()=>setScreen('profile')} onBroker={()=>setBrokerOpen(true)} onDeploy={setDeploymentId} onFollow={setFollowingId}/>{marketDialogs}</>;
 if(screen==='profile')return <ProfilePage onDashboard={mode=>{setDashboardMode(mode);setScreen('dashboard')}} client={cloudClient} cloudStatus={cloudStatus} cloudMessage={cloudMessage} onBack={finishProfile} onRetry={retryFirebase} onChanged={()=>setCloudRetry(value=>value+1)} onSignOut={signOut}/>;
 if(screen==='bots')return cloudClient?<><CreatorHome client={cloudClient} bots={cloudBots} onSettings={openProfile} onCreate={beginCreateRobot} onOpen={openCloudBot} onBroker={()=>setBrokerOpen(true)} onDeploy={setDeploymentId} onFollow={setFollowingId}>{mobileNav=><BotLibrary mobileNav={mobileNav} botCovers={botCovers} bots={cloudBots} current={created?{venue,created,id:draftId,name,asset,prompt,code,view,chat}:null} onCreate={beginCreateRobot} onOpen={openCloudBot} onOpenLocal={openLocalDraft} onRename={renameRobot} onDelete={deleteRobot} onShare={setShareTarget} shareDialog={shareDialog} onProfile={openProfile} profileName={profileLabel} cloudStatus={cloudStatus} cloudMessage={cloudMessage} onRetry={retryFirebase}/>}</CreatorHome>{marketDialogs}</>:null;
 if(screen==='create')return <main className="create-shell"><div className="create-brand"><button className="icon-button" onClick={()=>setScreen('bots')} aria-label="Back to robots"><ArrowLeft size={17}/></button><img className="brand-logo" src="/logo.png" alt=""/><span>Trading Vibes</span><span className="phase-pill">NEW ROBOT</span><button className="ghost top-link" onClick={()=>setScreen('bots')}>All robots <ArrowRight size={14}/></button><button type="button" className="icon-button tv-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme==='light'?'dark':'light'} mode`} title={`Switch to ${theme==='light'?'dark':'light'} mode`} aria-pressed={theme==='dark'}>{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button><ProfileButton onClick={openProfile} label={profileLabel}/></div><div className="create-content"><div className="eyebrow"><span className="eyebrow-dot"/> BUILD YOUR STRATEGY</div><h1>Build a strategy<br/>that fits your edge.</h1><p className="create-sub">Describe your trading rules. Trading Vibes will prepare the script, then you can refine it and test it against your available market history.</p><section className="prompt-card"><div className="field-row"><label>BOT NAME<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. ETH Trend Rider" maxLength={48}/></label><label>VENUE<select value={venue} disabled={!!busy} onChange={e=>{const next=venueOf(e.target.value);setVenue(next);setAsset('');setMarketAvailability([]);if(next==='propdao')setBrokerOpen(true)}}>{(['valr','ctrader','hyperliquid','propdao'] as Venue[]).map(v=><option value={v} key={v}>{venueLabel[v]}</option>)}</select></label><label>MARKET<select disabled={!assetOptions.length} value={asset} onChange={e=>setAsset(e.target.value)}>{assetOptions.map(a=><option key={a}>{a}</option>)}</select></label></div><label className="strategy-field">STRATEGY DESCRIPTION<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Describe your entry, confirmation, and risk rules…" rows={4}/></label><div className="prompt-foot"><span><Sparkles size={14}/> AI writes native JavaScript you can edit {cloudClient&&<button type="button" className="text-button" onClick={()=>setAiSettingsOpen(true)}>AI settings</button>}</span><button className="primary" onClick={()=>void create()} disabled={!name.trim()||!prompt.trim()||!!busy||!assetOptions.includes(asset)}>{busy==='generate'?<><span className="spinner"/> Writing strategy…</>:<>Create robot <ArrowRight size={16}/></>}</button></div></section><StrategyDocCard asset={asset} timeframes={selectedMarket?.timeframes||[]}/>{availabilityError&&<div className="inline-error">{availabilityError}<button className="text-button" onClick={()=>void loadMarketAvailability()}>Retry</button></div>}<div className="manual-create"><button className="ghost" disabled={!!busy||!assetOptions.includes(asset)} onClick={()=>{setName(name.trim()||'Untitled robot');setPrompt(prompt.trim()||'Custom JavaScript strategy');setCreated(true);setCode(starterCode);setView('code');setTab('code');setScreen('workspace')}}><Code2 size={15}/> Write / paste JavaScript · Free</button><label className="ghost" style={{cursor:'pointer'}}>Import .js · Free<input style={{display:'none'}} type="file" accept=".js,text/javascript,application/javascript" onChange={async event=>{const file=event.target.files?.[0];if(!file)return;try{if(!assetOptions.includes(asset))throw Error('Choose an available venue market first.');if(file.size>180000)throw Error('Import a JavaScript file under 180 KB.');const source=await file.text();parseStrategyConfig(source);setCode(source);setName(name.trim()||file.name.replace(/\.js$/i,'').slice(0,64));setPrompt(prompt.trim()||'Imported JavaScript strategy');setCreated(true);setCodeHydrated(true);setView('code');setTab('code');setScreen('workspace')}catch(e){setCloudMessage(err(e));setCloudStatus('error')}}}/></label></div><CreateExtras busy={busy} draftId={draftId} cloudStatus={cloudStatus} cloudMessage={cloudMessage} cloudBots={cloudBots} availableAssets={assetOptions} markets={marketAvailability} onDemo={openDemo} onCloudBot={openCloudBot} onRetry={retryFirebase} /><button className="example-prompt" onClick={()=>{setName('London Trend Rider');setAsset(assetOptions[0]||'');setPrompt(defaultPrompt)}}><Sparkles size={14}/> Fill an example strategy <ChevronRight size={14}/></button><div className="create-data-note"><span className="data-dot"/> History coverage is checked on request</div></div><div className="create-bottom"><span>BUILT FOR STRATEGY RESEARCH</span><span>HISTORICAL MARKET PRICES</span><span>VALR DEMO &amp; LIVE</span></div>{marketDialogs}</main>;
 return <main className={`studio tv-chat-first tv-agent-workspace-${agentWorkspace} tv-area-${primaryArea} ${created?'':'tv-no-agent'} ${sidebarOpen?'tv-sidebar-open':'tv-sidebar-closed'}`}><aside className={sidebarOpen?'tv-app-sidebar open':'tv-app-sidebar closed'} aria-label="Trading Vibes navigation">
  <header className="tv-sidebar-brand"><img src="/logo.png" alt="Trading Vibes logo"/><strong>Trading Vibes</strong></header>
  <button type="button" className="tv-sidebar-new-chat" onClick={startNewConversation} disabled={!!busy&&!chatCanStop}><Plus size={17}/><span>New chat</span></button>
  <div className="tv-sidebar-scroll"><nav className="tv-sidebar-navigation" aria-label="Workspace">
   <button type="button" aria-current={primaryArea==='code'?'page':undefined} onClick={()=>{setPrimaryArea('code');setMobilePanel(null);if(window.innerWidth<=720)setSidebarOpen(false)}}><Code2 size={17}/><span>Robots</span></button>
   <button type="button" aria-current={primaryArea==='skills'?'page':undefined} onClick={()=>{setPrimaryArea('skills');setMobilePanel(null);if(window.innerWidth<=720)setSidebarOpen(false)}}><BookOpen size={17}/><span>Skills</span></button>
   <button type="button" aria-current={primaryArea==='you'?'page':undefined} onClick={()=>{setPrimaryArea('you');setMobilePanel(null);if(window.innerWidth<=720)setSidebarOpen(false)}}><Settings2 size={17}/><span>Apps</span></button>
  </nav>
  <section className="tv-sidebar-chats" aria-label="Recent chats"><div className="tv-sidebar-label">CHATS</div>{recentChats.map(conversation=><div className="tv-sidebar-chat-row" key={conversation.id}><button type="button" className="tv-sidebar-chat" aria-current={conversation.id===conversationId?'true':undefined} onClick={()=>void switchConversation(conversation.id)} disabled={!!busy&&!chatCanStop} title={conversation.title}>{conversation.title||'Untitled chat'}</button><span className="tv-sidebar-chat-actions"><button type="button" title={'Rename '+conversation.title} aria-label={'Rename '+conversation.title} disabled={!!busy} onClick={()=>setChatAction({type:'rename',id:conversation.id,title:conversation.title})}><Pencil size={14}/></button><button type="button" title={'Delete '+conversation.title} aria-label={'Delete '+conversation.title} disabled={!!busy} onClick={()=>setChatAction({type:'delete',id:conversation.id,title:conversation.title})}><Trash2 size={14}/></button></span></div>)}{recentChats.length===0&&<p className="tv-sidebar-empty">Your recent conversations will appear here.</p>}</section>
  </div><footer className="tv-sidebar-profile"><ProfileButton onClick={openProfile} label={profileLabel}/></footer>
 </aside><button type="button" className="tv-sidebar-scrim" onClick={()=>setSidebarOpen(false)} aria-label="Close navigation"></button><header className="topbar"><div className="top-left"><button type="button" className="icon-button tv-sidebar-toggle" onClick={()=>setSidebarOpen(value=>!value)} aria-label={sidebarOpen?"Close sidebar":"Open sidebar"} title={sidebarOpen?"Close sidebar":"Open sidebar"}>{sidebarOpen?<PanelLeftClose size={17}/>:<PanelLeftOpen size={17}/>}</button><button className="icon-button back-button" onClick={goToBotList} aria-label="Back to robots" title="Back to robots"><ArrowLeft size={17}/></button><img className="brand-logo small" src="/logo.png" alt=""/><div className="bot-title"><strong>{primaryArea==='chat'?(created?name||'Untitled agent':'Trading Vibes'):primaryArea==='trades'?'Trades':primaryArea==='markets'?'Markets':primaryArea==='scheduled'?'Scheduled':primaryArea==='skills'?'Skills':primaryArea==='code'?'Strategy':primaryArea==='agents'?(agentWorkspace==='overview'?'Code':agentWorkspace==='backtest'?'Code workspace':name||'Code'):'Apps'}</strong><span><i className={`status-dot ${propLive?.running||liveAccount?.state?.bots?.[draftId]?.running||paperStatus?.state?.running?'instance-running':'instance-neutral'}`}/> {venue==='propdao'&&(!propLive||propLive.loading||propLive.botId!==draftId)?'CHECKING LIVE STATUS':venue==='propdao'&&propLive?.running?'LIVE · PROPDAO':venue==='propdao'&&propLive?.uncertain?'LIVE STATUS UNKNOWN':venue==='propdao'&&propLive?.paused?'PAUSED · PROPDAO':venue==='propdao'&&propLive?.deployed?'STOPPED · PROPDAO':liveAccount?.state?.bots?.[draftId]?.running?'LIVE · VALR':paperBusy?'Working…':paperStatus?.deployed?(paperStatus.state?.running?'Running · paper':'Stopped · paper'):created?'Draft':'Your trading assistant'}</span></div><span className="market-symbol" aria-label={`Market ${asset}`}>{asset}</span>{created&&venue==='valr'&&asset?<ValrLiveQuote pair={asset}/>:<span className="phase-pill">{venueLabel[venue]}</span>}<ChevronDown size={13} className="muted"/></div><div className="tv-mobile-page-label" aria-hidden="true">{primaryArea==='skills'?'Skills':primaryArea==='code'?'Strategy':primaryArea==='you'?'Apps':primaryArea==='markets'?'Markets':'Trading Vibes'}</div><div className="tv-header-modes" role="tablist" aria-label="Main view"><button type="button" role="tab" aria-selected={primaryArea==='chat'} className={primaryArea==='chat'?'active':''} onClick={()=>{setPrimaryArea('chat');setAgentWorkspace('overview');setMobilePanel(null)}}><MessageCircle size={15}/><span>Chat</span></button><button type="button" role="tab" aria-selected={primaryArea==='trades'} className={primaryArea==='trades'?'active':''} onClick={()=>{setPrimaryArea('trades');setMobilePanel(null);setView('chart');setTab('chart');setTerminalOpen(true);setOutputTab(venue==='propdao'?'live-trading':'terminal');if(venue==='propdao'&&propLive?.deployed)setPropMonitorMode(true)}}><Activity size={15}/><span>Trades</span></button></div><div className="top-actions"><button className="icon-button workspace-share" title="Share robot" aria-label="Share robot" disabled={!created||venue!=='valr'||!!busy||!codeHydrated} onClick={()=>setShareTarget({id:draftId,name,asset,prompt,code})}><Share2 size={17}/></button><button type="button" className="icon-button tv-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme==='light'?'dark':'light'} mode`} title={`Switch to ${theme==='light'?'dark':'light'} mode`} aria-pressed={theme==='dark'}>{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button><ProfileButton onClick={openProfile} label={profileLabel}/>{busy==='generate'&&<span className="generation-status" role="status"><i/> AI writing live</span>}{!propLiveMode&&<DateRangePicker className="backtest-dates" dates={availableDates} from={from} setFrom={setFrom} to={to} setTo={setTo}/>}{!propLiveMode&&(venue==='propdao'?<label className="prop-risk-control" title="Risk per trade as a percentage of initial $1,000 equity">Risk/trade <select aria-label="PropDAO evaluation risk per trade" value={propRiskPercent} onChange={event=>{const next=Number(event.target.value);setPropRiskPercent(next);try{localStorage.setItem(`trading-vibes:propdao-risk:${draftId}`,String(next))}catch{}}}><option value={0.1}>0.10%</option><option value={0.25}>0.25%</option><option value={0.5}>0.50%</option><option value={1}>1.00%</option></select></label>:<MonetaryControls storageKey={simulationKey} onChange={updateSimulationSettings}/>)}<button className="ghost hide-small" onClick={()=>view==='code'?(setView('chart'),setTab('chart')):requestCodeView()}>{view==='code'?<><Activity size={15}/> Chart</>:<><Code2 size={15}/> Code</>}</button>{venue==='propdao'&&propLive?.deployed&&!propLive?.running&&!propLive?.uncertain&&<button className="ghost tv-mode-switch" onClick={()=>{setPropMonitorMode(!propLiveMode);setOutputTab(!propLiveMode?'live-trading':'terminal');setTerminalOpen(true);setView('chart');setTab('chart')}}>{propLiveMode?'Backtest mode':'LIVE dashboard'}</button>}<button className="ghost deploy-top-action" disabled={!!busy||!created||!codeHydrated} onClick={()=>void openDeployment()}>{venue==='propdao'&&propLive?.deployed?'Manage LIVE':'Deploy'}</button>{venue==='propdao'&&propLive?.deployed&&(propLive?.running||propLive?.paused||propLive?.uncertain)&&<button className="ghost tv-live-stop" disabled={liveBusy||!!busy||!codeHydrated} title="Stop robot; next Deploy loads the newly saved strategy code" onClick={()=>void controlPropDAOLive()}>{liveBusy?'Stopping…':'Stop bot'}</button>}{liveAccount?.state?.bots?.[draftId]?.running&&<button className="ghost" disabled={liveBusy} onClick={()=>void stopLive()}>{liveBusy?'Stopping…':'Stop live'}</button>}{paperStatus?.deployed&&paperStatus.state&&<button className="ghost" disabled={paperBusy||!!busy} onClick={()=>void controlPaper()}>{paperBusy?'Working…':paperStatus.state.running?'Stop paper':'Start paper'}</button>}{!propLiveMode&&<button className="primary backtest-button" disabled={!!liveLocked||liveCheck!=='ready'||busy==='chat'||busy==='generate'||busy==='sync'||!codeHydrated||!code.trim()||!availableDates.length||unavailableTimeframes.length>0} title={liveLocked||liveCheck!=='ready'?'Confirm the instance is stopped, or create a copy':unavailableTimeframes.length?`Available ${selectedMarket?.timeframes.join(', ')}; strategy requires ${unavailableTimeframes.join(', ')}`:undefined} onClick={busy==='backtest'?()=>abortRef.current?.abort():()=>backtest()}>{busy==='generate'?<>Writing…</>:busy==='sync'?<>Saving run…</>:busy==='backtest'?<>Stop backtest</>:<><Play size={14} fill="currentColor"/> Backtest</>}</button>}</div></header>

 {primaryArea==='agents'&&agentWorkspace==='backtest'&&<div className="tv-backtest-toolbar" role="region" aria-label="Backtesting controls"><div className="tv-backtest-heading"><Activity size={16}/><strong>Backtesting workspace</strong><span>{asset||'Choose a market'}</span></div>{!propLiveMode&&<DateRangePicker className="tv-backtest-range" dates={availableDates} from={from} setFrom={setFrom} to={to} setTo={setTo}/>}<button type="button" disabled={!!busy||!created||!codeHydrated||!code.trim()||!availableDates.length||!!liveLocked||liveCheck!=='ready'||unavailableTimeframes.length>0||propLiveMode} onClick={()=>void backtest()}><Play size={14}/>Run backtest</button><button type="button" disabled={!result} onClick={()=>{setOutputTab(venue==='propdao'?'prop-results':'results');setTerminalOpen(true);if(window.innerWidth<=640)setMobilePanel('terminal')}}>Results</button></div>}
 <div className="tv-destination-shell" hidden={primaryArea!=='markets'}><MarketsHub active={primaryArea==='markets'} loadHistory={loadMarketHistory} onAskAI={question=>{setPrimaryArea('chat');setAgentWorkspace('overview');setChatCollapsed(false);setChatInput(question)}} onBuildStrategy={(market,marketVenue)=>{if(busy)return;beginCreateRobot();setVenue(marketVenue);setAsset(market);setPrompt('Help me build a strategy for '+market+'. Explain the entry, exit and risk rules before generating code.')}}/></div>
 <div className="tv-destination-shell" hidden={primaryArea!=='code'}><CodeLibrary client={cloudClient} bots={cloudBots} analyses={codeAnalyses} watches={codeWatches} current={created&&!cloudBots.some(bot=>bot.id===draftId)?{id:draftId,name,asset,venue,prompt,code}:null} agents={agentRecords} runtimeStates={agentRuntimeStates} deploymentError={agentError} onRefreshDeployments={()=>refreshAgentRecords()} onManageDeployment={async(agent,action)=>{
  if(!cloudClient)throw Error('Sign in to manage this deployment.');
  if(agent.venue!=='propdao'){
   const bot=cloudBots.find(item=>item.id===agent.botId);
   if(!bot)throw Error('The saved strategy linked to this deployment could not be found.');
   setPrimaryArea('chat');setChatCollapsed(false);
   void sendChat((action==='status'?'Check the runtime status of ':'Prepare a stop review for ')+'"'+agent.name+'".',undefined,false,{tool:action,botId:bot.id});
   return {delegatedToChat:true,venue:agent.venue};
  }
  const endpoint=`/api/venues/propdao/bots/${encodeURIComponent(agent.botId)}/live`;
  const status=action==='stop'
   ?await sharingRequest<any>(cloudClient,endpoint,'POST',{action:'stop'})
   :await sharingRequest<any>(cloudClient,endpoint);
  const unverified=Boolean(status.uncertain||status.statusUnavailable||action==='stop'&&!status.runtimeStopped);
  setAgentRuntimeStates(items=>({...items,[agent.id]:{state:unverified?'unknown':status.running?'running':status.paused?'paused':'stopped',verified:!unverified,lastSignal:status.lastSignal||null,nextCheck:status.nextCheck||null,openPositions:Array.isArray(status.positions)?status.positions.length:null,error:status.error||null}}));
  setAgentRevision(v=>v+1);
  return status;
 }} onSaved={bot=>{
  setCloudBots(items=>[bot,...items.filter(item=>item.id!==bot.id)]);
  if(bot.id===draftId&&bot.code!==undefined&&bot.code!==code)setCode(bot.code);
 }} onAsk={(message,bot)=>{setPrimaryArea('chat');void sendChat(message,undefined,false,bot?{tool:'find_code',botId:bot.id}:undefined)}} onRenameBot={(bot,value)=>renameRobot(bot,value,!cloudBots.some(item=>item.id===bot.id))} onDeleteBot={bot=>deleteRobot(bot,!cloudBots.some(item=>item.id===bot.id))} onRenameAnalysis={async (item,value)=>{if(!cloudClient)throw Error('Sign in to rename Code.');const name=value.trim().slice(0,64);if(!name)throw Error('Enter a name.');const updated={...item,name};await cloudClient.saveCodeAnalysis(updated);setCodeAnalyses(items=>items.map(existing=>existing.id===item.id?updated:existing))}} onDeleteAnalysis={async item=>{if(!cloudClient)throw Error('Sign in to delete Code.');const status=await sharingRequest<CodeWatchStatus>(cloudClient,'/api/code-watches/'+encodeURIComponent(item.id));if(!status.verified||status.running)throw Error('Stop the Code watcher and verify its status before deleting.');await cloudClient.deleteCodeAnalysis(item.id);setCodeAnalyses(items=>items.filter(existing=>existing.id!==item.id))}} onRunAnalysis={analysis=>{setPrimaryArea('chat');void sendChat('Run the saved analysis "'+analysis.name+'" on '+analysis.asset+' and show the results.')}} onWatch={analysis=>{setPrimaryArea('chat');setPendingWatchAsset(analysis);setChat(current=>[...current,{role:'assistant',content:'I can run **'+analysis.name+'** as an always-on, read-only Cloudflare watch. It checks completed candles and records detections. Review and approve below; it does not place trades.'}])}} onStopWatch={analysis=>{if(!cloudClient)return;void sharingRequest<CodeWatchStatus>(cloudClient,'/api/code-watches/'+encodeURIComponent(analysis.id),'POST',{action:'stop'}).then(status=>{
  if(!status.verified||status.running)throw Error('The runtime did not confirm a stop.');
  setCodeWatches(current=>({...current,[analysis.id]:status}));
 }).catch(error=>setAgentError('Could not verify watch stopped: '+err(error)))}} onDeploy={(bot,riskPercent,codeHash)=>setLibraryDeployment({bot,riskPercent,codeHash})}
 theme={theme} onConnectBroker={()=>openBrokerChoice('propdao')}
 onAuditTrade={(run,trade,bot)=>{
  const context:ChatContext={kind:'trade-audit',label:'Robot '+(bot?.name||run.asset)+' · trade #'+trade.id,
   data:createBacktestTradeAudit(run,trade.id)};
  setPrimaryArea('chat');setChatCollapsed(false);if(window.innerWidth<=720)setMobilePanel('chat');
  void sendChat('Inspect trade #'+trade.id+' of '+(bot?.name||run.asset)+'. Analyse the exact tested strategy, saved price candles and outcome. Explain the recorded evidence and limits.',context);
 }}/></div>
 <div className="tv-destination-shell" hidden={primaryArea!=='skills'}><SkillsLibrary skills={skills} busy={!!busy||!cloudClient} loading={skillsLoading} loadError={skillsError} onRetry={()=>setSkillsRevision(v=>v+1)} onSave={updateSkill} onDelete={deleteUserSkill} onPersonality={()=>setPersonalityOpen(true)}/></div>
 <div className="tv-destination-shell" hidden={primaryArea!=='you'}><YouHub onAISettings={()=>setAiSettingsOpen(true)} onBroker={()=>openBrokerChoice('propdao')}/></div><div className="tv-destination-shell" hidden={primaryArea!=='trades'}><AccountTrades client={cloudClient} active={primaryArea==='trades'} revision={brokerRevision} onConnect={()=>setBrokerPickerOpen(true)} onInspect={(broker,kind,record)=>{setPrimaryArea('chat');setAgentWorkspace('overview');setChatCollapsed(false);if(window.innerWidth<=720)setMobilePanel('chat');const symbol=String(record.symbol||record.currencyPair||'');const context:ChatContext={kind:'trade-audit',label:'Provider '+kind+' · '+(symbol||broker),data:{source:broker.toUpperCase()+' account response (read only)',venue:broker,asset:symbol,tradeKind:kind,providerRecord:record,limitations:'Only the attached broker record is supplied. Candles, execution sequence and news are not attached.'}};void sendChat('Inspect this '+kind+' using the attached provider record. Explain what is known and do not invent missing details.',context)}}/></div>
 {conversationLibrary&&<div className="trade-modal-backdrop"><section className="trade-modal" role="dialog" aria-modal="true" aria-label="Conversations"><header><h2>Conversations</h2><button onClick={()=>setConversationLibrary(null)} aria-label="Close conversations">×</button></header>{conversationLibrary.length?conversationLibrary.map(c=><button className="tv-conversation-entry" key={c.id} disabled={!!busy&&!chatCanStop} onClick={()=>void switchConversation(c.id)}>{c.title}</button>):<p>Your saved conversations will appear here.</p>}<p>Conversations are separate from agent execution.</p></section></div>}
 <div className="studio-body"><aside className={`chat-side ${chatCollapsed?'collapsed':''} ${mobilePanel==='chat'?'mobile-open':''}`}><div className="side-head"><div><span className="ai-orb"><Sparkles size={14}/></span><strong>VIBES</strong>{cloudClient&&<button className="text-button" onClick={()=>setAiSettingsOpen(true)}>AI settings</button>}<span className={`online-dot ${aiError?'offline':'idle'}`}/></div><button className="icon-button hide-small" onClick={()=>setChatCollapsed(!chatCollapsed)}>{chatCollapsed?<PanelLeftOpen size={15}/>:<PanelLeftClose size={15}/>}</button><button className="icon-button mobile-only" onClick={()=>setMobilePanel(null)}><X size={17}/></button></div>{!chatCollapsed&&<><div className="chat-messages" ref={chatScrollRef} onScroll={event=>{const el=event.currentTarget;followChat.current=el.scrollHeight-el.scrollTop-el.clientHeight<72}}>{chat.length===0?<div className="chat-empty"><div className="chat-empty-icon"><MessageCircle size={19}/></div><strong>What are we looking at today?</strong><p>Talk markets, unpack a move, or build a strategy with VIBES.</p>{cloudClient&&<button type="button" className="tv-connect-ai" onClick={()=>setAiSettingsOpen(true)}><Sparkles size={15}/>Connect or manage your AI</button>}<div className="suggestions">{['Teach me forex from zero','Explain risk per trade','Explore historical Gold data','Latest Gold headlines','Build a draft strategy'].map(s=><button key={s} onClick={()=>setChatInput(s)}>{s}<ArrowRight size={12}/></button>)}</div></div>:chat.map((m,i)=><div className={`message ${m.role}`} key={i}><div className="message-avatar">{m.role==='assistant'?<Sparkles size={12}/>:<span>Y</span>}</div><div className="message-content">{m.role==='user'?<div className="tv-user-text">{m.content}</div>:<ChatText content={m.content}/>}{m.toolTrace?.length?<ChatEvidence theme={theme} trace={m.toolTrace} onAsk={i===chat.length-1&&!busy?question=>void sendChat(question):undefined}/>:null}{m.context?.kind==='news-snapshot'&&<TradingVisualResponse kind="news-snapshot" data={m.context.data}/>} {m.context?.kind==='news-coverage'&&<TradingVisualResponse kind="news-coverage" data={m.context.data}/>}  {m.context?.kind==='trade-audit'&&<TradingVisualResponse kind="trade-audit" data={m.context.data}/>} {m.context?.kind==='market-analysis'&&<AnalysisChatCard report={m.context.data as MarketReport}/>}{m.context?.kind==='backtest-result'&&<BacktestChatCard data={m.context.data as BacktestCardData} onDeploy={!busy&&i===chat.length-1&&cloudBots.some(bot=>bot.id===(m.context!.data as BacktestCardData).botId)?()=>{
  const saved=m.context!.data as BacktestCardData;
  const selected=cloudBots.find(bot=>bot.id===saved.botId);
   if(!selected)return;
   if(selected.venue==='propdao'){setLibraryDeployment({bot:selected,riskPercent:1});return}
   void sendChat('Prepare deployment for "'+saved.name+'".',undefined,false,{tool:'deploy',botId:saved.botId});
 }:undefined} onInspect={id=>void openSavedTradeInspection(m.context!.data as BacktestCardData,id)}/>}</div>{m.context&&m.context.kind!=='backtest-result'&&m.context.kind!=='market-analysis'&&<button type="button" className="chat-context-chip" onClick={()=>setContextModal(m.context!)}><Braces size={12}/>{m.context.label}</button>}{aiError&&i===chat.length-1&&m.role==='assistant'&&<button className="ai-retry-button" onClick={retryChat} disabled={!!busy}><RotateCcw size={12}/> Retry</button>}</div>)}{createError&&<button className="retry-generation" onClick={()=>void create(true)} disabled={!!busy}><RotateCcw size={12}/> Retry generation</button>}{assistantTask&&<ChatTaskChoices key={conversationId+':'+assistantTask.kind+':'+(assistantTask.kind==='backtest'?assistantTask.botId:assistantTask.kind==='create'?assistantTask.asset||'market':assistantTask.robotIds.join(','))}
 task={assistantTask} prefs={tradingPreferences} bots={cloudBots} disabled={!!busy} onChoose={selectChatTaskChoice}
 onCancel={()=>{setAssistantTask(null);setChat(items=>[...items,{role:'assistant',content:'Task cancelled. Nothing was saved or deployed.'}])}}/>}{proposal&&<section className="proposal tv-code-proposal" role="group" aria-label="Proposed strategy code change">
  <div className="tv-proposal-topline"><span><Sparkles size={15}/> ROBOT EDIT READY</span><span className="tv-proposal-no-save">Nothing saved yet</span></div>
  <h3>{codeEditTarget?'Update '+codeEditTarget.bot.name:newCodeTarget?'Create '+newCodeTarget.name:'Update current draft'}</h3>
  {newCodeTarget&&<label className="tv-proposal-name">New robot name <input value={newCodeTarget.name} maxLength={64} onChange={event=>setNewCodeTarget(current=>current?{...current,name:event.target.value}:current)} aria-label="New robot name"/></label>}
  <p className="tv-proposal-identity">{codeEditTarget?codeEditTarget.bot.asset+' · '+venueLabel[venueOf(codeEditTarget.bot.venue)]+' · existing saved robot':newCodeTarget?newCodeTarget.asset+' · '+venueLabel[newCodeTarget.venue]+' · new robot':'Unsaved workspace draft'}</p>
  <p className="tv-proposal-summary">{proposalSummary}</p>
  <div className="tv-proposal-diff-outer">
   <div className="tv-proposal-filehead"><strong>strategy.js</strong><span>Proposed changes · Git-style diff</span></div>
   <div className="tv-proposal-code-diff" role="region" aria-label="Added and removed JavaScript lines">
    {strategyDiff(codeEditTarget?.source??(newCodeTarget?'':code),proposal).slice(0,550).map((line,i)=><div key={i} className={'tv-diff-line tv-diff-'+line.kind}><span className="tv-diff-old">{line.oldLine??''}</span><span className="tv-diff-new">{line.newLine??''}</span><span className="tv-diff-prefix">{line.kind==='added'?'+':line.kind==='removed'?'-':' '}</span><code>{line.text}</code></div>)}
   </div>
   {strategyDiff(codeEditTarget?.source??(newCodeTarget?'':code),proposal).length>550&&<p className="tv-diff-capped">Diff preview is limited to 550 lines for performance. Open the complete source below before approving.</p>}
  </div>
  <details className="tv-proposal-fullsource"><summary>View complete proposed strategy.js</summary><pre>{proposal}</pre></details>
  <p className="tv-proposal-note">Reviewing does not run, deploy, or authorize trades. The server checks the exact saved revision before Apply.</p>
  <div className="tv-proposal-actions"><button type="button" className="apply-button" disabled={!!busy||(!newCodeTarget&&!codeEditTarget&&(liveLocked||liveCheck!=='ready'))} onClick={()=>void openProposalReview()}><Check size={15}/>{newCodeTarget?'Review & save robot':'Review & Apply'}</button><button type="button" className="tv-proposal-reject" onClick={()=>{setProposal('');setProposalSummary('');setNewCodeTarget(null);setCodeEditTarget(null)}}>Discard proposal</button></div>
 </section>}{pendingWatchAsset&&<section className="tv-chat-result-card" role="group" aria-label="Code watcher review"><div className="tv-card-heading"><Clock3 size={16}/><strong>Review Code watcher</strong></div><p>{pendingWatchAsset.name} · {pendingWatchAsset.timeframe.toUpperCase()} · {venueLabel[pendingWatchAsset.venue]}. Continuously checks completed candles on Cloudflare. Records detections from completed candles.</p><WatchOutputFields value={watchOutput} onChange={setWatchOutput}/><label className="tv-watch-opt-in"><input type="checkbox" checked={requestBrowserWatchAlerts} onChange={event=>setRequestBrowserWatchAlerts(event.target.checked)}/> Browser notifications while this app is open</label><div className="tv-operation-actions"><button type="button" disabled={!!busy||!cloudClient} onClick={()=>{if(!cloudClient||!pendingWatchAsset)return;const watch=pendingWatchAsset;if(requestBrowserWatchAlerts&&typeof Notification!=='undefined'&&Notification.permission==='default')void Notification.requestPermission();setBusy('sync');void cloudClient.saveCodeAnalysis(watch).then(()=>{setCodeAnalyses(items=>[watch,...items.filter(item=>item.id!==watch.id)]);return sharingRequest<CodeWatchStatus>(cloudClient,'/api/code-watches/'+encodeURIComponent(watch.id),'POST',{action:'start',confirm:'START CODE WATCH',output:watchOutput,...(watchOutput.type!=='log'?{outputConfirm:'AUTHORIZE MONITOR OUTPUT'}:{})});}).then(status=>{if(!status.running||!status.verified)throw Error('The Worker did not confirm a running watch.');setCodeWatches(items=>({...items,[watch.id]:status}));setPendingWatchAsset(null);setChat(items=>[...items,{role:'assistant',content:'**'+watch.name+'** is confirmed running on a Cloudflare Durable Object. You can inspect its next check and detections in Code. Its output does not authorize trades.'}])}).catch(error=>setChat(items=>[...items,{role:'assistant',content:'Watch deployment was not confirmed: '+err(error)+'. No running status has been assumed.'}])).finally(()=>setBusy(''))}}>Authorize watch</button><button type="button" className="tv-action-dismiss" onClick={()=>setPendingWatchAsset(null)}>Cancel</button></div></section>}{chatOperation&&<section className="tv-chat-result-card" role="group" aria-label="Trading operation review"><div className="tv-card-heading"><ShieldAlert size={16}/><strong>{chatOperation==='deploy'?'Deployment review':'Stop agent review'}</strong></div><p>{chatOperation==='deploy'? `Review ${name||'your bot'} on ${venueLabel[venue]}. This opens the existing deployment dialog for explicit authorisation.`:`Request a stop of ${name||'your agent'}. Stopping the bot does not automatically close existing broker positions.`}</p><div className="tv-operation-actions"><button type="button" disabled={!!busy||liveBusy||paperBusy||!created||!cloudClient||(chatOperation==='deploy'&&!codeHydrated)||(chatOperation==='stop'&&venue!=='propdao'&&(propLive?.uncertain||liveCheck==='unavailable'))} onClick={()=>{const action=chatOperation;setChatOperation(null);if(!consumeActionReview(actionReview.current,{uid:activeProfile?.uid||'',botId:draftId,code,venue})){setAiError('This review expired or the agent changed. Request a fresh review.');return;}if(action==='deploy'){void openDeployment();return;}if(venue==='propdao'&&propLive?.deployed){void controlPropDAOLive();return;}if(venue==='valr'&&liveAccount?.state?.bots?.[draftId]?.running){void stopLive();return;}if(venue==='valr'&&paperStatus?.state?.running){void controlPaper();return;}setChat(current=>[...current,{role:'assistant',content:'No verified running agent was found to stop. Check the latest agent status before retrying.'}]);}}>{chatOperation==='deploy'?'Open deployment review':'Confirm stop request'} <ArrowRight size={14}/></button><button type="button" className="tv-action-dismiss" onClick={()=>setChatOperation(null)}>Cancel</button></div></section>}{(busy==='backtest-queued'||busy==='backtest'||busy==='sync')&&<section className="tv-chat-result-card" role="status"><strong>{busy==='sync'?'Saving backtest':busy==='backtest-queued'?'Preparing backtest':'Backtest in progress'}</strong><p>{name} · {asset} · {from} to {to}</p><p>{logs.at(-1)||'Preparing historical data…'}</p><button type="button" disabled={busy==='sync'} onClick={()=>{if(busy==='backtest-queued'){queuedChatDates.current=null;setQueuedBacktest('');chatBacktestBotRef.current='';setChatBacktestBotId('');setBusy('');setChat(items=>[...items,{role:'assistant',content:'Backtest preparation cancelled.'}])}else abortRef.current?.abort()}}>Cancel backtest</button></section>}</div><div className="chat-composer" ref={chatComposerRef}><button type="button" className="tv-composer-add" aria-label="Browse saved Code" title="Browse Code tools" onClick={()=>setPrimaryArea('code')}><Plus size={19}/></button><ChatModelSelector client={cloudClient} selected={conversationModel} disabled={!!busy||!cloudClient} onSettings={()=>setAiSettingsOpen(true)} onSelect={async model=>{if(!cloudClient)throw Error('Connect OpenRouter first.');await cloudClient.selectConversationModel(conversationId,model);setConversationModel(model);setRecentChats(items=>items.map(item=>item.id===conversationId?{...item,model}:item))}}/><textarea ref={chatInputRef} rows={1} value={chatInput} onChange={event=>setChatInput(event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void sendChat()}}} placeholder="Message your trading AI…" aria-label="Message your AI partner"/>{(chatCanStop||aiStreaming&&!chatTurnRef.current)?<button type="button" className="send-button" aria-label="Stop response" title="Stop response" onClick={cancelAi}><span aria-hidden="true">■</span></button>:<button className="send-button" aria-label="Send message" title="Send message" onClick={()=>void sendChat()} disabled={!chatInput.trim()||!!busy}><ArrowUp size={19} strokeWidth={2.5}/></button>}</div></>}</aside><Workspace theme={theme} venue={venue} propLive={propLive} onPropLiveRefresh={()=>setPropLiveRevision(v=>v+1)} propLiveMode={propLiveMode} propMarket={propMarket} propEvaluation={propEvaluation} liveCheck={liveCheck} liveLocked={liveLocked} onCopy={()=>void copyRunningBot()} monetary={monetary} view={view} setView={setView} setTab={setTab} requestCodeView={requestCodeView} undoCode={undoCode} redoCode={redoCode} saveVersion={saveCurrentVersion} renameVersion={renameSavedVersion} deleteVersion={deleteSavedVersion} versions={versions} versionsLoading={versionsLoading} versionError={versionError} loadVersion={loadSavedVersion} cloudStatus={cloudStatus} cloudMessage={cloudMessage} code={code} setCode={setCode} editorRef={editorRef} asset={asset} from={from} setFrom={setFrom} to={to} setTo={setTo} result={result} outputTab={outputTab} setOutputTab={setOutputTab} selectedTrade={mobilePanel==='terminal'?null:selectedTrade} showTradeModal={tradeDetailsOpen} setTradeDetailsOpen={setTradeDetailsOpen} setFocusTrade={setFocusTrade} setSelectedTrade={setSelectedTrade} onAuditTrade={askAiToAuditTrade} backtest={backtest} terminalOpen={terminalOpen} setTerminalOpen={setTerminalOpen} busy={busy} logs={logs} setLogs={setLogs} clearLogs={clearLogs} setChatInput={setChatInput} setMobilePanel={setMobilePanel} deleteSavedBacktest={deleteSavedBacktest} chartRef={chartRef} cancelBacktest={()=>abortRef.current?.abort()} availableDates={availableDates} availabilityError={availabilityError} reloadAvailability={()=>void loadMarketAvailability()} unavailableTimeframes={unavailableTimeframes} availableTimeframes={selectedMarket?.timeframes||[]} /><section className="tv-agent-home" aria-label="Scheduled and running work"><AgentLibrary bots={cloudBots} current={currentAgent} runtime={currentRuntime} search={agentSearch} onSearch={setAgentSearch} onCreate={beginCreateRobot} onOpen={bot=>void openCloudBot(bot)} onBacktest={()=>{setAgentWorkspace('backtest');setView('chart');setTab('chart')}} onCode={()=>{setAgentWorkspace('code');requestCodeView()}} onDeploy={()=>void openDeployment()} agents={agentRecords} audits={agentAudits} runtimeStates={agentRuntimeStates} agentError={agentError} onRefreshAgents={()=>void refreshAgentRecords()} onViewAudit={id=>void loadAgentAudit(id)} onOpenAgent={record=>{const saved=cloudBots.find(bot=>bot.id===record.botId);if(saved)void openCloudBot(saved);else if(draftId===record.botId){setPrimaryArea('chat');setAgentWorkspace('overview')}else setAgentError('The strategy linked to this agent is not in your saved robot library.')}}/></section> </div>
 {shareDialog}{assistantChange&&assistantReviewOpen&&<Dialog title="Review requested change" busy={assistantReviewBusy} onClose={()=>{setAssistantReviewOpen(false);setAssistantChange(null)}}>
  {assistantChange.kind==='skill'?<><p>{assistantChange.action==='create'?'Create':assistantChange.action==='update'?'Update':'Delete'} skill <strong>{assistantChange.after?.name||assistantChange.before?.name}</strong>?</p>{assistantChange.after&&<><p>Instructions and triggers:</p><pre className="tv-review-content">{assistantChange.after.instructions}{'\n\nTriggers: '}{assistantChange.after.alwaysOn?'Every message':assistantChange.after.triggers.join(', ')||'When named'}{'\nEnabled: '}{assistantChange.after.enabled?'Yes':'No'}</pre></>}</>:assistantChange.kind==='personality'?<><p>Replace the personality profile with:</p><pre className="tv-review-content">{assistantChange.after||'(Use default personality)'}</pre></>:assistantChange.kind==='code'?<p>{assistantChange.action==='delete'?'Delete':'Rename'} <strong>{assistantChange.before.name}</strong>{assistantChange.action==='rename'?' to '+assistantChange.newName:' and its saved backtest and versions'}?</p>:<p>Open {assistantChange.broker.toUpperCase()} settings to {assistantChange.action} the account?</p>}
  {assistantReviewError&&<p role="alert" className="tv-skills-error">{assistantReviewError}</p>}
  <div className="market-buttons"><button type="button" className="ghost" disabled={assistantReviewBusy} onClick={()=>{setAssistantReviewOpen(false);setAssistantChange(null)}}>Cancel</button><button type="button" className="primary" disabled={assistantReviewBusy} onClick={()=>void confirmAssistantChange()}>{assistantReviewBusy?'Working…':'Confirm change'}</button></div>
 </Dialog>}{proposalReviewOpen&&proposal&&<Dialog title={newCodeTarget?'Review new code':'Review code update'} onClose={()=>void denyProposal()}><p>Review the complete strategy before saving{codeEditTarget?' to '+codeEditTarget.bot.name:''}.</p>{stagedReview&&<p>{stagedReview.asset} · {venueLabel[stagedReview.venue]} · Expires {displayTime(stagedReview.expiresAt)}</p>}{strategyReviewError&&<p role="alert">{strategyReviewError}</p>}<pre className="tv-review-content">{proposal}</pre><div className="market-buttons"><button type="button" className="ghost" disabled={!!busy} onClick={()=>void denyProposal()}>{stagedReview?'Deny':'Cancel'}</button><button type="button" className="primary" disabled={!!busy||Boolean(codeEditTarget&&!stagedReview)} onClick={()=>{if(!codeEditTarget)setProposalReviewOpen(false);void applyProposal()}}>Confirm and save</button></div></Dialog>}{brokerPickerOpen&&<BrokerPicker onClose={()=>setBrokerPickerOpen(false)} onChoose={openBrokerChoice}/>} {personalityOpen&&<PersonalityDialog value={personality} onClose={()=>setPersonalityOpen(false)} onSave={async value=>{if(!cloudClient)throw Error('Sign in to save your personality.');await cloudClient.savePersonality(value);setPersonality(value.trim())}}/>}{profileOpen&&cloudClient&&<ProfileSettingsDialog client={cloudClient} cloudStatus={cloudStatus} onPreferencesSaved={setTradingPreferences} onClose={()=>setProfileOpen(false)} onChanged={()=>setProfileRevision(v=>v+1)} onSignOut={async()=>{setProfileOpen(false);await signOut()}}/>}<ChatConversationDialog action={chatAction} onClose={()=>setChatAction(null)} onSubmit={updateConversationAction}/>{savedTradeInspectionDialog}{marketDialogs}
 <nav className="mobile-actions"><button onClick={()=>{setChatCollapsed(false);setMobilePanel('chat')}}><MessageCircle size={17}/><span>AI chat</span>{chat.length>0&&<i/>}</button><button onClick={()=>setMobilePanel('terminal')}><Terminal size={17}/><span>Outputs</span>{logs.length>0&&<i/>}</button></nav>{mobilePanel==='terminal'&&<div className="mobile-sheet-backdrop" onClick={()=>setMobilePanel(null)}><section className="mobile-terminal-sheet" onClick={event=>event.stopPropagation()}><div className="sheet-grabber"/><OutputDock liveMode={propLiveMode} propLive={propLive} onPropLiveRefresh={()=>setPropLiveRevision(v=>v+1)} isPropDAO={venue==='propdao'} propEvaluation={propEvaluation} monetary={monetary} asset={asset} timeframe={propLiveMode?undefined:result?.timeframe} from={from} to={to} logs={logs} result={result} selectedTrade={selectedTrade} showTradeModal={tradeDetailsOpen} busy={busy} active={outputTab} collapsed={false} onTabChange={setOutputTab} onCollapse={()=>setMobilePanel(null)} onClear={clearLogs} onDeleteBacktest={deleteSavedBacktest} onStop={()=>abortRef.current?.abort()} onSelectTrade={trade=>{setSelectedTrade(trade);setTradeDetailsOpen(false);setFocusTrade(trade);setView('chart');setTab('chart');setOutputTab('trades');setMobilePanel(null)}} onClearSelectedTrade={()=>{setSelectedTrade(null);setTradeDetailsOpen(false)}} onAuditTrade={askAiToAuditTrade} versions={versions} versionsLoading={versionsLoading} versionError={versionError} onLoadVersion={loadSavedVersion} onRenameVersion={renameSavedVersion} onDeleteVersion={deleteSavedVersion} compact/></section></div>}
 {codeWarning&&<CodeWarningDialog dontShow={dontShowCodeWarning} setDontShow={setDontShowCodeWarning} onCancel={()=>setCodeWarning(false)} onContinue={continueToCode}/>}<ChatContextModal context={contextModal} onClose={()=>setContextModal(null)}/><div className="keyboard-shortcut"><Command size={11}/> + ↵ <span>Backtest</span></div>
 </main>
}
function CreateExtras(p:{busy:string;draftId:string;cloudStatus:string;cloudMessage:string;cloudBots:CloudBot[];availableAssets:string[];markets:AvailableMarket[];onDemo:(bot:DemoBot)=>void;onCloudBot:(bot:CloudBot)=>void;onRetry:()=>void}){const visibleDemos=demoBots.filter(bot=>{const market=p.markets.find(item=>item.asset===bot.asset);if(!market)return false;try{return parseStrategyConfig(bot.code).timeframes.every((tf:string)=>market.timeframes.includes(tf))}catch{return false}});const saved=p.cloudBots.filter(bot=>!demoBots.some(demo=>demo.id===bot.id)&&p.availableAssets.includes(bot.asset));return <>{visibleDemos.length>0&&<section className="demo-section"><div className="demo-heading"><div className="demo-heading-copy"><span>QUICK START</span><strong>Start from an example</strong></div><span className="demo-caption">{visibleDemos.length} available · based on your market history</span></div><div className="demo-grid">{visibleDemos.map(bot=><article className="demo-card" key={bot.id}><div className="demo-card-top"><span className="demo-icon"><Bot size={16}/></span><span className="demo-market">{bot.asset} · {parseStrategyConfig(bot.code).timeframes.join(' / ').toUpperCase()}</span></div><strong>{bot.name}</strong><p>{bot.description}</p><button className="demo-run" onClick={()=>p.onDemo(bot)} disabled={!!p.busy}>{p.busy==='backtest'&&p.draftId===bot.id?<><span className="spinner"/> Running…</>:<>Load &amp; backtest <ArrowRight size={14}/></>}</button></article>)}</div></section>}<div className="cloud-row"><span className={p.cloudStatus==='connected'?'data-dot':'cloud-indicator'}/><span>{p.cloudStatus==='connected'?`Cloud sync · ${p.cloudBots.length} saved robots`:p.cloudStatus==='saving'?'Saving changes…':p.cloudStatus==='connecting'?'Connecting cloud storage…':p.cloudStatus==='error'?'Cloud sync paused · drafts stay on this device':'Local draft mode'}</span>{p.cloudStatus==='error'&&<button className="text-button" onClick={p.onRetry}>Retry</button>}</div>{p.cloudMessage&&<div className="cloud-error"><strong>Cloud sync needs attention</strong><span>{readableFirebaseError(p.cloudMessage)}</span><small>Your work on this device is still available. Try again in a moment.</small></div>}{saved.length>0&&<section className="saved-bots"><div className="demo-heading"><div className="demo-heading-copy"><span>YOUR LIBRARY</span><strong>Saved robots</strong></div></div>{saved.slice(0,8).map(bot=><button className="saved-bot-row" key={bot.id} onClick={()=>p.onCloudBot(bot)}><span><strong>{bot.name}</strong><small>{bot.asset} · {bot.lastBacktest?`${bot.lastBacktest.candleCount.toLocaleString()} candles last run`:'Not backtested yet'}</small></span><ArrowRight size={14}/></button>)}</section>}</>}
function BotLibrary({mobileNav,botCovers,bots,current,onCreate,onOpen,onOpenLocal,onRename,onDelete,onShare,shareDialog,onProfile,profileName,cloudStatus,cloudMessage,onRetry}:{mobileNav:React.ReactNode;botCovers:Record<string,string>;bots:CloudBot[];current:(Partial<Draft>&{created:boolean})|null;onCreate:()=>void;onOpen:(bot:CloudBot)=>void;onOpenLocal:(draft:any)=>void;onRename:(bot:CloudBot,name:string,localOnly:boolean)=>Promise<void>;onDelete:(bot:CloudBot,localOnly:boolean)=>Promise<void>;onShare:(bot:CloudBot)=>void;shareDialog:React.ReactNode;onProfile:()=>void;profileName:string;cloudStatus:string;cloudMessage:string;onRetry:()=>void}){
 const [search,setSearch]=useState(''),[sort,setSort]=useState('recent');
 const [action,setAction]=useState<{type:'rename'|'delete';bot:CloudBot;localOnly:boolean}|null>(null);
 const [value,setValue]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
 useEffect(()=>{if(!action||working)return;const onEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setAction(null)};window.addEventListener('keydown',onEscape);return()=>window.removeEventListener('keydown',onEscape)},[action,working]);
 const local=current?.created?current:null;
 const items=[...bots];
 if(local?.id&&!items.some(bot=>bot.id===local.id))items.unshift({id:local.id,name:local.name||'Untitled robot',asset:local.asset||'',prompt:local.prompt||'',code:local.code??starterCode,lastBacktest:null});
 const visibleItems=items.filter(bot=>`${bot.name} ${bot.asset} ${bot.prompt}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):0);
 const choose=(type:'rename'|'delete',bot:CloudBot,localOnly:boolean)=>{setAction({type,bot,localOnly});setValue(bot.name||'');setError('')};
 const submit=async()=>{if(!action||working)return;setWorking(true);setError('');try{if(action.type==='rename')await onRename(action.bot,value,action.localOnly);else await onDelete(action.bot,action.localOnly);setAction(null)}catch(cause){setError(cause instanceof Error?cause.message:'Could not update this robot.')}finally{setWorking(false)}};
 return <section className="bot-library" aria-label="My robot library"><header className="library-top"><div className="library-brand"><img className="brand-logo" src="/logo.png" alt=""/><span>Trading Vibes</span></div><div className={`library-sync ${cloudStatus==='error'?'error':''}`} title={cloudMessage||'Robot data sync status'}><i/>{cloudStatus==='saving'?'Saving robot…':cloudStatus==='connecting'?'Syncing…':cloudStatus==='error'?'Sync issue':'Cloud saved'}{cloudStatus==='error'&&<button onClick={onRetry}>Retry</button>}</div><div className="library-actions"><ProfileButton onClick={onProfile} label={profileName}/><button className="primary library-create" onClick={onCreate}><Plus size={16}/> Create a robot</button></div></header><section className="library-content">{cloudStatus==='error'&&<div className="library-sync-notice" role="alert"><div><strong>Cloud sync needs attention</strong><p>{cloudMessage||'Your saved robots could not be loaded. Retry to reconnect.'}</p></div><button className="ghost" onClick={onRetry}>Retry connection</button></div>}{cloudStatus==='connecting'&&<p role="status" className="library-loading">Loading your saved robots…</p>}<div className="library-eyebrow"><span className="eyebrow-dot"/> STRATEGY WORKSPACE</div><div className="library-title-row"><div><h1>Your robots</h1><p>Pick up where you left off, or build a new strategy.</p></div><span className="library-count">{items.length} {items.length===1?'ROBOT':'ROBOTS'}</span></div><div className="economy-search library-search"><input aria-label="Search my bots" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search bots or assets…"/><select aria-label="Sort my bots" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Saved order</option><option value="name">Name A–Z</option></select></div>{mobileNav}{items.length?<>{visibleItems.length?<div className="robot-grid">{visibleItems.map(bot=>{const localOnly=Boolean(local?.id===bot.id&&!bots.some(saved=>saved.id===bot.id));const money=bot.lastBacktest?.money,net=money?.netProfit;return <article className="robot-card" key={bot.id}><div className="economy-private-cover"><img src={botCovers[bot.id]||'/robot-cover.svg'} alt=""/></div><div className="robot-card-top"><span className="robot-icon"><Bot size={18}/></span><span className="robot-market">{bot.asset}</span></div><button type="button" className="robot-card-open" onClick={()=>localOnly?onOpenLocal({...bot,created:true}):onOpen(bot)}><strong className="robot-name">{bot.name||'Untitled robot'}</strong><span className="robot-summary">{bot.prompt?.trim()||'No strategy description yet.'}</span></button><div className="robot-card-foot">{typeof net==='number'&&Number.isFinite(net)?<span className={net>=0?'robot-positive':'robot-negative'}>{net>0?'+':''}{new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(net)} <small>{Number.isFinite(money?.returnPercent)?`${money!.returnPercent>=0?'+':''}${money!.returnPercent.toFixed(2)}% · `:''}simulated</small></span>:<span className="robot-muted">{localOnly?'Local draft':bot.lastBacktest?'Backtest saved · view results':'Ready to backtest'}</span>}<div className="robot-card-actions"><button type="button" title="Share robot" aria-label={`Share ${bot.name}`} onClick={()=>onShare(bot)}><Share2 size={15}/></button><button type="button" title="Rename robot" aria-label={`Rename ${bot.name}`} onClick={()=>choose('rename',bot,localOnly)}><Pencil size={15}/></button><button type="button" title="Delete robot" aria-label={`Delete ${bot.name}`} onClick={()=>choose('delete',bot,localOnly)}><Trash2 size={15}/></button></div></div></article>})}</div>:<div className="robot-empty"><strong>No matching bots.</strong><p>Try another name or asset.</p><button className="ghost" onClick={()=>setSearch('')}>Clear search</button></div>}</>:cloudStatus==='connecting'||cloudStatus==='error'?null:<div className="robot-empty"><span className="robot-empty-icon"><Bot size={22}/></span><strong>Your robot library is ready.</strong><p>Create your first strategy and it will appear here for quick access.</p><button className="primary" onClick={onCreate}><Plus size={15}/> Create your first robot</button></div>}</section><footer className="library-footer"><span>PRIVATE STRATEGY WORKSPACE</span><span>YOUR ROBOTS · YOUR RULES</span></footer>
 {shareDialog}
 {action&&<div className="trade-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!working)setAction(null)}}><section className="trade-modal robot-action-modal" role="alertdialog" aria-modal="true" aria-labelledby="robot-action-title"><h2 id="robot-action-title">{action.type==='delete'?'Are you sure?':'Rename robot'}</h2>{action.type==='delete'?<p>Delete <strong>{action.bot.name}</strong> and its saved code, versions, chat, and backtest? This cannot be undone.</p>:<label>Robot name<input autoFocus maxLength={64} value={value} onChange={event=>setValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void submit()}}/></label>}{error&&<p className="robot-action-error" role="alert">{error}</p>}<div className="robot-action-buttons"><button className="ghost" disabled={working} onClick={()=>setAction(null)}>Cancel</button><button className="primary" disabled={working||(action.type==='rename'&&!value.trim())} onClick={()=>void submit()}>{working?'Working…':action.type==='delete'?'Delete robot':'Save name'}</button></div></section></div>}
 </section>;
}
function AuthPage({client,initError,onBack,onSuccess}:{client:CloudClient|null;initError:string;onBack:()=>void;onSuccess:()=>Promise<void>}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const finish=async(action:(ready:CloudClient)=>Promise<void>)=>{
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const ready=client||await connectFirebase();
   if(!ready)throw Error('Sign-in is temporarily unavailable. Please try again.');
   await action(ready);
  }catch(reason){setError(readableFirebaseError(reason))}
  finally{setBusy(false)}
 };
 const submit=(event:FormEvent)=>{
  event.preventDefault();
  void finish(async ready=>{await ready.signIn(email.trim(),password);await onSuccess()});
 };
 const resetPassword=()=>{
  if(!email.trim()){setError('Enter your email address to request a password reset.');return}
  void finish(async ready=>{
   try{await ready.sendPasswordReset(email.trim())}
   catch(reason){if(!(reason&&typeof reason==='object'&&'code' in reason&&reason.code==='auth/user-not-found'))throw reason}
   setNotice('If an account uses that email, you’ll receive a password reset link.');
  });
 };
 return <main className="tv-auth">
  <header className="auth-nav"><button className="landing-brand" onClick={onBack}><img src="/logo.png" alt=""/><span>TRADING VIBES</span></button><button className="auth-back" onClick={onBack}><ArrowLeft size={14}/> BACK TO HOME</button></header>
  <div className="auth-layout">
   <section className="auth-aside"><span className="landing-kicker"><i/> INVITE-ONLY ACCESS</span><h1>Welcome to<br/><em>your workspace.</em></h1><p>Talk markets with VIBES, test your ideas and manage your strategies in one place.</p><span className="auth-aside-foot">PRIVATE WORKSPACE · ACCOUNT SYNC</span></section>
   <section className="auth-card"><div className="auth-card-heading"><span>TRADING VIBES ACCOUNT</span><h2>Sign in</h2><p>Use the email and password provided with your invitation.</p></div>
    {(error||initError)&&<div className="auth-error" role="alert">{error||initError}</div>}{notice&&<div className="auth-success" role="status">{notice}</div>}
    <form onSubmit={submit} className="auth-form"><label>Email<input type="email" autoComplete="username" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@example.com"/></label>
     <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)}/></label>
     <button type="button" className="auth-forgot" onClick={resetPassword} disabled={busy}>Forgot password?</button>
     <button className="auth-submit" type="submit" disabled={busy}>{busy?'Please wait…':'Sign in'} <ArrowUpRight size={15}/></button>
    </form>
   </section>
  </div><footer className="auth-footer"><span>TRADING VIBES</span><span>INVITE-ONLY TRADING WORKSPACE</span></footer>
 </main>;
}
function ProfileButton({onClick,label}:{onClick:()=>void;label:string}){return <button type="button" className="profile-button" onClick={onClick} aria-label="Open profile settings" title={label||'Profile settings'}><UserRound size={15}/><span>{label?label.split('@')[0]:'Profile'}</span></button>}
function ProfilePage({onDashboard,client,cloudStatus,cloudMessage,onBack,onRetry,onChanged,onSignOut}:{client:CloudClient|null;cloudStatus:string;cloudMessage:string;onBack:()=>void;onRetry:()=>void;onChanged:()=>void;onSignOut:()=>Promise<void>;onDashboard:(mode:'creator'|'customer')=>void}){
 const [displayName,setDisplayName]=useState(()=>{try{return client?.getProfile()?.displayName||''}catch{return ''}}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const profile=(()=>{try{return client?.getProfile()??null}catch{return null}})();
 const saveName=async(event:FormEvent)=>{event.preventDefault();if(!client)return;setBusy(true);setError('');setNotice('');try{await client.updateDisplayName(displayName);setNotice('Profile updated.');onChanged()}catch(reason){setError(readableFirebaseError(reason))}finally{setBusy(false)}};
 const logout=async()=>{if(!client)return;setBusy(true);setError('');try{await onSignOut()}catch(reason){setError(readableFirebaseError(reason));setBusy(false)}};
 return <main className="profile-shell"><header className="profile-top"><button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft size={17}/></button><img className="brand-logo small" src="/logo.png" alt=""/><strong>Trading Vibes</strong><span>PROFILE SETTINGS</span></header><section className="profile-content"><div className="profile-heading"><span className="profile-avatar"><UserRound size={23}/></span><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR ACCOUNT</div><h1>Profile &amp; cloud storage</h1><p>Secure your workspace so your robots, versions, and conversations stay with your account.</p></div></div><div className="profile-status-card"><div><span className={`profile-status-dot ${cloudStatus==='connected'?'online':''}`}/><strong>{cloudStatus==='connected'?'Cloud storage connected':cloudStatus==='connecting'?'Connecting to cloud storage…':cloudStatus==='error'?'Cloud connection needs attention':'Local mode'}</strong><small>{cloudStatus==='connected'?(profile?.isAnonymous?'Guest profile · invitation required':'Your workspace is syncing to your account'):cloudMessage?readableFirebaseError(cloudMessage):'Sign in to keep your workspace synced across sessions.'}</small></div>{cloudStatus==='error'&&<button type="button" className="ghost" onClick={onRetry}>Retry connection</button>}</div>{error&&<div className="profile-feedback error" role="alert">{error}</div>}{notice&&<div className="profile-feedback success" role="status">{notice}</div>}{!client?<div className="profile-form-card"><h2>Cloud sync is unavailable</h2><p>{cloudMessage?readableFirebaseError(cloudMessage):'Your account connection needs attention. Please retry.'}</p><button className="primary" onClick={onRetry}>Retry connection</button></div>:profile?.isAnonymous?<div className="profile-form-card"><h2>Invitation required</h2><p>Sign in with your invited account to open its workspace.</p><a className="primary" href="/sign-in">Sign in</a></div>:<div className="profile-form-card"><div className="profile-card-heading"><div><span className="profile-kicker">ACCOUNT</span><h2>{profile?.email||'Signed in'}</h2></div><span className="profile-secure"><Check size={13}/> Account secured</span></div><p>Your robots, versions, and conversations sync to your account automatically and are available when you sign in on another device.</p><form className="profile-form" onSubmit={saveName}><label>DISPLAY NAME<input autoComplete="name" value={displayName} onChange={event=>setDisplayName(event.target.value)} placeholder="Your name" maxLength={60}/></label><button className="primary profile-submit" type="submit" disabled={busy}>{busy?'Saving…':'Save profile'}</button></form><button type="button" className="profile-signout" onClick={()=>void logout()} disabled={busy}><LogOut size={14}/> Sign out</button></div>}<div className="market-buttons"><button className="primary" onClick={()=>onDashboard('customer')}>My trading</button><button className="ghost" onClick={()=>onDashboard('creator')}>Creator dashboard</button></div><div className="profile-storage-note"><strong>Cloud storage connected</strong><span>Your robots, versions, and conversations stay with your account.</span><span>Changes sync automatically as you work.</span></div></section></main>
}
function CodeWarningDialog({dontShow,setDontShow,onCancel,onContinue}:{dontShow:boolean;setDontShow:(value:boolean)=>void;onCancel:()=>void;onContinue:()=>void}){
 return <div className="trade-modal-backdrop warning-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onCancel()}}><section className="trade-modal code-warning" role="alertdialog" aria-modal="true" aria-labelledby="code-warning-title"><span className="warning-icon"><ShieldAlert size={20}/></span><h2 id="code-warning-title">Editing the strategy can change how this robot runs</h2><p>Changes to the script affect its signals, entries, exits, and future backtest results. A code change can also make previous results no longer match the current strategy. Review your edits and run a fresh backtest before relying on them.</p><label className="warning-remember"><input type="checkbox" checked={dontShow} onChange={event=>setDontShow(event.currentTarget.checked)}/> Don’t show me this again</label><div className="warning-actions"><button className="ghost" onClick={onCancel}>Cancel</button><button className="primary" onClick={onContinue}>Continue to strategy <ArrowRight size={15}/></button></div></section></div>
}
function Workspace(p:any){
 const chooseTrade=(trade:Trade)=>{p.setSelectedTrade(trade);p.setTradeDetailsOpen(false);p.setFocusTrade(trade);p.setView('chart');p.setTab('chart');p.setOutputTab('trades');p.setTerminalOpen(true)};
 return <section className="main-column">
  <div className="workspace-head"><div className="workspace-tabs"><button className={p.view==='code'?'selected':''} onClick={p.requestCodeView}><Code2 size={14}/> Strategy.js <span className="unsaved-dot"/></button><button className={p.view==='chart'?'selected':''} onClick={()=>{p.setView('chart');p.setTab('chart')}}><Activity size={14}/> {p.propLiveMode?'LIVE chart':'Backtest chart'}</button></div><div className="workspace-controls">{<div className="code-history-actions"><span className={`cloud-save-state ${p.cloudStatus==='error'?'failed':''}`} title={p.cloudMessage||'Robot code and chats sync to your private cloud account.'}><i/>{p.cloudStatus==='saving'?'Saving':p.cloudStatus==='error'?'Sync issue':p.cloudStatus==='local'?'Local only':'Saved'}</span><button className="icon-label" title="Undo" aria-label="Undo code edit" disabled={!!p.liveLocked||p.liveCheck!=='ready'} onClick={p.undoCode}><Undo2 size={15}/></button><button className="icon-label" title="Redo" aria-label="Redo code edit" disabled={!!p.liveLocked||p.liveCheck!=='ready'} onClick={p.redoCode}><Redo2 size={15}/></button><span className="history-action-divider"/><button className="icon-label save-version-action" title="Save this version" aria-label="Save this version" disabled={!!p.liveLocked||p.liveCheck!=='ready'} onClick={p.saveVersion}><Save size={15}/><span>Save version</span></button></div>}</div></div>
  {(p.liveLocked||p.liveCheck==='unavailable')&&<div className="live-workspace-notice" role="status">{p.liveLocked?'The approved live strategy is running or has an unresolved order.':'Live account status cannot be confirmed.'} The strategy is read-only and backtesting is paused. <button className="ghost" onClick={p.onCopy} disabled={!!p.busy}>Create a copy</button></div>}
  {p.availabilityError&&<div className="import-notice import-error" role="alert">{p.availabilityError}<button className="text-button" onClick={p.reloadAvailability}>Retry</button></div>}
  {p.unavailableTimeframes?.length>0&&<div className="import-notice import-error" role="status">This strategy requests {p.unavailableTimeframes.join(', ')}. Available price history: {p.availableTimeframes.join(', ')||'none'}. Edit its timeframe or add matching history.</div>}
  <div className="workspace-content" style={{display:p.view==='code'?'':'none'}}><div className="editor-filebar"><span><FileCode2 size={14}/> strategy.js</span><span className="js-badge">JS</span></div><Editor height="100%" defaultLanguage="javascript" theme={p.theme==='light'?'vs':'vs-dark'} value={p.code} onChange={(value:string|undefined)=>{if(!p.liveLocked&&p.liveCheck==='ready')p.setCode(value||'')}} onMount={(editor:any)=>p.editorRef.current=editor} options={{readOnly:!!p.liveLocked||p.liveCheck!=='ready',minimap:{enabled:false},fontSize:13,lineHeight:22,fontFamily:'JetBrains Mono, monospace',fontLigatures:true,automaticLayout:true,scrollBeyondLastLine:false,padding:{top:16,bottom:20},renderLineHighlight:'gutter',wordWrap:'on',tabSize:2,overviewRulerBorder:false,scrollbar:{verticalScrollbarSize:8,horizontalScrollbarSize:8},suggestOnTriggerCharacters:true}}/></div>
  <div className="chart-workspace" style={{display:p.view==='chart'?'':'none'}}>
   {p.propLiveMode?<><div className="chart-stats">   <div><span>PROPDAO · SIMULATED CAPITAL</span><strong className={p.propLive?.running?'green':'red'}>{p.propLive?.running?'● LIVE':p.propLive?.uncertain?'STATUS UNKNOWN':'STOPPED'}</strong></div>   <div><span>LIVE ACCOUNT EQUITY</span><strong>{Number.isFinite(p.propLive?.risk?.equity)?'$'+p.propLive.risk.equity.toFixed(2):'—'}</strong></div>   <div><span>OPEN POSITIONS</span><strong>{p.propLive?.positions?.length??0}</strong></div>   <div><span>FEED · {p.propMarket?.timeframe?.toUpperCase()||'—'}</span><strong className={p.propMarket?.fresh?'green':'red'}>{p.propMarket?.fresh?'LIVE':p.propMarket?.error?'OFFLINE':'STALE'}</strong></div>   </div>{p.propMarket?.error&&<div className="import-notice import-error" role="alert">{p.propMarket.error}</div>}   <div className="chart-container" ref={p.chartRef} aria-label="Live Hyperliquid market candles for PropDAO execution; updating automatically"/>   {!p.propMarket?.candles?.length&&<p className="output-disclaimer">Connecting to the live price feed…</p>}</>:p.result?<><div className="chart-stats"><div><span>{p.propEvaluation?'PROFIT / LOSS · USDC':p.monetary?'NET PROFIT / LOSS':'NET RESULT · THEORY'}</span><strong className={(p.propEvaluation?.profit??p.monetary?.netProfit??p.result.metrics.netReturn)>=0?'green':'red'}>{p.propEvaluation?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(p.propEvaluation.profit):p.monetary?new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(p.monetary.netProfit):`${p.result.metrics.netReturn>=0?'+':''}${fmt(p.result.metrics.netReturn)}R`}</strong></div><div><span>TRADES</span><strong>{p.propEvaluation?.trades.length??p.monetary?.trades.length??p.result.metrics.trades}</strong></div><div><span>RETURN</span><strong>{p.propEvaluation?`${fmt(p.propEvaluation.profit/10,2)}%`:p.monetary?`${fmt(p.monetary.returnPercent,1)}%`:'—'}</strong></div><div><span>MAX DRAWDOWN</span><strong className="red">{p.propEvaluation?`${fmt(p.propEvaluation.maxObservedDrawdown/10,2)}%`:p.monetary?`${fmt(p.monetary.maxDrawdownPercent,1)}%`:`${fmt(p.result.metrics.maxDrawdown)}R`}</strong></div></div><div className="chart-container" ref={p.chartRef} aria-label="Backtest price chart. Select a trade marker to inspect its audit details."/></>:<div className="chart-empty"><div className="empty-chart-icon"><Activity size={24}/></div><span className="empty-kicker">PRICE HISTORY</span><strong>Run a backtest to view your chart.</strong><p>The chart shows the stored market prices and clickable trade markers.</p><button className="quiet-action" onClick={()=>p.backtest()} disabled={!!p.liveLocked||p.liveCheck!=='ready'||p.busy==='backtest'||!p.code?.trim()||!p.availableDates.length}>Run backtest</button></div>}
  </div>
  <OutputDock liveMode={p.propLiveMode} propLive={p.propLive} onPropLiveRefresh={p.onPropLiveRefresh} isPropDAO={p.venue==='propdao'} propEvaluation={p.propEvaluation} monetary={p.monetary} asset={p.asset} timeframe={p.result?.timeframe} from={p.from} to={p.to} logs={p.logs} result={p.result} selectedTrade={p.selectedTrade} showTradeModal={p.showTradeModal} busy={p.busy} active={p.outputTab} collapsed={!p.terminalOpen} onTabChange={p.setOutputTab} onCollapse={()=>p.setTerminalOpen(!p.terminalOpen)} onClear={p.clearLogs} onDeleteBacktest={p.deleteSavedBacktest} onStop={p.cancelBacktest} onSelectTrade={chooseTrade} onClearSelectedTrade={()=>{p.setSelectedTrade(null);p.setTradeDetailsOpen(false)}} onAuditTrade={p.onAuditTrade} versions={p.versions} versionsLoading={p.versionsLoading} versionError={p.versionError} onLoadVersion={p.loadVersion} onRenameVersion={p.renameVersion} onDeleteVersion={p.deleteVersion}/>
 </section>;
}
function tradeMarkers(trades:Trade[],currentTime:number){
 const markers:any[]=[];
 for(const trade of trades){
  if(trade.entryTime>currentTime)continue;
  markers.push({id:`trade:${trade.id}:entry`,time:trade.entryTime as any,position:trade.side==='LONG'?'belowBar':'aboveBar',color:trade.side==='LONG'?'#39d6a6':'#fa7380',shape:trade.side==='LONG'?'arrowUp':'arrowDown',text:''});
  if(trade.exitTime<=currentTime)markers.push({id:`trade:${trade.id}:exit`,time:trade.exitTime as any,position:trade.side==='LONG'?'aboveBar':'belowBar',color:trade.pnl>=0?'#39d6a6':'#fa7380',shape:'circle',text:''});
 }
 return markers;
}
function ChatContextModal({context,onClose}:{context:ChatContext|null;onClose:()=>void}){
 useEffect(()=>{if(!context)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[context,onClose]);
 if(!context)return null;const data=context.data;const rows=[['Trade ID',data.tradeId],['Market / timeframe',`${data.asset} · ${data.timeframe}`],['Side',data.side],['Entry',`${data.entry} · ${data.entryTime}`],['Exit',`${data.exit} · ${data.exitTime}`],['Stop / target',`${data.stopLoss} / ${data.takeProfit}`],['Result',`${data.pnlR}R · ${data.exitReason}`]];
 return <div className="trade-modal-backdrop context-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="trade-modal context-modal" role="dialog" aria-modal="true" aria-labelledby="context-title"><header><div><span className="context-eyebrow">AI AUDIT CONTEXT</span><h2 id="context-title">{context.label}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close context"><X size={17}/></button></header><div className="context-modal-body"><div className="context-facts">{rows.map(([label,value])=><div key={label}><span>{label}</span><strong>{String(value??'—')}</strong></div>)}</div><p className="context-limit">{data.contextLimit}</p><details><summary>Price candles · before, during and after</summary><pre>{JSON.stringify(data.contextCandles,null,2)}</pre></details><details><summary>Robot source</summary><pre>{data.strategy}</pre></details><details><summary>Backtest metrics</summary><pre>{JSON.stringify(data.backtestMetrics,null,2)}</pre></details></div></section></div>
}
function hasLastDraft(){try{return Boolean(localStorage.getItem('tradefoundry:last-draft'))}catch{return false}}
function conciseAssistantText(text:string){return text.replace(/```(?:js|javascript)\b[\s\S]*?(?:```|$)/gi,'').trim()}
function err(e:unknown){return e instanceof Error?e.message:'Unknown error'}function extractCode(text:string){return extractCodeIfPresent(text)||text.slice(text.search(/export\s+const\s+config\b/)>=0?text.search(/export\s+const\s+config\b/):0).trim()}function extractCodeIfPresent(text:string){const match=text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);if(match)return match[1].trim();const start=text.search(/export\s+const\s+config\b/);return start>=0?text.slice(start).trim():''}
export default App;
