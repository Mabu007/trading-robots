import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Activity,ArrowLeft,ArrowRight,BarChart3,BookOpen,CalendarDays,Camera,CheckCircle2,ChevronRight,Clock3,Download,FastForward,Flag,Maximize2,Minimize2,Pause,Play,RotateCcw,Settings2,SkipBack,SkipForward,GripHorizontal,Undo2,Redo2,ZoomIn,ZoomOut,LocateFixed,ChevronDown,ChevronUp,Target,TrendingDown,TrendingUp,Trophy,X} from 'lucide-react';
import {createChart,CandlestickSeries,LineSeries,createSeriesMarkers,ColorType} from 'lightweight-charts';
import {historicalData} from '../history-cache';
import {installChartTools} from '../chart-tools';
import {saveLocalHistory,readLocalHistory,type PracticeRecord} from '../practice-history';
import {rebaseDaySession} from '../replay-history-migration';
import {newReplayTimeline,recordReplayDecision,replayTo,type ReplayTimeline} from '../replay-timeline';
import type {CloudClient} from '../firebase';
import type {AppTheme} from '../theme';
import {aggregateReplayBars,beginReplay,NEW_REPLAY_COSTS,replayAdvance,replayClose,replayEMA,replayFx,replayEnter,replayPlacePending,replayCancelPending,replayMark,replayMetrics,replayModifyPosition,replayPositions,replayVisibleBars,validateReplayBars,validateReplayCosts,type ReplayBar,type ReplayCosts,type ReplaySession,type ReplaySide} from '../market-replay-engine';
import {ReplayIndicators} from './ReplayIndicators';
import type {IndicatorSpec} from '../replay-indicators';
import {ReplayPositionPreview,type PositionPreview} from './ReplayPositionPreview';
import {visibleArchivedTrades} from '../replay-journal';
import {getLocalWorkspace,saveLocalWorkspace,formatPracticeDuration,type StoredReplayWorkspace,renameLocalWorkspace,listLocalWorkspaces,migrateLegacyReplaySaves} from '../replay-sessions';
import './market-replay.css';

type Props={client:CloudClient;theme:AppTheme;onClose:()=>void;onHistoryChange?:()=>void;initialDay?:string;initialReviewTradeId?:string;initialRecord?:PracticeRecord};
const price=(value:number)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:3}).format(value);
const utc=(timestamp:number)=>new Date(timestamp*1000).toLocaleString('en-GB',{timeZone:'UTC',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const yesterday=()=>new Date(Date.now()-86400000).toISOString().slice(0,10);
const number=(text:string)=>Number(text);
function exportJournal(session:ReplaySession,notes:Record<string,string>,day:string,costs:ReplayCosts){
 const currency=costs.currency||'USD';
 const header=['Side','Entry (UTC)','Exit (UTC)','Quantity oz','Entry','Stop','Target','Exit','Reason','Gross '+currency,'Total fees '+currency,'Net '+currency,'Balance '+currency,'Notes'];
 const clean=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
 const rows=[header,...session.trades.map(t=>[t.side,new Date(t.entryTime*1000).toISOString(),new Date(t.exitTime*1000).toISOString(),t.quantity,t.entry,t.stop,t.target,t.exit,t.reason,t.gross,t.entryFee+t.exitFee,t.net,t.balanceAfter,notes[t.id]||''])];
 const csv=rows.map(row=>row.map(clean).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download='trading-vibes-replay-'+day+'.csv';anchor.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),1500);
}
const speeds=[0.5,1,2,4,8,16] as const;
export function MarketReplay({client,theme,onClose,onHistoryChange,initialDay,initialReviewTradeId,initialRecord}:Props){
 const [day,setDay]=useState(()=>initialDay||yesterday()),[startClock,setStartClock]=useState('08:00'),[startingBalance,setStartingBalance]=useState('10000');
 const [asset,setAsset]=useState<'XAUUSD'>('XAUUSD');
 const [showTicket,setShowTicket]=useState(false),[showReview,setShowReview]=useState(false);
 const [ticketXY,setTicketXY]=useState<{x:number;y:number}|null>(null);
 const [isMobile,setIsMobile]=useState(false),[ticketMinimized,setTicketMinimized]=useState(false);
 useEffect(()=>{
  const media=window.matchMedia('(max-width: 720px), (orientation: landscape) and (max-height: 540px) and (max-width: 980px)');
  const sync=()=>{setIsMobile(media.matches);setTicketXY(null);if(!media.matches)setTicketMinimized(false)};
  sync();
  media.addEventListener?.('change',sync);
  return()=>media.removeEventListener?.('change',sync);
 },[]);
 const ticketDrag=useRef<{x:number;y:number;left:number;top:number;width:number;height:number}|null>(null);
 const [attemptId,setAttemptId]=useState<string>(()=>crypto.randomUUID()),[finished,setFinished]=useState(false);
 const [sessionName,setSessionName]=useState(''),[nameEditing,setNameEditing]=useState(false);
 const [elapsedSeconds,setElapsedSeconds]=useState(0),[startedAt,setStartedAt]=useState(()=>new Date().toISOString());
 const [savedSessions,setSavedSessions]=useState<PracticeRecord[]>([]),[renameId,setRenameId]=useState<string|null>(null),[renameDraft,setRenameDraft]=useState('');
 const [markerTrade,setMarkerTrade]=useState<{trade:NonNullable<PracticeRecord['trades']>[number];event:'entry'|'exit';pinned?:boolean}|null>(null);
 const [reviewTrade,setReviewTrade]=useState<NonNullable<PracticeRecord['trades']>[number]|null>(()=>initialRecord?.trades?.find(t=>t.id===initialReviewTradeId)||null);
 const reviewing=Boolean(reviewTrade);
 const initialized=useRef(false),nextBusyRef=useRef(false),nextUnavailableRef=useRef(false),snapshotRef=useRef<()=>void>(()=>{});
 const markTargetsRef=useRef<Array<{time:number;trade:NonNullable<PracticeRecord['trades']>[number];event:'entry'|'exit'}>>([]);
 const [bars,setBars]=useState<ReplayBar[]>([]),[session,setSession]=useState<ReplaySession|null>(null),[firstIndex,setFirstIndex]=useState(0);
 const [timeline,setTimeline]=useState<ReplayTimeline|null>(null);
 const timelineRef=useRef<ReplayTimeline|null>(null);
 const updateTimeline=(next:ReplayTimeline|null)=>{timelineRef.current=next;setTimeline(next)};
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [showDate,setShowDate]=useState(false),[dateDraft,setDateDraft]=useState('');
 const [loadingEarlier,setLoadingEarlier]=useState(false);
 const barsRef=useRef<ReplayBar[]>([]),firstIndexRef=useRef(0),earlierBusyRef=useRef(false),noEarlierRef=useRef(false),earlierRetryAtRef=useRef(0),loadEarlierRef=useRef<()=>void>(()=>{}),pendingRangeRef=useRef<{from:number;to:number;added:number}|null>(null);
 barsRef.current=bars;firstIndexRef.current=firstIndex;
 const [playing,setPlaying]=useState(false),[speed,setSpeed]=useState<number>(2),[timeframe,setTimeframe]=useState<1|5|15|60|240|1440>(1);
 const [expanded,setExpanded]=useState(false),[showIndicators,setShowIndicators]=useState(false),[showCosts,setShowCosts]=useState(false);
 const [indicators,setIndicators]=useState<IndicatorSpec[]>([]);
 const indicatorSeriesRef=useRef<Array<{spec:IndicatorSpec;series:any[]}>>([]);
 const [preview,setPreview]=useState<PositionPreview|null>(null);
 const [orderType,setOrderType]=useState<'market'|'limit'|'stop'>('market'),[orderPrice,setOrderPrice]=useState(''),[pickingPrice,setPickingPrice]=useState(false);
 const pickingRef=useRef(false);
 const [quantity,setQuantity]=useState('0.01'),[stopDistance,setStopDistance]=useState('6'),[targetDistance,setTargetDistance]=useState('12');
 const [adjustStop,setAdjustStop]=useState(''),[adjustTarget,setAdjustTarget]=useState('');
 const [costs,setCosts]=useState<ReplayCosts>({...NEW_REPLAY_COSTS}),[notes,setNotes]=useState(''),[annotations,setAnnotations]=useState<Record<string,string>>({});
 const money=(value:number)=>new Intl.NumberFormat(costs.currency==='ZAR'?'en-ZA':'en-US',{style:'currency',currency:costs.currency||'USD',maximumFractionDigits:2}).format(value);
 const [selectedTrade,setSelectedTrade]=useState<string|null>(null);
 const [selectedPositionId,setSelectedPositionId]=useState(''),[showNewOrder,setShowNewOrder]=useState(false),[managePending,setManagePending]=useState(true);
 const [progressTime,setProgressTime]=useState(0);
 const sessionRef=useRef<ReplaySession|null>(null),chartDiv=useRef<HTMLDivElement|null>(null),modalRef=useRef<HTMLElement|null>(null);
 const drawingRef=useRef<ReturnType<typeof installChartTools>|null>(null);
 const chartRef=useRef<{chart:any;series:any;ema20:any;ema50:any;markers:any;lines:any[];lastBarTime?:number;lastBarCount?:number;firstBarTime?:number;lastTimeframe?:number;lastBarsRef?:ReplayBar[]} |null>(null);
 const uid=client.getProfile()?.uid||'local';
 const setCurrent=(next:ReplaySession)=>{sessionRef.current=next;setSession(next)};
 const recordDecision=(next:ReplaySession)=>{if(timelineRef.current)updateTimeline(recordReplayDecision(timelineRef.current,next));setCurrent(next)};
 const currentBar=session?bars[session.index]:null;
 const replayAtEnd=Boolean(session&&finished);
 const metrics=useMemo(()=>session&&currentBar?replayMetrics(session,bars,costs):null,[session,bars,costs,currentBar]);
 const visible=useMemo(()=>session?replayVisibleBars(bars,session):[],[bars,session]);
 const aggregates=useMemo(()=>aggregateReplayBars(visible,timeframe),[visible,timeframe]);
 const mark=useMemo(()=>session&&currentBar?replayMark(session,currentBar,costs):null,[session,currentBar,costs]);
 const sessionOpen=Boolean(session);
 const positions=session?replayPositions(session):[];
 const selectedPosition=positions.find(p=>p.id===selectedPositionId)||positions[0]||null;
 const selectedMark=session&&currentBar&&selectedPosition?replayMark({...session,position:selectedPosition,positions:[selectedPosition]},currentBar,costs):null;
 useEffect(()=>{setAdjustStop(selectedPosition?String(selectedPosition.stop):'');setAdjustTarget(selectedPosition?String(selectedPosition.target):'')},[selectedPosition?.id]);
 const riskPerOunce=((preview?Math.abs(preview.entry-preview.stop):Number(stopDistance))+costs.slippage+2*costs.feePerOunce)*replayFx(costs);
 const estimatedRisk=Math.max(0,riskPerOunce*Number(quantity)||0);
 const riskPercent=mark&&mark.equity>0?estimatedRisk/mark.equity*100:0;
 const recommendedSize=mark&&riskPerOunce>0?Math.max(0.01,Math.floor(mark.equity*.01/riskPerOunce*100)/100):0;
 const start=async(targetDay=day,resumeId?:string,cloudRecord?:PracticeRecord,reviewingTrade?:boolean)=>{
  const selectedId=resumeId||crypto.randomUUID();
  const stored=getLocalWorkspace(uid,selectedId)||cloudRecord?.snapshot;
  const reviewingThis=Boolean(reviewingTrade&&initialReviewTradeId&&cloudRecord?.trades?.some(t=>t.id===initialReviewTradeId));
  if(loading)return;
  // Flush the current named workspace before switching dates.
  if(sessionRef.current&&targetDay!==day&&!reviewing)snapshotRef.current();
  {const day=targetDay;
  setLoading(true);setPlaying(false);setError('');setNotice('');noEarlierRef.current=false;earlierRetryAtRef.current=0;
  try{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>yesterday())throw Error('Choose a completed historical UTC day.');
   validateReplayCosts(costs);
   const begin=Date.parse(day+'T00:00:00Z');
   let historyStart=begin-2*86400000;
   if(stored&&Number.isFinite(stored.firstTimestamp)&&stored.firstTimestamp*1000<historyStart&&stored.firstTimestamp*1000>=begin-399*86400000)historyStart=Math.floor(stored.firstTimestamp/86400)*86400000;
   const [todayResult,historyResult]=await Promise.allSettled([
    historicalData({venue:'research',asset,timeframe:'m1',from:new Date(begin).toISOString(),to:new Date(Math.max(begin+86400000,stored?.lastTimestamp?stored.lastTimestamp*1000+60000:0)).toISOString()}),
    historicalData({venue:'research',asset,timeframe:'m1',from:new Date(historyStart).toISOString(),to:new Date(begin).toISOString()})
   ]);
   if(todayResult.status==='rejected')throw todayResult.reason;
   const history=historyResult.status==='fulfilled'?historyResult.value.candles:[];
   const candles=validateReplayBars([...history,...todayResult.value.candles].map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})));
   if(!todayResult.value.candles.length)throw Error('No historical candles on that date. Choose another trading day.');
   const clock=Date.parse(day+'T'+startClock+':00Z');
   if(!Number.isFinite(clock))throw Error('Select a valid UTC start time.');
   const desired=candles.findIndex(c=>c.time*1000>=clock);
   if(desired<0||desired>=candles.length-1)throw Error('No candles after the chosen replay start time. Try another session or date.');
   const initial=Math.max(0,desired),startEquity=number(startingBalance);
   let next=beginReplay(candles,initial,startEquity),resume=false,restoredFirst=initial;
   let restoredAttempt:string=crypto.randomUUID(),restoredNotes='',restoredAnnotations:Record<string,string>={},restoredTimeline:ReplayTimeline|null=null;
   try{
    const parsed=stored;
    if(parsed&&parsed.firstTimestamp!==candles[0].time)throw Error('Saved workspace needs older historical candles before it can safely resume. Your saved session is preserved.');
    if(parsed&&parsed.version===5&&parsed.day===day&&parsed.asset===asset&&parsed.session&&
      parsed.firstTimestamp===candles[0].time&&Number.isInteger(parsed.session.index)&&parsed.session.index<candles.length&&
      Number.isFinite(parsed.session.balance)&&Array.isArray(parsed.session.trades)&&parsed.costs.currency==='ZAR'){
     next=parsed.session;restoredFirst=Math.max(0,Math.min(parsed.firstIndex,next.index));
     restoredAttempt=parsed.id;restoredNotes=parsed.notes;restoredAnnotations=parsed.annotations||{};resume=true;
     validateReplayCosts(parsed.costs);setCosts(parsed.costs);
     if(parsed.timeline?.origin&&Array.isArray(parsed.timeline.decisions))restoredTimeline=parsed.timeline;
    }
   }catch(e){if(e instanceof Error&&e.message.startsWith('Saved workspace needs'))throw e;/* Preserve invalid snapshots without touching stored data. */}
   if(reviewingThis){
    const trade=cloudRecord!.trades!.find(t=>t.id===initialReviewTradeId)!;
    const at=candles.findIndex(c=>c.time>=trade.entryTime);
    if(at>=0){const index=Math.max(0,at-6);next=beginReplay(candles,index,stored?.session.initialBalance||startEquity);restoredFirst=index;restoredTimeline=null;resume=false;}
   }
   if(!resume)setCosts({...NEW_REPLAY_COSTS});
   setSessionName(stored?.name||cloudRecord?.name||sessionName.trim()||('Gold · '+day+' · '+startClock));
   setElapsedSeconds(stored?.elapsedSeconds||cloudRecord?.spentSeconds||0);setStartedAt(stored?.startedAt||cloudRecord?.startedAt||new Date().toISOString());
   setReviewTrade(reviewingThis?cloudRecord!.trades!.find(t=>t.id===initialReviewTradeId)!:null);nextUnavailableRef.current=false;
   setDay(day);setShowDate(false);setShowTicket(false);setShowReview(false);setTicketMinimized(false);setPreview(null);setAttemptId(reviewingThis?selectedId:resume?restoredAttempt:selectedId);setFinished(false);setNotes(restoredNotes);setAnnotations(restoredAnnotations);
   barsRef.current=candles;firstIndexRef.current=restoredFirst;setBars(candles);setFirstIndex(restoredFirst);updateTimeline(restoredTimeline||newReplayTimeline(next));setCurrent(next);
   const restored=replayPositions(next)[0];setSelectedPositionId(restored?.id||'');setAdjustStop(restored?String(restored.stop):'');setAdjustTarget(restored?String(restored.target):'');
   setPlaying(false);setProgressTime(Date.now());
   setNotice(''); // Never cover the chart's historical date and time on start.
  }catch(e){setError(e instanceof Error?e.message:'Historical candles unavailable. Try another date.')}
  finally{setLoading(false)}
  }
 };

 // A replay is a named, continuous, autosaved workspace.
 useEffect(()=>{
  if(!sessionOpen||reviewing)return;
  const timer=window.setInterval(()=>{if(!document.hidden)setElapsedSeconds(v=>v+1)},1000);
  return()=>window.clearInterval(timer);
 },[sessionOpen,reviewing]);
 useEffect(()=>{
  if(sessionOpen)return;let active=true;
  migrateLegacyReplaySaves(uid);
  const localRecords=readLocalHistory(uid).map(entry=>entry.record).filter(record=>record.snapshot?.version===5);
  const localIndex=listLocalWorkspaces(uid).map(item=>{
   const snapshot=getLocalWorkspace(uid,item.id);
   return snapshot?{id:item.id,kind:'free' as const,day:item.day,asset:'XAUUSD' as const,
    completedAt:item.updatedAt,candlesViewed:Math.max(0,snapshot.session.index-snapshot.firstIndex),tradeCount:snapshot.session.trades.length,
    net:snapshot.session.trades.reduce((n,t)=>n+t.net,0),currency:'ZAR' as const,notes:snapshot.notes,
    name:item.name,spentSeconds:item.elapsedSeconds,startedAt:snapshot.startedAt,
    annotations:snapshot.annotations,trades:snapshot.session.trades,snapshot}:null;
  }).filter((item):item is NonNullable<typeof item>=>item!==null);
  const byId=new Map(localIndex.map(item=>[item.id,item as PracticeRecord]));
  for(const record of localRecords)byId.set(record.id,record);
  const local=[...byId.values()];
  setSavedSessions(local);
  void client.listPracticeRecords().then(records=>{if(active){const all=new Map(local.map(record=>[record.id,record]));for(const record of records.filter(i=>i.snapshot?.version===5)){if(!all.has(record.id))all.set(record.id,record)}setSavedSessions([...all.values()].sort((a,b)=>b.completedAt.localeCompare(a.completedAt)))}}).catch(()=>{});
  return()=>{active=false};
 },[sessionOpen,client]);
 useEffect(()=>{
  if(!initialRecord||initialized.current)return;
  initialized.current=true;void start(initialRecord.day,initialRecord.id,initialRecord,Boolean(initialReviewTradeId));
 },[initialRecord]);
 const makeSnapshot=():StoredReplayWorkspace|null=>{
  const current=sessionRef.current,all=barsRef.current;
  if(!current||!all.length||reviewing)return null;
  return {version:5,id:attemptId,day,asset,name:sessionName||('Gold · '+day),firstTimestamp:all[0].time,
   lastTimestamp:all.at(-1)!.time,session:current,firstIndex:firstIndexRef.current,notes,costs,annotations,
   startedAt,elapsedSeconds,lastActiveAt:new Date().toISOString(),timeline:timelineRef.current||undefined};
 };
 const persistWorkspace=()=>{
  const snapshot=makeSnapshot();if(!snapshot)return;
  try{saveLocalWorkspace(uid,snapshot)}catch{setError('Cannot save replay on this device. Please free browser storage.');return}
  const archived=visibleArchivedTrades(uid,attemptId,snapshot.session.trades);
  const record:PracticeRecord={id:attemptId,kind:'free',asset,day,completedAt:snapshot.lastActiveAt,
   candlesViewed:snapshot.session.index-firstIndex,tradeCount:archived.length,net:archived.reduce((n,t)=>n+t.net,0),
   currency:'ZAR',notes,annotations,trades:archived,name:snapshot.name,spentSeconds:elapsedSeconds,
   startedAt,lastActiveAt:snapshot.lastActiveAt,snapshot};
  try{saveLocalHistory(uid,record)}catch{}
  void client.savePracticeRecord(record).then(()=>{saveLocalHistory(uid,record,true);onHistoryChange?.()}).catch(()=>{/* Queued for sync on My Progress. */});
 };
 snapshotRef.current=persistWorkspace;
 useEffect(()=>{
  if(!sessionOpen||reviewing)return;
  const timer=window.setInterval(()=>snapshotRef.current(),15000);
  const initial=window.setTimeout(()=>snapshotRef.current(),1100);
  return()=>{window.clearInterval(timer);window.clearTimeout(initial)};
 },[sessionOpen,attemptId,reviewing]);
 useEffect(()=>{
  if(!session||!bars.length||reviewing)return;
  const timer=window.setTimeout(()=>{const snapshot=makeSnapshot();if(snapshot)try{saveLocalWorkspace(uid,snapshot)}catch{}},850);
  return()=>window.clearTimeout(timer);
 },[session,bars,day,attemptId,sessionName,notes,annotations,costs,elapsedSeconds,reviewing]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),2800);return()=>window.clearTimeout(timer)},[notice]);
 useEffect(()=>{const reset=()=>setTicketXY(null);window.addEventListener('resize',reset);return()=>window.removeEventListener('resize',reset)},[]);
 const persistLatestTrades=()=>snapshotRef.current();
 const renameSaved=async(record:PracticeRecord)=>{
  const name=renameDraft.trim().slice(0,80);if(!name)return;
  const updated:PracticeRecord={...record,name,snapshot:record.snapshot?{...record.snapshot,name}:undefined};
  if(updated.snapshot){try{saveLocalWorkspace(uid,updated.snapshot)}catch{}}
  else renameLocalWorkspace(uid,record.id,name);
  setSavedSessions(items=>items.map(item=>item.id===record.id?updated:item));setRenameId(null);
  try{await client.savePracticeRecord(updated)}catch{setNotice('Renamed on this device. Account sync will retry when online.')}
 };
 const loadEarlier=async()=>{
  const currentBars=barsRef.current;if(earlierBusyRef.current||noEarlierRef.current||Date.now()<earlierRetryAtRef.current||!currentBars.length||!sessionRef.current)return;
  if(currentBars.length>=50000){noEarlierRef.current=true;setNotice('This device has reached the 50,000-candle chart limit.');return}
  const boundary=Math.floor(currentBars[0].time/86400)*86400000;
  earlierBusyRef.current=true;setLoadingEarlier(true);
  try{
   const history=await historicalData({venue:'research',asset,timeframe:'m1',from:new Date(boundary-2*86400000).toISOString(),to:new Date(boundary).toISOString()});
   const older=history.candles.filter(c=>c.time<currentBars[0].time).map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close}));
   const latest=barsRef.current,current=sessionRef.current;
   if(!current||!latest.length||latest[0].time!==currentBars[0].time)return;
   if(!older.length){noEarlierRef.current=true;setNotice('No earlier candles were returned for this range.');return}
   if(latest.length+older.length>50000){noEarlierRef.current=true;setNotice('This device has reached the 50,000-candle chart limit.');return}
   const combined=validateReplayBars([...older,...latest]),rebased=rebaseDaySession(current,latest,older.length);
   if(!rebased)throw Error('Earlier candles could not be safely attached to this replay.');
   if(timelineRef.current){const origin=rebaseDaySession(timelineRef.current.origin,latest,older.length),decisions=timelineRef.current.decisions.map(item=>rebaseDaySession(item,latest,older.length));if(!origin||decisions.some(item=>!item))throw Error('Replay decisions could not be safely rebased.');updateTimeline({origin,decisions:decisions as ReplaySession[]});}
   const range=chartRef.current?.chart.timeScale().getVisibleLogicalRange();
   if(range){const previousVisible=latest.slice(0,current.index+1),combinedVisible=combined.slice(0,rebased.index+1);const added=aggregateReplayBars(combinedVisible,timeframe).length-aggregateReplayBars(previousVisible,timeframe).length;pendingRangeRef.current={from:range.from,to:range.to,added};}
   barsRef.current=combined;firstIndexRef.current+=older.length;setBars(combined);setFirstIndex(firstIndexRef.current);setCurrent(rebased);setNotice('Earlier candles loaded.');
  }catch{earlierRetryAtRef.current=Date.now()+20000;setNotice('Earlier candles could not be loaded. Move back to the chart edge to retry shortly.')}
  finally{earlierBusyRef.current=false;setLoadingEarlier(false)}
 };
 loadEarlierRef.current=()=>void loadEarlier();
 const loadNextDay=async()=>{
  const current=barsRef.current,active=sessionRef.current;
  if(!current.length||!active||nextBusyRef.current||nextUnavailableRef.current)return;
  const from=(current.at(-1)!.time+60)*1000;
  const todayStart=Math.floor(Date.now()/86400000)*86400000;
  if(from>=todayStart){nextUnavailableRef.current=true;setPlaying(false);setNotice('You have reached the latest completed historical data. Your workspace is still saved.');return}
  nextBusyRef.current=true;setLoadingEarlier(true);
  try{
   // Fetch four-day segments, so weekend gaps do not end a session.
   const to=Math.min(todayStart,from+4*86400000);
   const history=await historicalData({venue:'research',asset,timeframe:'m1',from:new Date(from).toISOString(),to:new Date(to).toISOString()});
   const newer=history.candles.filter(c=>c.time>current.at(-1)!.time).map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close}));
   if(!newer.length){nextUnavailableRef.current=true;setPlaying(false);setNotice('No more completed candles are available yet. Resume this workspace later.');return}
   if(barsRef.current.at(-1)?.time!==current.at(-1)?.time)return;
   const combined=validateReplayBars([...current,...newer]);
   barsRef.current=combined;setBars(combined);
   const latest=sessionRef.current;
   if(latest&&latest.index===current.length-1){
    const next=replayAdvance(latest,combined,costs,1);
    if(next.index>latest.index)setCurrent(next);
   }
   setError('');
  }catch(e){nextUnavailableRef.current=true;setPlaying(false);setError(e instanceof Error?'Later historical data is temporarily unavailable. Your workspace is safe; retry on next visit.':'Could not load later candles.')}
  finally{nextBusyRef.current=false;setLoadingEarlier(false)}
 };

 const advance=useCallback((steps=1)=>{
  const current=sessionRef.current;
  if(!current||!bars.length||preview)return;
   if(current.index>=bars.length-1){void loadNextDay();return}
  try{const target=Math.min(bars.length-1,current.index+steps),t=timelineRef.current;
   const futureDecision=Boolean(t?.decisions.some(item=>item.index>current.index&&item.index<=target));
   const next=t&&futureDecision?replayTo(t,target,bars,costs):replayAdvance(current,bars,costs,Math.max(1,steps));if(next===current||next.index===current.index){void loadNextDay();return}
    setCurrent(next);const added=replayPositions(next).find(p=>!replayPositions(current).some(old=>old.id===p.id));if(added){setSelectedPositionId(added.id);setAdjustStop(String(added.stop));setAdjustTarget(String(added.target));setShowNewOrder(false);setNotice('Pending paper order filled.')}setProgressTime(Date.now());
    if(next.index>=bars.length-1)void loadNextDay();
    else if(next.trades.length>current.trades.length){const trade=next.trades.at(-1)!;
     setNotice((trade.net>=0?'Target reached · ':'Trade closed · ')+(trade.net>=0?'+':'')+money(trade.net)+' net');
    }
  }catch(e){setPlaying(false);setError(e instanceof Error?e.message:'Cannot advance this replay.')}
 },[bars,costs,finished,preview]);
 useEffect(()=>{if(!playing||!session||replayAtEnd)return;const timer=window.setInterval(()=>advance(1),Math.max(45,Math.round(1000/speed)));return()=>window.clearInterval(timer)},[playing,speed,advance,replayAtEnd,sessionOpen]);
 const rewind=(steps=1)=>{
  const current=sessionRef.current,t=timelineRef.current;if(!current||!t||preview)return;
  setPlaying(false);
  try{
   // Extend the start into previously loaded history only before any trade decisions.
   if(current.index<=t.origin.index){
    if(t.decisions.length||t.origin.index<=0){setNotice('Start of replay reached.');return}
    const index=Math.max(0,t.origin.index-Math.max(1,steps)),fresh=beginReplay(bars,index,current.initialBalance);
    updateTimeline(newReplayTimeline(fresh));setFirstIndex(index);firstIndexRef.current=index;setCurrent(fresh);
   }else setCurrent(replayTo(t,Math.max(t.origin.index,current.index-Math.max(1,steps)),bars,costs));
   setFinished(false);setError('');
  }catch(e){setPlaying(false);setError(e instanceof Error?e.message:'Unable to rewind this saved session.')}
 };
 const enter=(side:ReplaySide)=>{
  if(!sessionRef.current||reviewing)return;
  setPlaying(false);setError('');
  if(!preview||preview.side!==side)return;
  try{const previous=sessionRef.current;const sl=Math.abs(preview.entry-preview.stop),tp=Math.abs(preview.target-preview.entry);const next=orderType==='market'?replayEnter(sessionRef.current,bars,side,number(quantity),sl,tp,costs):replayPlacePending(sessionRef.current,bars,side,orderType,preview.entry,number(quantity),sl,tp,costs);
   setPreview(null);setTicketMinimized(isMobile);recordDecision(next);const opened=replayPositions(next).find(p=>!replayPositions(previous).some(old=>old.id===p.id));if(opened){setSelectedPositionId(opened.id);setAdjustStop(String(opened.stop));setAdjustTarget(String(opened.target))}setShowNewOrder(false);if(next.pending)setManagePending(true);setNotice(orderType!=='market'?'Paper order queued for future candles.':side==='BUY'?'Long opened. Manage the risk; the next candle is still hidden.':'Short opened. Let the market reveal the next candle.');
  }catch(e){setError(e instanceof Error?e.message:'Order rejected')}
 };
 const previewOrder=(side:ReplaySide)=>{
  if(reviewing){setNotice('This is the original trade replay. Start a new workspace to practise a new trade.');return}
  if(!currentBar)return;setPlaying(false);setError('');
  const entry=orderType==='market'?(side==='BUY'?currentBar.close+costs.spread+costs.slippage:currentBar.close-costs.slippage):(Number(orderPrice)>0?Number(orderPrice):orderType==='limit'?(side==='BUY'?currentBar.close-2:currentBar.close+2):(side==='BUY'?currentBar.close+2:currentBar.close-2));
  const dir=side==='BUY'?1:-1,stop=entry-dir*Number(stopDistance),target=entry+dir*Number(targetDistance);
  if(!Number.isFinite(stop)||!Number.isFinite(target)||stop<=0||target<=0||stop===entry||target===entry){setError('Choose valid stop and target distances.');return;}
  setPreview({side,entry,stop,target,movableEntry:orderType!=='market'});
  if(isMobile)setTicketMinimized(true);
 };
 const close=()=>{
  if(!sessionRef.current)return;setPlaying(false);
  const next=replayClose(sessionRef.current,bars,costs,'MANUAL',selectedPosition?.id);if(next!==sessionRef.current){recordDecision(next);setNotice('Position closed at the current revealed price.')}
 };
 const modifyPosition=(breakEven=false)=>{
  if(!sessionRef.current||!selectedPosition)return;setPlaying(false);setError('');
  try{
   const p=selectedPosition;
   const next=replayModifyPosition(sessionRef.current,bars,costs,breakEven?p.entry:Number(adjustStop),Number(adjustTarget),p.id);
   const updated=replayPositions(next).find(item=>item.id===p.id)!;recordDecision(next);setAdjustStop(String(updated.stop));setAdjustTarget(String(updated.target));
   setNotice(breakEven?'Stop moved to break-even price.':'Protective orders updated for the next candle.');
  }catch(e){setError(e instanceof Error?e.message:'Could not modify this position.')}
 };
 const toggleFullscreen=async()=>{try{if(document.fullscreenElement===modalRef.current){await document.exitFullscreen();setExpanded(false)}else if(modalRef.current?.requestFullscreen){await modalRef.current.requestFullscreen();setExpanded(true)}else setExpanded(v=>!v)}catch{setExpanded(v=>!v);setNotice('Expanded replay in the browser window.')}};
 useEffect(()=>{const sync=()=>{if(!document.fullscreenElement)setExpanded(false)};document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync)},[]);
 const captureChart=async()=>{
  try{
   const chart=chartRef.current?.chart,host=chartDiv.current;if(!chart||!host)throw Error('Chart not ready.');
   const source=chart.takeScreenshot() as HTMLCanvasElement,output=document.createElement('canvas');
   const factor=Math.max(2,window.devicePixelRatio||1),width=host.clientWidth,height=host.clientHeight;
   output.width=Math.round(width*factor);output.height=Math.round(height*factor);
   const ctx=output.getContext('2d');if(!ctx)throw Error('Chart capture is unavailable.');ctx.drawImage(source,0,0,output.width,output.height);
   const overlay=host.querySelector('svg.drawing-overlay') as SVGSVGElement|null;
   if(overlay){const clone=overlay.cloneNode(true) as SVGSVGElement;clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',String(width));clone.setAttribute('height',String(height));
    const originals=[overlay,...Array.from(overlay.querySelectorAll('*'))],copies=[clone,...Array.from(clone.querySelectorAll('*'))];
    originals.forEach((node,i)=>{const style=getComputedStyle(node);for(const name of ['stroke','fill','stroke-width','opacity','font-size','font-family'])copies[i].setAttribute(name,style.getPropertyValue(name));});
    const uri=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
    try{const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('Drawing annotations could not be captured.'));image.src=uri});ctx.drawImage(image,0,0,output.width,output.height)}finally{URL.revokeObjectURL(uri)}
   }
   const blob=await new Promise<Blob|null>(resolve=>output.toBlob(resolve,'image/png'));if(!blob)throw Error('Chart image could not be captured.');
   const uri=URL.createObjectURL(blob),a=document.createElement('a');a.href=uri;a.download='trading-vibes-gold-replay-'+day+'-'+(currentBar?currentBar.time:'chart')+'.png';a.click();window.setTimeout(()=>URL.revokeObjectURL(uri),1500);setNotice('Replay chart captured as PNG.');
  }catch(e){setError(e instanceof Error?e.message:'Chart capture failed.')}
 };
 const reset=()=>{
  if(!bars.length||!window.confirm('Reset this replay session? This clears all paper trades and practice progress for this date.'))return;
  setPlaying(false);setPreview(null);setShowTicket(false);setShowReview(false);setTicketMinimized(false);setOrderPrice('');snapshotRef.current();setAttemptId(crypto.randomUUID());setElapsedSeconds(0);setStartedAt(new Date().toISOString());setSessionName('Gold · '+day+' · Fresh practice');setFinished(false);const fresh=beginReplay(bars,firstIndex,number(startingBalance));updateTimeline(newReplayTimeline(fresh));setCurrent(fresh);setAdjustStop('');setAdjustTarget('');setAnnotations({});setNotes('');setNotice('Replay reset. Start again when you are ready.');
 };
 const holdStart=useRef<ReturnType<typeof setTimeout>|null>(null),holdRepeat=useRef<ReturnType<typeof setInterval>|null>(null);
 const stopHold=()=>{if(holdStart.current!==null)clearTimeout(holdStart.current);if(holdRepeat.current!==null)clearInterval(holdRepeat.current);holdStart.current=null;holdRepeat.current=null};
 const beginHold=(dir:'back'|'next')=>{stopHold();holdStart.current=setTimeout(()=>{holdRepeat.current=setInterval(()=>{if(dir==='back')rewind(4);else advance(4)},115)},340)};
 useEffect(()=>()=>stopHold(),[]);
 const dragTicketStart=(e:React.PointerEvent<HTMLDivElement>)=>{
  if(isMobile||e.button!==0)return;
  const panel=e.currentTarget.closest('aside'),grid=panel?.parentElement;
  if(!panel||!grid)return;
  const rect=panel.getBoundingClientRect(),bounds=grid.getBoundingClientRect();
  ticketDrag.current={x:e.clientX,y:e.clientY,left:rect.left-bounds.left,top:rect.top-bounds.top,width:rect.width,height:rect.height};
  e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();
 };
 const dragTicketMove=(e:React.PointerEvent<HTMLDivElement>)=>{
  const drag=ticketDrag.current,grid=e.currentTarget.closest('aside')?.parentElement;if(!drag||!grid)return;
  setTicketXY({x:Math.max(0,Math.min(grid.clientWidth-drag.width,drag.left+e.clientX-drag.x)),y:Math.max(0,Math.min(grid.clientHeight-drag.height,drag.top+e.clientY-drag.y))});
 };
 const dragTicketEnd=()=>{ticketDrag.current=null};
 const zoomChart=(direction:1|-1)=>{
  const timeScale=chartRef.current?.chart?.timeScale?.();if(!timeScale)return;
  const spacing=Number(timeScale.options?.().barSpacing)||7;
  timeScale.applyOptions({barSpacing:Math.max(2,Math.min(36,spacing+direction*2.5))});
 };
 const followChart=()=>chartRef.current?.chart?.timeScale?.().scrollToRealTime();
 useEffect(()=>{
  if(!sessionOpen)return;
  const handle=(e:KeyboardEvent)=>{
   if(e.altKey||e.ctrlKey||e.metaKey||showDate||showIndicators||/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName||'')||(e.target instanceof HTMLElement&&e.target.isContentEditable))return;
   if(e.key==='ArrowRight'){e.preventDefault();advance(e.repeat?5:1)}
   else if(e.key==='ArrowLeft'){e.preventDefault();rewind(e.repeat?5:1)}
   else if(e.key==='+'||e.key==='='||e.code==='NumpadAdd'){e.preventDefault();zoomChart(1)}
   else if(e.key==='-'||e.key==='_'||e.code==='NumpadSubtract'){e.preventDefault();zoomChart(-1)}
  };
  window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);
 },[sessionOpen,advance,bars,costs,preview,showDate,showIndicators,finished]);
 useEffect(()=>{
  if(!sessionOpen||!chartDiv.current)return;
  const dark=theme==='dark';
  const chart=createChart(chartDiv.current,{autoSize:true,height:420,
   layout:{background:{type:ColorType.Solid,color:dark?'#171a17':'#ffffff'},textColor:dark?'#a0aaa2':'#727d76',fontFamily:'Inter,system-ui,sans-serif',fontSize:11},
   grid:{vertLines:{color:dark?'#263026':'#f2f4f3'},horzLines:{color:dark?'#263026':'#f2f4f3'}},
   timeScale:{borderColor:dark?'#2b322c':'#e5e8e6',timeVisible:true,secondsVisible:false,rightOffset:6,barSpacing:8},
   rightPriceScale:{borderColor:dark?'#2b322c':'#e5e8e6',scaleMargins:{top:0.13,bottom:0.18}},
   crosshair:{mode:0},localization:{locale:'en-US'},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true,axisDoubleClickReset:true},kineticScroll:{mouse:true,touch:true}
  });
  const series=chart.addSeries(CandlestickSeries,{upColor:'#19a578',downColor:'#db6a6b',borderUpColor:'#19a578',borderDownColor:'#db6a6b',wickUpColor:'#19a578',wickDownColor:'#db6a6b',
   priceFormat:{type:'price',precision:3,minMove:0.001}});
  const ema20=chart.addSeries(LineSeries,{visible:false,color:'#e9b45d',lineWidth:2,title:'EMA 20',priceLineVisible:false,lastValueVisible:false});
  const ema50=chart.addSeries(LineSeries,{visible:false,color:'#88a7ec',lineWidth:2,title:'EMA 50',priceLineVisible:false,lastValueVisible:false});
  const markers=createSeriesMarkers(series,[]);
  const chooseChartPrice=(event:any)=>{if(!pickingRef.current||!event.point)return;const value=series.coordinateToPrice(event.point.y);if(value!==null&&Number.isFinite(value)&&value>0){setOrderPrice(value.toFixed(3));pickingRef.current=false;setPickingPrice(false);setNotice('Paper order price selected from the chart.')}};chart.subscribeClick(chooseChartPrice);
  const pickTradeMarker=(event:any,pin=false)=>{
   if(!event?.time||pickingRef.current)return;
   const barTime=Number(event.time);if(!Number.isFinite(barTime))return;
   const match=markTargetsRef.current.find(item=>item.time===barTime);
   if(!match){if(!pin)setMarkerTrade(current=>current?.pinned?current:null);return}
   setMarkerTrade(current=>current?.pinned&&!pin?current:{...match,pinned:pin});
  };
  const clickMarker=(event:any)=>pickTradeMarker(event,true),hoverMarker=(event:any)=>pickTradeMarker(event,false);
  chart.subscribeClick(clickMarker);chart.subscribeCrosshairMove(hoverMarker);
  chartRef.current={chart,series,ema20,ema50,markers,lines:[]};
  const loadAtLeft=(range:any)=>{if(range&&range.from<20)loadEarlierRef.current()};chart.timeScale().subscribeVisibleLogicalRangeChange(loadAtLeft);
  const drawing=installChartTools(chartDiv.current,chart,series,[],`trading-vibes:replay-drawings:${uid}:${day}`,true);drawingRef.current=drawing;
  return()=>{chart.timeScale().unsubscribeVisibleLogicalRangeChange(loadAtLeft);chart.unsubscribeClick(chooseChartPrice);chart.unsubscribeClick(clickMarker);chart.unsubscribeCrosshairMove(hoverMarker);drawingRef.current=null;drawing();chartRef.current=null;chart.remove()};
 },[sessionOpen,theme,day]);
 useEffect(()=>{
  const c=chartRef.current;if(!c||!session)return;
  const follow=Math.abs(c.chart.timeScale().scrollPosition())<=10;
  const first=aggregates[0],last=aggregates.at(-1);
  const sameSource=c.lastBarsRef===bars&&c.lastTimeframe===timeframe&&c.firstBarTime===first?.time;
  const appendOrReplace=sameSource&&last&&(
   (aggregates.length===c.lastBarCount&&last.time===c.lastBarTime)||
   (aggregates.length===(c.lastBarCount||0)+1&&last.time>(c.lastBarTime||-Infinity)));
  if(appendOrReplace)c.series.update({time:last.time as any,open:last.open,high:last.high,low:last.low,close:last.close});
  else c.series.setData(aggregates.map(b=>({time:b.time as any,open:b.open,high:b.high,low:b.low,close:b.close})));
  c.lastBarsRef=bars;c.lastBarCount=aggregates.length;c.lastBarTime=last?.time;c.firstBarTime=first?.time;c.lastTimeframe=timeframe;
  drawingRef.current?.updateCandles(aggregates as any);

  const marks:any[]=[];const markerTargets:typeof markTargetsRef.current=[];
  const displayed=[...session.trades];
  if(reviewTrade&&!displayed.some(t=>t.id===reviewTrade.id))displayed.push(reviewTrade);
  for(const t of displayed){
   for(const event of ['entry','exit'] as const){
    const at=event==='entry'?t.entryTime:t.exitTime;
    if(at>bars[session.index]?.time)continue; // Never reveal a future trade result during replay.
    const time=Math.floor(at/(timeframe*60))*(timeframe*60);
    if(!aggregates.some(bar=>bar.time===time))continue;
    markerTargets.push({time,trade:t,event});
    marks.push({time:time as any,id:t.id+':'+event,position:event==='entry'?(t.side==='BUY'?'belowBar':'aboveBar'):(t.net>=0?'aboveBar':'belowBar'),
     shape:event==='entry'?'arrowUp':'circle',color:event==='entry'?'#e8c06b':t.net>=0?'#19a578':'#db6a6b',
     text:event==='entry'?(t.side==='BUY'?'BUY':'SELL'):(t.net>=0?'+':'')+t.net.toFixed(2)});
   }
  }
  markTargetsRef.current=markerTargets;
  for(const p of replayPositions(session))marks.push({time:Math.floor(p.entryTime/(timeframe*60))*(timeframe*60) as any,position:p.side==='BUY'?'belowBar':'aboveBar',shape:'arrowUp',color:'#e9b45d',text:'OPEN'});
  c.markers.setMarkers(marks.sort((a,b)=>Number(a.time)-Number(b.time)));
  for(const line of c.lines)c.series.removePriceLine(line);c.lines=[];
  if(session.pending)c.lines.push(c.series.createPriceLine({price:session.pending.price,color:'#e9b45d',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'PENDING'}));
  for(const p of replayPositions(session)){
   for(const [level,color,title] of [[p.entry,'#88a7ec','ENTRY'],[p.stop,'#db6a6b','STOP'],[p.target,'#19a578','TARGET']] as const)
    c.lines.push(c.series.createPriceLine({price:level,color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title}));
  }
  const pending=pendingRangeRef.current;if(pending){pendingRangeRef.current=null;c.chart.timeScale().setVisibleLogicalRange({from:pending.from+pending.added,to:pending.to+pending.added});}else if(follow)c.chart.timeScale().scrollToRealTime();
 },[aggregates,session,timeframe]);
 useEffect(()=>{
  const chart=chartRef.current?.chart;if(!chart||!sessionOpen)return;
  const overlays=['EMA','SMA','Bollinger Bands','Ichimoku'];
  const multiple:Record<string,number>={'Bollinger Bands':3,'MACD':2,'Stochastic':2,'Ichimoku':4};
  indicatorSeriesRef.current=indicators.map(spec=>{const pane=overlays.includes(spec.type)?0:chart.panes().length;const series=Array.from({length:multiple[spec.type]||1},(_,i)=>chart.addSeries(LineSeries,{color:spec.color,lineWidth:i?1:2,title:i?'':spec.type,priceLineVisible:false,lastValueVisible:false},pane));return {spec,series};});
  return()=>{for(const group of indicatorSeriesRef.current)for(const series of group.series){try{chart.removeSeries(series)}catch{}}indicatorSeriesRef.current=[]};
 },[indicators,sessionOpen,theme,day]);
 useEffect(()=>{let active=true;if(!sessionOpen||!indicators.length)return;void import('../replay-indicators').then(({calculateIndicator})=>{if(!active)return;for(const item of indicatorSeriesRef.current){const lines=calculateIndicator(aggregates,item.spec);item.series.forEach((series,index)=>series.setData(lines[index]?.points||[]));}});return()=>{active=false}},[aggregates,indicators,sessionOpen,theme,day]);
 const selected=session?.trades.find(t=>t.id===selectedTrade);
 const accountStats=session&&<div className="tv-replay-market-stats"><div><span>Account equity</span><strong>{mark?money(mark.equity):'—'}</strong></div><div><span>Session P/L</span><strong className={metrics&&metrics.returnPercent>=0?'is-profit':'is-loss'}>{metrics?(metrics.returnPercent>=0?'+':'')+money(mark!.equity-session.initialBalance):'—'}</strong></div><div><span>Open positions</span><strong>{positions.length}</strong></div><div><span>Margin used</span><strong>{mark?money(mark.marginUsed):'—'}</strong></div><div><span>Trades</span><strong>{session.trades.length}</strong></div></div>;
 return <main className={'tv-replay-backdrop tv-replay-page'+(expanded?' is-expanded':'')}>
  <section ref={modalRef} className={'tv-replay-modal'+(' tv-practice-redesign '+(theme==='light'?'tv-practice-light':'tv-practice-dark'))+(expanded?' is-expanded':'')} aria-label="Market Replay practice terminal">
   <header className="tv-replay-top"><div className="tv-replay-brand"><span className="tv-replay-brand-icon"><BarChart3 size={21}/></span><div><span className="tv-replay-eyebrow">TRADING VIBES · MARKET REPLAY</span><h2>Market Replay</h2>{session&&<div className="replay-workspace-title">{nameEditing?<input aria-label="Workspace name" maxLength={80} autoFocus value={sessionName} onChange={e=>setSessionName(e.target.value)} onBlur={()=>{setNameEditing(false);snapshotRef.current()}} onKeyDown={e=>{if(e.key==='Enter'){setNameEditing(false);snapshotRef.current()}}}/>:<button type="button" title="Rename workspace" onClick={()=>setNameEditing(true)}>{sessionName||'Gold session'} <span>✎</span></button>}<small>{reviewing?'Trade review · replay from before entry':'Autosaved · '+formatPracticeDuration(elapsedSeconds)+' practised'}</small></div>}</div></div>
    {session&&<div className="tv-replay-header-market"><div className="tv-replay-quote"><span>GOLD · XAUUSD <i/></span><strong>{currentBar?price(currentBar.close):'—'}</strong><small>{currentBar?utc(currentBar.time+60)+' UTC':'—'} · Historical</small></div>
     <div className="tv-replay-desktop-stats">{accountStats}</div><details className="tv-replay-mobile-stats"><summary>Account</summary>{accountStats}</details></div>}
    <div className="tv-replay-top-actions">{session&&<button type="button" onClick={()=>void toggleFullscreen()} aria-label={expanded?'Exit full screen':'Full screen'}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>}<button type="button" onClick={()=>{persistLatestTrades();onClose()}} aria-label="Exit replay" title="Exit replay"><ArrowLeft size={18}/></button></div>
   </header>
   {!session?<div className="tv-replay-setup"><div className="tv-replay-setup-main">
     <span className="tv-replay-eyebrow"><CalendarDays size={14}/> BUILD YOUR PRACTICE SESSION</span>
     <h3>Trade the past like it's happening now.</h3>
     <p>Choose a completed trading day. Only candles available at your replay time will be visible. Practice entries, manage stops and targets, then review every decision.</p>
     <div className="tv-replay-setup-fields">
      <label><span>Historical date · UTC</span><input aria-label="Historical replay date" type="date" max={yesterday()} value={day} disabled={loading} onChange={e=>setDay(e.target.value)}/></label>
      <label><span>Start time · UTC</span><input aria-label="Replay start time" type="time" step={60} value={startClock} disabled={loading} onChange={e=>setStartClock(e.target.value)}/></label>
      <label><span>Practice balance · ZAR</span><input aria-label="Practice starting balance" type="number" min={100} max={1e8} value={startingBalance} disabled={loading} onChange={e=>setStartingBalance(e.target.value)}/></label>
      <label><span>Choose asset</span><select aria-label="Replay asset" value={asset} disabled={loading} onChange={e=>setAsset(e.target.value as 'XAUUSD')}><option value="XAUUSD">Gold · XAUUSD</option></select></label>
     </div>
     <label className="replay-new-session-name">Workspace name <input aria-label="New workspace name" placeholder="Gold · Morning practice" maxLength={80} value={sessionName} onChange={e=>setSessionName(e.target.value)}/></label>
     <button className="tv-replay-launch" type="button" disabled={loading||!day} onClick={()=>void start()}>{loading?'Loading shared historical candles…':'Launch market replay'} <ArrowRight size={17}/></button>
     {error&&<p className="tv-replay-error" role="alert">{error}</p>}
     <section className="replay-saved-workspaces"><h3>Saved workspaces</h3><p>Every replay autosaves. Resume a named session right where you left it.</p><div className="replay-workspace-table">{savedSessions.length?savedSessions.map(record=><div className="replay-workspace-row" key={record.id}><div>{renameId===record.id?<input autoFocus aria-label="Rename saved workspace" maxLength={80} value={renameDraft} onChange={e=>setRenameDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void renameSaved(record)}}}/>:<strong>{record.name||'Gold session'}</strong>}<small>{record.day} · {formatPracticeDuration(record.spentSeconds||0)} · {record.tradeCount} trades</small></div><div>{renameId===record.id?<button type="button" onClick={()=>void renameSaved(record)}>Save</button>:<button type="button" onClick={()=>{setRenameId(record.id);setRenameDraft(record.name||'Gold session')}}>Rename</button>}<button type="button" disabled={loading} className="replay-resume" onClick={()=>void start(record.day,record.id,record)}>Resume <ArrowRight size={14}/></button></div></div>):<div className="replay-workspace-empty">Your saved sessions will appear here after you launch a replay.</div>}</div></section>
     <p className="tv-replay-source"><CheckCircle2 size={15}/> ZAR practice balances are simulated. Gold's chart is quoted in USD; paper P/L uses simplified rand units with no live FX conversion. Earlier candles load as needed when you scroll back.</p>
    </div><aside className="tv-replay-setup-aside"><span className="tv-replay-eyebrow">THE PRACTICE LOOP</span>
     {[[Clock3,'Reveal','Watch new candles form one by one.'],[Target,'Execute','Enter trades with stops, targets and costs.'],[Trophy,'Review','Learn from your journal, win rate and drawdown.']].map(([Icon,title,body],i)=><div className="tv-replay-how" key={String(title)}><span>{typeof Icon==='function'?<Icon size={20}/>:i+1}</span><div><strong>{String(title)}</strong><p>{String(body)}</p></div></div>)}
    </aside></div>:
   <div className="tv-replay-terminal">
    <div className="tv-replay-controls"><div className="tv-replay-playback"><button type="button" aria-label="Rewind one candle" title="Rewind one candle" disabled={!!preview||!timeline||(session.index<=timeline.origin.index&&!!timeline.decisions.length)||session.index<=0} onPointerDown={()=>beginHold('back')} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onClick={()=>rewind()}><SkipBack size={16}/><span className="replay-rewind-text">Rewind</span></button><button className="tv-replay-play" type="button" disabled={replayAtEnd||!!preview} onClick={()=>setPlaying(v=>!v)} aria-label={playing?'Pause replay':'Play replay'}>{playing?<Pause size={16}/>:<Play size={16}/>}<span className="replay-control-text">{playing?'Pause':'Play'}</span></button><button type="button" disabled={replayAtEnd||!!preview} onPointerDown={()=>beginHold('next')} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onClick={()=>advance(1)} title="Next M1 candle (→)"><SkipForward size={16}/><span className="replay-control-text">Step</span></button><button type="button" disabled={replayAtEnd||!!preview} onClick={()=>advance(5)} title="Reveal next 5 completed M1 candles"><FastForward size={16}/><span className="replay-control-text">+5</span></button>
     <label className="tv-replay-speed"><span>Speed</span><select value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{speeds.map(v=><option value={v} key={v}>{v}×</option>)}</select></label></div>
     <div className="tv-replay-chart-controls"><div className="replay-zoom-desktop" role="group" aria-label="Chart zoom controls"><button type="button" onClick={()=>zoomChart(1)} title="Zoom in (+)" aria-label="Zoom in">+</button><button type="button" onClick={()=>zoomChart(-1)} title="Zoom out (-)" aria-label="Zoom out">−</button></div><label aria-label="Chart timeframe"> <select aria-label="Chart timeframe" value={timeframe} onChange={e=>setTimeframe(Number(e.target.value) as 1|5|15|60|240|1440)}><option value={1}>1m</option><option value={5}>5m</option><option value={15}>15m</option><option value={60}>1H</option><option value={240}>4H</option><option value={1440}>1D</option></select></label><button type="button" onClick={()=>setShowIndicators(true)} title="Choose indicators"><Settings2 size={14}/> Indicators</button><button type="button" onClick={()=>{setPlaying(false);setPreview(null);setShowTicket(false);setShowReview(false);setTicketMinimized(false);setDateDraft(day);setShowDate(true);}} title="Choose a different historical session"><CalendarDays size={15}/><span className="replay-control-text">Date</span></button><button type="button" onClick={()=>void captureChart()} title="Save a clean chart image for your trading journal or content"><Camera size={15}/><span className="replay-control-text">Save Chart</span></button><button type="button" title="Undo drawing (Ctrl+Z)" aria-label="Undo drawing" onClick={()=>drawingRef.current?.undo()}><Undo2 size={15}/> <span className="replay-control-text">Undo</span></button><button type="button" title="Redo drawing (Ctrl+Shift+Z)" aria-label="Redo drawing" onClick={()=>drawingRef.current?.redo()}><Redo2 size={15}/> <span className="replay-control-text">Redo</span></button><button type="button" className={showTicket?'is-selected':''} aria-expanded={showTicket} onClick={()=>{setShowTicket(v=>!v);setTicketMinimized(false);setShowReview(false)}}><TrendingUp size={15}/> Trade</button><button type="button" className={showReview?'is-selected':''} aria-expanded={showReview} onClick={()=>{setShowReview(v=>!v);setShowTicket(false);setTicketMinimized(false);setPreview(null)}}><BookOpen size={15}/> Review</button></div></div>
    <div className="tv-replay-grid"><div className="tv-replay-chart-panel"><div className="tv-replay-chart-heading"><span><Activity size={15}/> GOLD · {timeframe===1440?'1D':timeframe===240?'4H':timeframe===60?'1H':timeframe+'m'} · REVEALED CANDLES</span><strong>{loadingEarlier?'Loading historical candles…':'More candles load automatically'}</strong></div><div className="tv-replay-chart-wrapper"><div className="tv-replay-chart" ref={chartDiv} tabIndex={0} aria-label="Historical candlestick chart with only revealed candles"/>{preview&&<ReplayPositionPreview chart={chartRef.current?.chart} series={chartRef.current?.series} preview={preview} onChange={v=>{setPreview(v);if(orderType!=='market')setOrderPrice(v.entry.toFixed(3))}}/>}{!preview&&showTicket&&!showNewOrder&&selectedPosition&&(!session.pending||!managePending)&&Number(adjustStop)>0&&Number(adjustTarget)>0&&<ReplayPositionPreview chart={chartRef.current?.chart} series={chartRef.current?.series} preview={{side:selectedPosition.side,entry:selectedPosition.entry,stop:Number(adjustStop),target:Number(adjustTarget),movableEntry:false}} onChange={v=>{setAdjustStop(String(v.stop));setAdjustTarget(String(v.target))}}/>}
      {markerTrade&&<div className="replay-marker-card" role="status"><div><span className="replay-marker-kicker">{markerTrade.event==='entry'?'TRADE ENTRY':'TRADE OUTCOME'} · {markerTrade.trade.side}</span><button type="button" aria-label="Close trade details" onClick={()=>setMarkerTrade(null)}><X size={16}/></button></div><strong className={markerTrade.trade.net>=0?'is-profit':'is-loss'}>{markerTrade.trade.net>=0?'+':''}{money(markerTrade.trade.net)}</strong><dl><dt>Entry</dt><dd>{price(markerTrade.trade.entry)}</dd><dt>Exit</dt><dd>{price(markerTrade.trade.exit)}</dd><dt>Stop loss</dt><dd>{price(markerTrade.trade.stop)}</dd><dt>Target</dt><dd>{price(markerTrade.trade.target)}</dd><dt>Quantity</dt><dd>{markerTrade.trade.quantity} oz</dd><dt>Reason</dt><dd>{markerTrade.trade.reason}</dd><dt>When</dt><dd>{utc(markerTrade.event==='entry'?markerTrade.trade.entryTime:markerTrade.trade.exitTime)}</dd></dl><p>{annotations[markerTrade.trade.id]||initialRecord?.annotations?.[markerTrade.trade.id]||'Tap a trade in your journal to add a review.'}</p><button type="button" className="replay-marker-pin" onClick={()=>setMarkerTrade(current=>current?{...current,pinned:true}:null)}>Keep details visible</button></div>}
      {isMobile&&<div className="replay-mobile-zoom" role="group" aria-label="Chart navigation"><button type="button" onClick={()=>zoomChart(1)} aria-label="Zoom chart in" title="Zoom in"><ZoomIn size={17}/></button><button type="button" onClick={()=>zoomChart(-1)} aria-label="Zoom chart out" title="Zoom out"><ZoomOut size={17}/></button><button type="button" onClick={followChart} aria-label="Jump to latest replay candle" title="Latest candle"><LocateFixed size={17}/></button></div>}
      {isMobile&&showTicket&&ticketMinimized&&<div className="replay-mobile-order-bar" role="group" aria-label="Chart trade adjustments">
        {preview?<><div className="replay-mobile-order-summary"><strong>{preview.side==='BUY'?'BUY':'SELL'} · {orderType.toUpperCase()}</strong><small>Drag price lines to adjust</small></div><button type="button" className="is-primary" onClick={()=>enter(preview.side)}>Confirm order</button><button type="button" onClick={()=>setTicketMinimized(false)}>Edit</button><button type="button" aria-label="Cancel order preview" title="Cancel preview" onClick={()=>{setPreview(null);setTicketMinimized(false)}}><X size={17}/></button></>
        :selectedPosition&&!showNewOrder&&(!session.pending||!managePending)?<><div className="replay-mobile-order-summary"><strong>{selectedPosition.side==='BUY'?'LONG':'SHORT'} · {selectedPosition.quantity} oz</strong><small>Drag SL / TP to adjust</small></div><button type="button" className="is-primary" onClick={()=>modifyPosition(false)}>Save SL / TP</button><button type="button" onClick={()=>setTicketMinimized(false)}>Manage</button></>
        :<><span>Paper trading</span><button type="button" className="is-primary" onClick={()=>setTicketMinimized(false)}>Open ticket</button></>}
       </div>}</div>
     <div className="tv-replay-chart-footer"><span><i className="tv-replay-up"/> Bull candle</span><span><i className="tv-replay-down"/> Bear candle</span><span>{isMobile?'Pinch to zoom · Drag to scroll · Long press to inspect':'Scroll to zoom · Drag to inspect'}</span></div></div>
     <aside className={'tv-replay-ticket'+(ticketMinimized?' is-minimized':'')} hidden={!showTicket} aria-label="Simulated trade panel" style={ticketXY&&!isMobile?{left:ticketXY.x,top:ticketXY.y,right:'auto',bottom:'auto'}:undefined}><div className="replay-ticket-drag" onPointerDown={dragTicketStart} onPointerMove={dragTicketMove} onPointerUp={dragTicketEnd} onPointerCancel={dragTicketEnd}><GripHorizontal size={18}/><span className="replay-ticket-drag-label">{isMobile?'Paper trade': 'Drag to move'}</span>{isMobile?<button type="button" className="replay-ticket-toggle" aria-label={ticketMinimized?'Expand trade ticket':'Minimize trade ticket to adjust chart'} onPointerDown={e=>e.stopPropagation()} onClick={()=>{setTicketMinimized(v=>!v);setPlaying(false)}}>{ticketMinimized?'Open ticket':'View chart'} {ticketMinimized?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</button>:<span>↔</span>}</div><button type="button" className="replay-panel-close" aria-label="Close trade panel" onClick={()=>{setPreview(null);setShowTicket(false)}}><X size={16}/></button><span className="tv-replay-eyebrow">PAPER EXECUTION</span><h3>{showNewOrder?'Place a trade':session.pending&&(managePending||!selectedPosition)?'Pending order':selectedPosition?'Open positions':'Place a trade'}</h3>{(selectedPosition||session.pending)&&<button type="button" className="tv-replay-risk-sizing" onClick={()=>setShowNewOrder(v=>!v)}>{showNewOrder?'Manage positions':'Add a trade'}</button>}
      {!showNewOrder&&session.pending&&(managePending||!selectedPosition)?<div className="tv-replay-position"><p>{session.pending.side} {session.pending.type.toUpperCase()} · {price(session.pending.price)} · {session.pending.quantity} oz</p><p>Fills are simulated from future completed candles. Same-candle target fills are deferred because candle ordering is unknown.</p><button type="button" className="tv-replay-close-position" onClick={()=>{if(sessionRef.current)recordDecision(replayCancelPending(sessionRef.current));setNotice('Pending paper order cancelled.')}}>Cancel pending order</button>{selectedPosition&&<button type="button" className="tv-replay-risk-sizing" onClick={()=>setManagePending(false)}>Manage open positions</button>}</div>:!showNewOrder&&selectedPosition?<div className="tv-replay-position">{session.pending&&<button type="button" className="tv-replay-risk-sizing" onClick={()=>setManagePending(true)}>View pending order</button>}{positions.length>1&&<label>Manage position<select aria-label="Position to manage" value={selectedPosition.id} onChange={e=>{const p=positions.find(item=>item.id===e.target.value);if(p){setSelectedPositionId(p.id);setAdjustStop(String(p.stop));setAdjustTarget(String(p.target))}}}>{positions.map(p=><option key={p.id} value={p.id}>{p.side==='BUY'?'Long':'Short'} · {p.quantity} oz · {price(p.entry)}</option>)}</select></label>}<div><span className={selectedPosition.side==='BUY'?'is-profit':'is-loss'}>{selectedPosition.side==='BUY'?'LONG':'SHORT'}</span><strong className={selectedMark&&selectedMark.unrealized>=0?'is-profit':'is-loss'}>{selectedMark?(selectedMark.unrealized>=0?'+':'')+money(selectedMark.unrealized):'—'}</strong></div><dl><dt>Entry</dt><dd>{price(selectedPosition.entry)}</dd><dt>Stop loss</dt><dd>{price(selectedPosition.stop)}</dd><dt>Take profit</dt><dd>{price(selectedPosition.target)}</dd><dt>Size</dt><dd>{selectedPosition.quantity} oz</dd></dl>
       <div className="tv-replay-edit-position"><label>New stop price<input type="number" step="0.01" value={adjustStop} onChange={e=>setAdjustStop(e.target.value)}/></label><label>New target price<input type="number" step="0.01" value={adjustTarget} onChange={e=>setAdjustTarget(e.target.value)}/></label></div>
       <div className="tv-replay-position-actions"><button type="button" onClick={()=>modifyPosition(false)}>Update SL / TP</button><button type="button" onClick={()=>modifyPosition(true)}>Move stop to entry</button></div>
       <button type="button" className="tv-replay-close-position" onClick={close}>Close position</button></div>:
      <><div className="tv-replay-ticket-inputs"><label>Order type<select aria-label="Paper order type" value={orderType} onChange={e=>{setPreview(null);setOrderPrice('');setOrderType(e.target.value as typeof orderType)}}><option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option></select></label>{orderType!=='market'&&<label>Order price<input aria-label="Pending order price" type="number" min="0.01" step="0.01" value={orderPrice} onChange={e=>setOrderPrice(e.target.value)}/></label>} {orderType!=='market'&&<button type="button" className="tv-replay-risk-sizing" onClick={()=>{pickingRef.current=!pickingRef.current;setPickingPrice(pickingRef.current)}}>{pickingPrice?'Click chart to set price…':'Set order price on chart'}</button>}<label>Quantity · oz<input type="number" min="0.01" step="0.1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label>Stop distance · points/oz<input type="number" min="0.01" step="0.5" value={stopDistance} onChange={e=>setStopDistance(e.target.value)}/></label><label>Target distance · points/oz<input type="number" min="0.01" step="0.5" value={targetDistance} onChange={e=>setTargetDistance(e.target.value)}/></label></div>
      <div className="tv-replay-risk"><div><span>Planned stop risk</span><strong>{money(estimatedRisk)}</strong></div>
       <div><span>Account risk</span><strong className={riskPercent>2?'is-loss':''}>{Number.isFinite(riskPercent)?riskPercent.toFixed(2)+'%':'—'}</strong></div>
       <div><span>Risk / reward</span><strong>1 : {number(stopDistance)>0?(number(targetDistance)/number(stopDistance)).toFixed(2):'—'}</strong></div>
       <button type="button" className="tv-replay-risk-sizing" disabled={!recommendedSize||!Number.isFinite(recommendedSize)} onClick={()=>{setQuantity(String(recommendedSize));setNotice('Sized the next paper order to approximately 1% planned stop risk before gaps.')}}>Size to 1% risk · {recommendedSize.toFixed(2)} oz</button>
       {riskPercent>2&&<p className="tv-replay-risk-warning">High planned risk: more than 2% of equity is exposed to this stop.</p>}</div>
      <div className="tv-replay-orders"><button type="button" className="tv-replay-buy" onClick={()=>previewOrder('BUY')} disabled={replayAtEnd||Boolean(session.pending&&orderType!=='market')}><TrendingUp size={16}/> BUY / LONG</button><button type="button" className="tv-replay-sell" onClick={()=>previewOrder('SELL')} disabled={replayAtEnd||Boolean(session.pending&&orderType!=='market')}><TrendingDown size={16}/> SELL / SHORT</button></div></>}
      {preview&&<div className="replay-order-confirm"><p className="replay-drag-hint">↕ Drag the coloured ENTRY, STOP and TARGET lines on the chart. {orderType==='market'?'Market entry follows the current price; switch to Limit to drag entry.':'Drag ENTRY to choose the pending order price.'}</p><strong>{preview.side==='BUY'?'LONG':'SHORT'} · {orderType.toUpperCase()} · {quantity} oz</strong><div>Entry {price(preview.entry)} · Stop {price(preview.stop)} · Target {price(preview.target)}</div><div>Risk {money((Math.abs(preview.entry-preview.stop)+costs.slippage+2*costs.feePerOunce)*Number(quantity)*replayFx(costs))} ({riskPercent.toFixed(2)}%) · Reward {money(Math.abs(preview.target-preview.entry)*Number(quantity)*replayFx(costs))} · R:R 1:{(Math.abs(preview.target-preview.entry)/Math.abs(preview.entry-preview.stop)).toFixed(2)}</div><div>Estimated margin {money(preview.entry*Number(quantity)*replayFx(costs)/costs.leverage)} · Estimated costs {money((costs.spread+2*costs.slippage+2*costs.feePerOunce)*Number(quantity)*replayFx(costs))}</div><button type="button" onClick={()=>enter(preview.side)}>✓ Confirm {orderType==='market'?'Trade':'Pending Order'}</button><button type="button" onClick={()=>setPreview(null)}>Cancel</button></div>}
      <details className="tv-replay-settings" open={showCosts} onToggle={e=>setShowCosts((e.currentTarget as HTMLDetailsElement).open)}><summary><Settings2 size={14}/> Execution assumptions</summary><p>{costs.currency==='ZAR'?`Simplified paper-account units in rand, without currency conversion.`:'Simulated rand account.'}</p><div><label>Spread · points/oz<input type="number" min="0" max="30" step="0.05" disabled={!!timeline&&(session.index>timeline.origin.index||timeline.decisions.length>0)} value={costs.spread} onChange={e=>setCosts(v=>({...v,spread:Number(e.target.value)}))}/></label><label>Slippage · points/oz<input type="number" min="0" max="10" step="0.01" disabled={!!timeline&&(session.index>timeline.origin.index||timeline.decisions.length>0)} value={costs.slippage} onChange={e=>setCosts(v=>({...v,slippage:Number(e.target.value)}))}/></label><label>Fee · R/oz / side<input type="number" min="0" max="5" step="0.01" disabled={!!timeline&&(session.index>timeline.origin.index||timeline.decisions.length>0)} value={costs.feePerOunce} onChange={e=>setCosts(v=>({...v,feePerOunce:Number(e.target.value)}))}/></label><label>Leverage<input type="number" min="1" max="100" step="1" disabled={!!timeline&&(session.index>timeline.origin.index||timeline.decisions.length>0)} value={costs.leverage} onChange={e=>setCosts(v=>({...v,leverage:Number(e.target.value)}))}/></label></div><p>Practice assumptions only. Historical M1 bars do not resolve the exact order of intrabar stop/target touches; replay assumes the stop first when both are hit.</p></details>
     </aside></div>
    <section className="tv-replay-review" hidden={!showReview} aria-label="Practice review"><button type="button" className="replay-panel-close" aria-label="Close review panel" onClick={()=>setShowReview(false)}><X size={16}/></button><div className="tv-replay-stats">{[['Win rate',metrics&&metrics.trades?metrics.winRate.toFixed(1)+'%':'—'],['Profit factor',metrics&&metrics.trades?(Number.isFinite(metrics.profitFactor)?metrics.profitFactor.toFixed(2):'∞'):'—'],['Max drawdown',metrics?metrics.maxDrawdown.toFixed(2)+'%':'0%'],['Best win streak',metrics?String(metrics.bestStreak):'0']].map(([label,val])=><div key={label}><span>{label}</span><strong>{val}</strong></div>)}</div>
<div className="tv-replay-journal-head"><div><span className="tv-replay-eyebrow"><Flag size={14}/> SESSION JOURNAL</span><h3>Every trade is a lesson.</h3></div><div><button type="button" disabled={!session.trades.length} onClick={()=>exportJournal(session,annotations,day,costs)}><Download size={15}/> Export CSV</button><button type="button" onClick={reset}><RotateCcw size={15}/> Reset session</button></div></div>
     {session.trades.length?<div className="tv-replay-table-wrap"><table className="tv-replay-table"><thead><tr><th>Side</th><th>Entry · UTC</th><th>Exit · UTC</th><th>Entry</th><th>Exit</th><th>Reason</th><th>Net</th><th></th></tr></thead><tbody>{[...session.trades].reverse().map(t=><tr key={t.id}><td>{t.side==='BUY'?'LONG':'SHORT'}</td><td>{utc(t.entryTime)}</td><td>{utc(t.exitTime)}</td><td>{price(t.entry)}</td><td>{price(t.exit)}</td><td>{t.reason}</td><td className={t.net>=0?'is-profit':'is-loss'}>{t.net>=0?'+':''}{money(t.net)}</td><td><button type="button" onClick={()=>setSelectedTrade(t.id)}>Note <ChevronRight size={12}/></button></td></tr>)}</tbody></table></div>:
      <div className="tv-replay-no-trades"><Target size={22}/><span>Make your first trade when you see a setup. Record what you learned below.</span></div>}
     {selected&&<div className="tv-replay-trade-notes"><strong>Note for {selected.side} at {utc(selected.entryTime)} UTC</strong><textarea value={annotations[selected.id]||''} placeholder="Why did you enter? What worked? What would you change?" maxLength={1200} onChange={e=>setAnnotations(v=>({...v,[selected.id]:e.target.value}))}/><button type="button" onClick={()=>setSelectedTrade(null)}>Close note</button></div>}
     <label className="tv-replay-general-notes"><span>Session notes · what did you learn?</span><textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={3000} placeholder="Market context, your plan, mistakes, and what you'd do next time…"/></label>
    </section>
    {showIndicators&&<ReplayIndicators active={indicators} onChange={setIndicators} onClose={()=>setShowIndicators(false)}/>}
    {showDate&&<div className="tv-replay-date-backdrop" onClick={()=>!loading&&setShowDate(false)}><section role="dialog" aria-modal="true" aria-labelledby="replay-date-title" className="tv-replay-date-dialog" onClick={e=>e.stopPropagation()}><div><h3 id="replay-date-title">Go to date</h3><button type="button" aria-label="Close date picker" disabled={loading} onClick={()=>setShowDate(false)}><X size={16}/></button></div><p>Choose a completed historical UTC day.</p><input aria-label="New replay date" type="date" max={yesterday()} value={dateDraft} disabled={loading} onChange={e=>setDateDraft(e.target.value)}/>{error&&<p role="alert">{error}</p>}<button type="button" disabled={loading||!dateDraft} onClick={()=>void start(dateDraft)}>{loading?'Loading historical candles…':'Go to Date'}</button></section></div>}
    {(notice||error)&&<div role={error?'alert':'status'} className={'tv-replay-feedback'+(error?' is-error':'')}>{error||notice}</div>}
   </div>}
  </section>
 </main>;
}
