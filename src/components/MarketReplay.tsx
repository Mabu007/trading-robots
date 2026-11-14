import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Activity,ArrowLeft,ArrowRight,BarChart3,BookOpen,CalendarDays,Camera,CheckCircle2,ChevronRight,Clock3,Download,FastForward,Flag,Maximize2,Minimize2,Pause,Play,RotateCcw,Settings2,SkipBack,SkipForward,GripHorizontal,Undo2,Redo2,Target,TrendingDown,TrendingUp,Trophy,X} from 'lucide-react';
import {createChart,CandlestickSeries,LineSeries,createSeriesMarkers,ColorType} from 'lightweight-charts';
import {historicalData} from '../history-cache';
import {installChartTools} from '../chart-tools';
import {saveLocalHistory,type PracticeRecord} from '../practice-history';
import {rebaseDaySession} from '../replay-history-migration';
import {newReplayTimeline,recordReplayDecision,replayTo,type ReplayTimeline} from '../replay-timeline';
import type {CloudClient} from '../firebase';
import type {AppTheme} from '../theme';
import {aggregateReplayBars,beginReplay,NEW_REPLAY_COSTS,replayAdvance,replayClose,replayEMA,replayFx,replayEnter,replayPlacePending,replayCancelPending,replayMark,replayMetrics,replayModifyPosition,replayPositions,replayVisibleBars,validateReplayBars,validateReplayCosts,type ReplayBar,type ReplayCosts,type ReplaySession,type ReplaySide} from '../market-replay-engine';
import {ReplayIndicators} from './ReplayIndicators';
import type {IndicatorSpec} from '../replay-indicators';
import {ReplayPositionPreview,type PositionPreview} from './ReplayPositionPreview';
import {visibleArchivedTrades} from '../replay-journal';
import './market-replay.css';

type Props={client:CloudClient;theme:AppTheme;onClose:()=>void;onHistoryChange?:()=>void;initialDay?:string;initialReviewTradeId?:string};
const price=(value:number)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:3}).format(value);
const utc=(timestamp:number)=>new Date(timestamp*1000).toLocaleString('en-GB',{timeZone:'UTC',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const yesterday=()=>new Date(Date.now()-86400000).toISOString().slice(0,10);
const number=(text:string)=>Number(text);
type SavedSession={version:4;day:string;asset:'XAUUSD';firstTimestamp:number;lastTimestamp:number;session:ReplaySession;firstIndex:number;notes:string;costs:ReplayCosts;annotations:Record<string,string>;attemptId?:string;finished?:boolean;timeline?:ReplayTimeline};
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
export function MarketReplay({client,theme,onClose,onHistoryChange,initialDay,initialReviewTradeId}:Props){
 const [day,setDay]=useState(()=>initialDay||yesterday()),[startClock,setStartClock]=useState('08:00'),[startingBalance,setStartingBalance]=useState('10000');
 const [asset,setAsset]=useState<'XAUUSD'>('XAUUSD');
 const [showTicket,setShowTicket]=useState(false),[showReview,setShowReview]=useState(false);
 const [ticketXY,setTicketXY]=useState<{x:number;y:number}|null>(null);
 const ticketDrag=useRef<{x:number;y:number;left:number;top:number;width:number;height:number}|null>(null);
 const [attemptId,setAttemptId]=useState<string>(()=>crypto.randomUUID()),[finished,setFinished]=useState(false),[savingHistory,setSavingHistory]=useState(false);
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
 const chartRef=useRef<{chart:any;series:any;ema20:any;ema50:any;markers:any;lines:any[]} |null>(null);
 const uid=client.getProfile()?.uid||'local';
 const sessionSuffix=uid+':'+asset+':'+day;
 const sessionKey='trading-vibes:replay:zar:v4:'+sessionSuffix;
 const setCurrent=(next:ReplaySession)=>{sessionRef.current=next;setSession(next)};
 const recordDecision=(next:ReplaySession)=>{if(timelineRef.current)updateTimeline(recordReplayDecision(timelineRef.current,next));setCurrent(next)};
 const currentBar=session?bars[session.index]:null;
 const replayAtEnd=Boolean(session&&(finished||session.index>=bars.length-1));
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
 const start=async(targetDay=day)=>{
  if(loading)return;
  // Flush the current session before switching keys; a pending autosave may not have fired.
  if(sessionRef.current&&bars.length&&targetDay!==day){
   try{localStorage.setItem(sessionKey,JSON.stringify({version:4,day,asset,firstTimestamp:bars[0].time,lastTimestamp:bars[bars.length-1].time,session:sessionRef.current,firstIndex,notes,costs,annotations,attemptId,finished,timeline:timelineRef.current||undefined} satisfies SavedSession));}
   catch{setError('Could not save the current session. Check browser storage before switching dates.');return;}
  }
  {const day=targetDay;
  const sessionSuffix=uid+':'+asset+':'+day;
  const sessionKey='trading-vibes:replay:zar:v4:'+sessionSuffix;
  setLoading(true);setPlaying(false);setError('');setNotice('');noEarlierRef.current=false;earlierRetryAtRef.current=0;
  try{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>yesterday())throw Error('Choose a completed historical UTC day.');
   validateReplayCosts(costs);
   const begin=Date.parse(day+'T00:00:00Z');
   let historyStart=begin-7*86400000;
   try{const raw=localStorage.getItem(sessionKey);if(raw){const saved=JSON.parse(raw) as SavedSession;if(saved.version===4&&Number.isFinite(saved.firstTimestamp)&&saved.firstTimestamp*1000< historyStart&&saved.firstTimestamp*1000>=begin-100*86400000)historyStart=Math.floor(saved.firstTimestamp/86400)*86400000;}}catch{}
   const [todayResult,historyResult]=await Promise.allSettled([
    historicalData({venue:'research',asset,timeframe:'m1',from:new Date(begin).toISOString(),to:new Date(begin+86400000).toISOString()}),
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
   let restoredAttempt:string=crypto.randomUUID(),restoredFinished=false,restoredNotes='',restoredAnnotations:Record<string,string>={},restoredTimeline:ReplayTimeline|null=null;
   try{
    const saved=localStorage.getItem(sessionKey);
    if(saved){let parsed=JSON.parse(saved) as SavedSession;
     if(parsed.version===4&&parsed.day===day&&parsed.asset===asset&&(parsed.firstTimestamp!==candles[0].time||parsed.lastTimestamp!==candles.at(-1)?.time||parsed.session?.initialBalance!==startEquity))throw Error('Saved replay cannot be restored with the available history or starting balance. The existing save has been preserved.');
     if(parsed.version===4&&parsed.day===day&&parsed.asset===asset&&parsed.firstTimestamp===candles[0].time&&parsed.lastTimestamp===candles.at(-1)?.time&&parsed.session&&parsed.session.index>=initial&&parsed.session.index<candles.length&&
      Number.isFinite(parsed.session.balance)&&parsed.session.initialBalance===startEquity&&
      (parsed.session.position===null||typeof parsed.session.position?.entry==='number')&&Array.isArray(parsed.session.trades)){
      next=parsed.session;if(Number.isInteger(parsed.firstIndex)&&parsed.firstIndex>=initial&&parsed.firstIndex<=parsed.session.index){restoredFirst=parsed.firstIndex}restoredAttempt=parsed.attemptId||crypto.randomUUID();restoredFinished=parsed.finished===true;restoredNotes=typeof parsed.notes==='string'?parsed.notes:'';restoredAnnotations=parsed.annotations||{};resume=true;
      if(parsed.costs?.currency!=='ZAR'||parsed.costs.usdZar!==undefined)throw Error('This is not a native rand replay session.');
      validateReplayCosts(parsed.costs);setCosts(parsed.costs);
      if(parsed.timeline&&parsed.timeline.origin?.index<=next.index&&Array.isArray(parsed.timeline.decisions)&&parsed.timeline.decisions.every(x=>Number.isInteger(x.index)&&x.index>=parsed.timeline!.origin.index&&x.index<candles.length))restoredTimeline=parsed.timeline;
     }
    }
   }catch(error){if(error instanceof Error&&error.message.startsWith('Saved replay cannot'))throw error;/* Invalid browser-only practice saves are ignored. */}
   if(!resume)setCosts({...NEW_REPLAY_COSTS});
   setDay(day);setShowDate(false);setAttemptId(restoredAttempt);setFinished(restoredFinished);setNotes(restoredNotes);setAnnotations(restoredAnnotations);
   barsRef.current=candles;firstIndexRef.current=restoredFirst;setBars(candles);setFirstIndex(restoredFirst);updateTimeline(restoredTimeline||newReplayTimeline(next));setCurrent(next);
   const restored=replayPositions(next)[0];setSelectedPositionId(restored?.id||'');setAdjustStop(restored?String(restored.stop):'');setAdjustTarget(restored?String(restored.target):'');
   setPlaying(false);setProgressTime(Date.now());
   setNotice(''); // Never cover the chart's historical date and time on start.
  }catch(e){setError(e instanceof Error?e.message:'Historical candles unavailable. Try another date.')}
  finally{setLoading(false)}
  }
 };
 useEffect(()=>{
  if(!session||!bars.length)return;
  const timer=window.setTimeout(()=>{
   try{localStorage.setItem(sessionKey,JSON.stringify({version:4,day,asset,firstTimestamp:bars[0].time,lastTimestamp:bars[bars.length-1].time,session,firstIndex,notes,costs,annotations,attemptId,finished,timeline:timelineRef.current||undefined} satisfies SavedSession))}catch{}
  },350);return()=>window.clearTimeout(timer);
 },[session,bars,sessionKey,day,firstIndex,notes,costs,annotations,attemptId,finished,timeline]);
 useEffect(()=>{
  if(!session?.trades.length||finished)return;
  const archived=visibleArchivedTrades(uid,attemptId,session.trades);
  const record:PracticeRecord={id:attemptId,kind:'free',asset,day,completedAt:new Date().toISOString(),candlesViewed:session.index-firstIndex,tradeCount:archived.length,net:archived.reduce((sum,t)=>sum+t.net,0),currency:'ZAR',notes:notes.trim().slice(0,3000),trades:archived,annotations};
  const timer=window.setTimeout(()=>{
   try{saveLocalHistory(uid,record)}catch{return}
   void client.savePracticeRecord(record).then(()=>{saveLocalHistory(uid,record,true);onHistoryChange?.()}).catch(()=>{/* Retry from locally saved history in My Progress. */});
  },1150);
  return()=>window.clearTimeout(timer);
 },[session?.trades,annotations,notes,attemptId,asset,day,firstIndex,uid,client,finished]);
 useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),2800);return()=>window.clearTimeout(timer)},[notice]);
 useEffect(()=>{if(!session?.trades.some(t=>t.id===initialReviewTradeId))return;setSelectedTrade(initialReviewTradeId||null);setShowReview(true)},[session?.trades,initialReviewTradeId]);
 useEffect(()=>{const reset=()=>setTicketXY(null);window.addEventListener('resize',reset);return()=>window.removeEventListener('resize',reset)},[]);

 const persistLatestTrades=()=>{
  const current=sessionRef.current;if(!current?.trades.length)return;
  const archived=visibleArchivedTrades(uid,attemptId,current.trades);
  const record:PracticeRecord={id:attemptId,kind:'free',asset,day,completedAt:new Date().toISOString(),candlesViewed:current.index-firstIndex,tradeCount:archived.length,net:archived.reduce((sum,t)=>sum+t.net,0),currency:'ZAR',notes:notes.trim().slice(0,3000),trades:archived,annotations};
  try{saveLocalHistory(uid,record)}catch{return}
  void client.savePracticeRecord(record).then(()=>saveLocalHistory(uid,record,true)).catch(()=>{/* Retained in locally queued history. */});
 };
 const finishPractice=async()=>{
  const current=sessionRef.current;if(!current||finished||savingHistory)return;
  if(current.index<=firstIndex){setError('Reveal at least one candle before finishing your practice.');return}
  if(replayPositions(current).length||current.pending){setError('Close simulated positions and cancel pending orders before finishing.');return}
  setPlaying(false);setError('');setSavingHistory(true);
  const archived=visibleArchivedTrades(uid,attemptId,current.trades);
  const record:PracticeRecord={id:attemptId,kind:'free',asset,day,completedAt:new Date().toISOString(),candlesViewed:current.index-firstIndex,tradeCount:archived.length,net:archived.reduce((sum,t)=>sum+t.net,0),currency:'ZAR',notes:notes.trim().slice(0,3000),trades:archived,annotations};
  try{saveLocalHistory(uid,record);await client.savePracticeRecord(record);saveLocalHistory(uid,record,true);setFinished(true);setNotice('Session and trade reviews saved to your account.');onHistoryChange?.();}
  catch{setError('Could not save this practice on this device. Check browser storage and try again.')}
  finally{setSavingHistory(false)}
 };
 const loadEarlier=async()=>{
  const currentBars=barsRef.current;if(earlierBusyRef.current||noEarlierRef.current||Date.now()<earlierRetryAtRef.current||!currentBars.length||!sessionRef.current)return;
  if(currentBars.length>=50000){noEarlierRef.current=true;setNotice('This device has reached the 50,000-candle chart limit.');return}
  const boundary=Math.floor(currentBars[0].time/86400)*86400000;
  earlierBusyRef.current=true;setLoadingEarlier(true);
  try{
   const history=await historicalData({venue:'research',asset,timeframe:'m1',from:new Date(boundary-7*86400000).toISOString(),to:new Date(boundary).toISOString()});
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
 const advance=useCallback((steps=1)=>{
  const current=sessionRef.current;
  if(!current||!bars.length||finished||preview)return;
  try{const next=timelineRef.current?replayTo(timelineRef.current,Math.min(bars.length-1,current.index+steps),bars,costs):replayAdvance(current,bars,costs,steps);if(next===current||next.index===current.index){setPlaying(false);return}
    setCurrent(next);const added=replayPositions(next).find(p=>!replayPositions(current).some(old=>old.id===p.id));if(added){setSelectedPositionId(added.id);setAdjustStop(String(added.stop));setAdjustTarget(String(added.target));setShowNewOrder(false);setNotice('Pending paper order filled.')}setProgressTime(Date.now());
    if(next.index>=bars.length-1){setPlaying(false);setNotice('Session complete. Review your trade journal and stats.');}
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
  if(!sessionRef.current||finished)return;
  setPlaying(false);setError('');
  if(!preview||preview.side!==side)return;
  try{const previous=sessionRef.current;const sl=Math.abs(preview.entry-preview.stop),tp=Math.abs(preview.target-preview.entry);const next=orderType==='market'?replayEnter(sessionRef.current,bars,side,number(quantity),sl,tp,costs):replayPlacePending(sessionRef.current,bars,side,orderType,preview.entry,number(quantity),sl,tp,costs);
   setPreview(null);recordDecision(next);const opened=replayPositions(next).find(p=>!replayPositions(previous).some(old=>old.id===p.id));if(opened){setSelectedPositionId(opened.id);setAdjustStop(String(opened.stop));setAdjustTarget(String(opened.target))}setShowNewOrder(false);if(next.pending)setManagePending(true);setNotice(orderType!=='market'?'Paper order queued for future candles.':side==='BUY'?'Long opened. Manage the risk; the next candle is still hidden.':'Short opened. Let the market reveal the next candle.');
  }catch(e){setError(e instanceof Error?e.message:'Order rejected')}
 };
 const previewOrder=(side:ReplaySide)=>{
  if(!currentBar)return;setPlaying(false);setError('');
  const entry=orderType==='market'?(side==='BUY'?currentBar.close+costs.spread+costs.slippage:currentBar.close-costs.slippage):(Number(orderPrice)>0?Number(orderPrice):orderType==='limit'?(side==='BUY'?currentBar.close-2:currentBar.close+2):(side==='BUY'?currentBar.close+2:currentBar.close-2));
  const dir=side==='BUY'?1:-1,stop=entry-dir*Number(stopDistance),target=entry+dir*Number(targetDistance);
  if(!Number.isFinite(stop)||!Number.isFinite(target)||stop<=0||target<=0||stop===entry||target===entry){setError('Choose valid stop and target distances.');return;}
  setPreview({side,entry,stop,target,movableEntry:orderType!=='market'});
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
  setPlaying(false);setAttemptId(crypto.randomUUID());setFinished(false);const fresh=beginReplay(bars,firstIndex,number(startingBalance));updateTimeline(newReplayTimeline(fresh));setCurrent(fresh);setAdjustStop('');setAdjustTarget('');setAnnotations({});setNotes('');setNotice('Replay reset. Start again when you are ready.');
 };
 const holdStart=useRef<ReturnType<typeof setTimeout>|null>(null),holdRepeat=useRef<ReturnType<typeof setInterval>|null>(null);
 const stopHold=()=>{if(holdStart.current!==null)clearTimeout(holdStart.current);if(holdRepeat.current!==null)clearInterval(holdRepeat.current);holdStart.current=null;holdRepeat.current=null};
 const beginHold=(dir:'back'|'next')=>{stopHold();holdStart.current=setTimeout(()=>{holdRepeat.current=setInterval(()=>{if(dir==='back')rewind(4);else advance(4)},115)},340)};
 useEffect(()=>()=>stopHold(),[]);
 const dragTicketStart=(e:React.PointerEvent<HTMLDivElement>)=>{
  if(e.button!==0)return;
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
 useEffect(()=>{
  if(!sessionOpen)return;
  const handle=(e:KeyboardEvent)=>{
   if(e.altKey||e.ctrlKey||e.metaKey||showDate||showIndicators||/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName||''))return;
   if(e.key==='ArrowRight'){e.preventDefault();advance(e.repeat?5:1)}
   else if(e.key==='ArrowLeft'){e.preventDefault();rewind(e.repeat?5:1)}
  };
  window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);
 },[sessionOpen,advance,bars,costs,preview,showDate,showIndicators,finished]);
 useEffect(()=>{
  if(!sessionOpen||!chartDiv.current)return;
  const dark=theme==='dark';
  const chart=createChart(chartDiv.current,{autoSize:true,height:420,
   layout:{background:{type:ColorType.Solid,color:dark?'#171a17':'#ffffff'},textColor:dark?'#a0aaa2':'#727d76',fontFamily:'Inter,system-ui,sans-serif',fontSize:11},
   grid:{vertLines:{color:dark?'#263026':'#f2f4f3'},horzLines:{color:dark?'#263026':'#f2f4f3'}},
   timeScale:{borderColor:dark?'#2b322c':'#e5e8e6',timeVisible:true,secondsVisible:false,rightOffset:9},
   rightPriceScale:{borderColor:dark?'#2b322c':'#e5e8e6',scaleMargins:{top:0.13,bottom:0.18}},
   crosshair:{mode:0},localization:{locale:'en-US'},handleScroll:true,handleScale:true
  });
  const series=chart.addSeries(CandlestickSeries,{upColor:'#19a578',downColor:'#db6a6b',borderUpColor:'#19a578',borderDownColor:'#db6a6b',wickUpColor:'#19a578',wickDownColor:'#db6a6b',
   priceFormat:{type:'price',precision:3,minMove:0.001}});
  const ema20=chart.addSeries(LineSeries,{visible:false,color:'#e9b45d',lineWidth:2,title:'EMA 20',priceLineVisible:false,lastValueVisible:false});
  const ema50=chart.addSeries(LineSeries,{visible:false,color:'#88a7ec',lineWidth:2,title:'EMA 50',priceLineVisible:false,lastValueVisible:false});
  const markers=createSeriesMarkers(series,[]);
  const chooseChartPrice=(event:any)=>{if(!pickingRef.current||!event.point)return;const value=series.coordinateToPrice(event.point.y);if(value!==null&&Number.isFinite(value)&&value>0){setOrderPrice(value.toFixed(3));pickingRef.current=false;setPickingPrice(false);setNotice('Paper order price selected from the chart.')}};chart.subscribeClick(chooseChartPrice);
  chartRef.current={chart,series,ema20,ema50,markers,lines:[]};
  const loadAtLeft=(range:any)=>{if(range&&range.from<20)loadEarlierRef.current()};chart.timeScale().subscribeVisibleLogicalRangeChange(loadAtLeft);
  const drawing=installChartTools(chartDiv.current,chart,series,[],`trading-vibes:replay-drawings:${uid}:${day}`,true);drawingRef.current=drawing;
  return()=>{chart.timeScale().unsubscribeVisibleLogicalRangeChange(loadAtLeft);chart.unsubscribeClick(chooseChartPrice);drawingRef.current=null;drawing();chartRef.current=null;chart.remove()};
 },[sessionOpen,theme,day]);
 useEffect(()=>{
  const c=chartRef.current;if(!c||!session)return;
  const follow=Math.abs(c.chart.timeScale().scrollPosition())<=10;
  c.series.setData(aggregates.map(b=>({time:b.time as any,open:b.open,high:b.high,low:b.low,close:b.close})));
  drawingRef.current?.updateCandles(aggregates as any);

  const marks:any[]=[];
  for(const t of session.trades){
   marks.push({time:Math.floor(t.entryTime/(timeframe*60))*(timeframe*60) as any,position:t.side==='BUY'?'belowBar':'aboveBar',shape:'arrowUp',color:t.side==='BUY'?'#19a578':'#db6a6b',text:t.side==='BUY'?'L':'S'});
   marks.push({time:Math.floor(t.exitTime/(timeframe*60))*(timeframe*60) as any,position:t.net>=0?'aboveBar':'belowBar',shape:'circle',color:t.net>=0?'#19a578':'#db6a6b',text:(t.net>=0?'+':'')+t.net.toFixed(1)});
  }
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
 useEffect(()=>{let active=true;if(!sessionOpen)return;void import('../replay-indicators').then(({calculateIndicator})=>{if(!active)return;for(const item of indicatorSeriesRef.current){const lines=calculateIndicator(aggregates,item.spec);item.series.forEach((series,index)=>series.setData(lines[index]?.points||[]));}});return()=>{active=false}},[aggregates,indicators,sessionOpen,theme,day]);
 const percent=bars.length&&session?100*session.index/Math.max(1,bars.length-1):0;
 const selected=session?.trades.find(t=>t.id===selectedTrade);
 const accountStats=session&&<div className="tv-replay-market-stats"><div><span>Account equity</span><strong>{mark?money(mark.equity):'—'}</strong></div><div><span>Session P/L</span><strong className={metrics&&metrics.returnPercent>=0?'is-profit':'is-loss'}>{metrics?(metrics.returnPercent>=0?'+':'')+money(mark!.equity-session.initialBalance):'—'}</strong></div><div><span>Open positions</span><strong>{positions.length}</strong></div><div><span>Margin used</span><strong>{mark?money(mark.marginUsed):'—'}</strong></div><div><span>Trades</span><strong>{session.trades.length}</strong></div></div>;
 return <main className={'tv-replay-backdrop tv-replay-page'+(expanded?' is-expanded':'')}>
  <section ref={modalRef} className={'tv-replay-modal'+(' tv-practice-redesign '+(theme==='light'?'tv-practice-light':'tv-practice-dark'))+(expanded?' is-expanded':'')} aria-label="Market Replay practice terminal">
   <header className="tv-replay-top"><div className="tv-replay-brand"><span className="tv-replay-brand-icon"><BarChart3 size={21}/></span><div><span className="tv-replay-eyebrow">TRADING VIBES · MARKET REPLAY</span><h2>Market Replay</h2></div></div>
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
     <button className="tv-replay-launch" type="button" disabled={loading||!day} onClick={()=>void start()}>{loading?'Loading shared historical candles…':'Launch market replay'} <ArrowRight size={17}/></button>
     {error&&<p className="tv-replay-error" role="alert">{error}</p>}
     <p className="tv-replay-source"><CheckCircle2 size={15}/> ZAR practice balances are simulated. Gold's chart is quoted in USD; paper P/L uses simplified rand units with no live FX conversion. Earlier candles load as you scroll back (50,000-candle limit).</p>
    </div><aside className="tv-replay-setup-aside"><span className="tv-replay-eyebrow">THE PRACTICE LOOP</span>
     {[[Clock3,'Reveal','Watch new candles form one by one.'],[Target,'Execute','Enter trades with stops, targets and costs.'],[Trophy,'Review','Learn from your journal, win rate and drawdown.']].map(([Icon,title,body],i)=><div className="tv-replay-how" key={String(title)}><span>{typeof Icon==='function'?<Icon size={20}/>:i+1}</span><div><strong>{String(title)}</strong><p>{String(body)}</p></div></div>)}
    </aside></div>:
   <div className="tv-replay-terminal">
    <div className="tv-replay-progress"><span style={{width:percent+'%'}}/></div>
    <div className="tv-replay-controls"><div className="tv-replay-playback"><button type="button" aria-label="Rewind one candle" title="Rewind one candle" disabled={!!preview||!timeline||(session.index<=timeline.origin.index&&!!timeline.decisions.length)||session.index<=0} onPointerDown={()=>beginHold('back')} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onClick={()=>rewind()}><SkipBack size={16}/><span className="replay-rewind-text">Rewind</span></button><button className="tv-replay-play" type="button" disabled={replayAtEnd||!!preview} onClick={()=>setPlaying(v=>!v)} aria-label={playing?'Pause replay':'Play replay'}>{playing?<Pause size={16}/>:<Play size={16}/>}<span className="replay-control-text">{playing?'Pause':'Play'}</span></button><button type="button" disabled={replayAtEnd||!!preview} onPointerDown={()=>beginHold('next')} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onClick={()=>advance(1)} title="Next M1 candle (→)"><SkipForward size={16}/><span className="replay-control-text">Step</span></button><button type="button" disabled={replayAtEnd||!!preview} onClick={()=>advance(5)} title="Reveal next 5 completed M1 candles"><FastForward size={16}/><span className="replay-control-text">+5</span></button>
     <label className="tv-replay-speed"><span>Speed</span><select value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{speeds.map(v=><option value={v} key={v}>{v}×</option>)}</select></label></div>
     <div className="tv-replay-chart-controls"><label aria-label="Chart timeframe"> <select aria-label="Chart timeframe" value={timeframe} onChange={e=>setTimeframe(Number(e.target.value) as 1|5|15|60|240|1440)}><option value={1}>1m</option><option value={5}>5m</option><option value={15}>15m</option><option value={60}>1H</option><option value={240}>4H</option><option value={1440}>1D</option></select></label><button type="button" onClick={()=>setShowIndicators(true)} title="Choose indicators"><Settings2 size={14}/> Indicators</button><button type="button" onClick={()=>{setPlaying(false);setPreview(null);setDateDraft(day);setShowDate(true);}} title="Choose a different historical session"><CalendarDays size={15}/><span className="replay-control-text">Date</span></button><button type="button" onClick={()=>void captureChart()} title="Save a clean chart image for your trading journal or content"><Camera size={15}/><span className="replay-control-text">Save Chart</span></button><button type="button" title="Undo drawing (Ctrl+Z)" aria-label="Undo drawing" onClick={()=>drawingRef.current?.undo()}><Undo2 size={15}/> <span className="replay-control-text">Undo</span></button><button type="button" title="Redo drawing (Ctrl+Shift+Z)" aria-label="Redo drawing" onClick={()=>drawingRef.current?.redo()}><Redo2 size={15}/> <span className="replay-control-text">Redo</span></button><button type="button" className={showTicket?'is-selected':''} aria-expanded={showTicket} onClick={()=>{setShowTicket(v=>!v);setShowReview(false)}}><TrendingUp size={15}/> Trade</button><button type="button" className={showReview?'is-selected':''} aria-expanded={showReview} onClick={()=>{setShowReview(v=>!v);setShowTicket(false)}}><BookOpen size={15}/> Review</button></div></div>
    <div className="tv-replay-grid"><div className="tv-replay-chart-panel"><div className="tv-replay-chart-heading"><span><Activity size={15}/> GOLD · {timeframe===1440?'1D':timeframe===240?'4H':timeframe===60?'1H':timeframe+'m'} · REVEALED CANDLES</span><strong>{loadingEarlier?'Loading earlier candles…':Math.max(0,bars.length-1-session.index)+' M1 candles remaining'}</strong></div><div className="tv-replay-chart-wrapper"><div className="tv-replay-chart" ref={chartDiv} tabIndex={0} aria-label="Historical candlestick chart with only revealed candles"/>{preview&&<ReplayPositionPreview chart={chartRef.current?.chart} series={chartRef.current?.series} preview={preview} onChange={v=>{setPreview(v);if(orderType!=='market')setOrderPrice(v.entry.toFixed(3))}}/>}{!preview&&showTicket&&!showNewOrder&&selectedPosition&&(!session.pending||!managePending)&&Number(adjustStop)>0&&Number(adjustTarget)>0&&<ReplayPositionPreview chart={chartRef.current?.chart} series={chartRef.current?.series} preview={{side:selectedPosition.side,entry:selectedPosition.entry,stop:Number(adjustStop),target:Number(adjustTarget),movableEntry:false}} onChange={v=>{setAdjustStop(String(v.stop));setAdjustTarget(String(v.target))}}/>}</div>
     <div className="tv-replay-chart-footer"><span><i className="tv-replay-up"/> Bull candle</span><span><i className="tv-replay-down"/> Bear candle</span><span>Scroll to zoom · Drag to inspect</span></div></div>
     <aside className="tv-replay-ticket" hidden={!showTicket} aria-label="Simulated trade panel" style={ticketXY?{left:ticketXY.x,top:ticketXY.y,right:'auto',bottom:'auto'}:undefined}><div className="replay-ticket-drag" onPointerDown={dragTicketStart} onPointerMove={dragTicketMove} onPointerUp={dragTicketEnd} onPointerCancel={dragTicketEnd}><GripHorizontal size={18}/> Drag to move <span>↔</span></div><button type="button" className="replay-panel-close" aria-label="Close trade panel" onClick={()=>{setPreview(null);setShowTicket(false)}}><X size={16}/></button><span className="tv-replay-eyebrow">PAPER EXECUTION</span><h3>{showNewOrder?'Place a trade':session.pending&&(managePending||!selectedPosition)?'Pending order':selectedPosition?'Open positions':'Place a trade'}</h3>{(selectedPosition||session.pending)&&<button type="button" className="tv-replay-risk-sizing" onClick={()=>setShowNewOrder(v=>!v)}>{showNewOrder?'Manage positions':'Add a trade'}</button>}
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
     <div className="tv-replay-finish"><div><strong>Finished your session?</strong><p>Save your trading journal and review your progress.</p></div><button type="button" disabled={finished||savingHistory} onClick={()=>void finishPractice()}>{finished?'Session saved':savingHistory?'Saving…':'Finish session'}</button></div><div className="tv-replay-journal-head"><div><span className="tv-replay-eyebrow"><Flag size={14}/> SESSION JOURNAL</span><h3>Every trade is a lesson.</h3></div><div><button type="button" disabled={!session.trades.length} onClick={()=>exportJournal(session,annotations,day,costs)}><Download size={15}/> Export CSV</button><button type="button" onClick={reset}><RotateCcw size={15}/> Reset session</button></div></div>
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
