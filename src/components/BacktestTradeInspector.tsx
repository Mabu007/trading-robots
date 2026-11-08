import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Activity,AlertTriangle,ChartCandlestick,Expand,Minimize2,Sparkles,X} from 'lucide-react';
import {CandlestickSeries,LineStyle,createChart,createSeriesMarkers,type UTCTimestamp} from 'lightweight-charts';
import type {StrategyRun} from '../strategy-workbench';
import type {Trade,Candle} from '../types';
import type {AppTheme} from '../theme';
import {displayTime} from '../display-time';
import {createBacktestTradeAudit} from '../trade-audit-context';
import './backtest-trade-inspector.css';

const fmt=(value:number)=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:5}).format(value):'—';
function nearest(candles:Candle[],unix:number){
 const index=candles.findIndex(c=>c.time>=unix);
 return index>=0?index:candles.length-1;
}
export function BacktestTradeInspector({run,tradeId,onClose,onAskAI,theme='light'}:{
 run:StrategyRun;tradeId:number;onClose:()=>void;onAskAI:((trade:Trade)=>void)|undefined;theme?:AppTheme;
}){
 const host=useRef<HTMLDivElement>(null),section=useRef<HTMLElement>(null);
 const [chartError,setChartError]=useState('');
 const [expanded,setExpanded]=useState(false);
 const [focus,setFocus]=useState<'all'|'entry'|'exit'|'stop'|'target'>('all');

 const audit=useMemo(()=>createBacktestTradeAudit(run,tradeId),[run,tradeId]);
 const trade=audit.trade;
 const clip=useMemo(()=>{
  const candles=run.result.candles;
  if(!candles.length)return [];
  const start=nearest(candles,trade.entryTime),finish=nearest(candles,trade.exitTime);
  if(finish<start)return [];
  const first=Math.max(0,start-35),last=Math.min(candles.length,finish+36);
  // Honest full-width chart: retain every bar in the trade window, no fabricated
  // interpolation or connecting separated entry and exit samples.
  if(last-first>3000)return [];
  return candles.slice(first,last);
 },[run,trade]);
 useEffect(()=>{if(!expanded)section.current?.scrollIntoView({block:'nearest',behavior:'smooth'})},[tradeId,expanded]);
 useEffect(()=>{
  if(!expanded)return;
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setExpanded(false)}};
  document.addEventListener('keydown',onKey,true);
  const old=document.body.style.overflow;
  document.body.style.overflow='hidden';
  return()=>{document.removeEventListener('keydown',onKey,true);document.body.style.overflow=old};
 },[expanded]);

 useEffect(()=>{
  const el=host.current;
  if(!el||clip.length===0)return;
  let chart:ReturnType<typeof createChart>|undefined;
  let observer:ResizeObserver|undefined;
  try{
   const dark=theme==='dark',grid=dark?'#273d35':'#e1eae5',ink=dark?'#bbd0c4':'#465b51';
   chart=createChart(el,{width:el.clientWidth,height:expanded?Math.max(330,Math.round(window.innerHeight*.66)):Math.max(260,Math.min(390,Math.round(window.innerHeight*.43))),
    layout:{background:{color:dark?'#112019':'#fff'},textColor:ink,attributionLogo:true},
    grid:{vertLines:{color:grid},horzLines:{color:grid}},
    rightPriceScale:{borderColor:grid,scaleMargins:{top:0.18,bottom:0.16}},
    timeScale:{borderColor:grid,timeVisible:true,secondsVisible:false},
    localization:{timeFormatter:(time:unknown)=>typeof time==='number'?displayTime(time*1000):String(time)}});
   const series=chart.addSeries(CandlestickSeries,{
    autoscaleInfoProvider:(original:()=>any)=>{
     const info=original();
     if(!info)return null;
     const prices=[trade.entry,trade.exit,trade.stop,trade.target,info.priceRange.minValue,info.priceRange.maxValue];
     const low=Math.min(...prices),high=Math.max(...prices),padding=Math.max((high-low)*.05,.00001);
     return {...info,priceRange:{minValue:low-padding,maxValue:high+padding}};
    },
    upColor:dark?'#4fd4a1':'#14845c',
    downColor:dark?'#ed7b81':'#c14c58',wickUpColor:dark?'#4fd4a1':'#14845c',
    wickDownColor:dark?'#ed7b81':'#c14c58',borderVisible:false});
   series.setData(clip.map(c=>({time:c.time as UTCTimestamp,open:c.open,high:c.high,low:c.low,close:c.close})));
   series.createPriceLine({price:trade.entry,color:focus==='entry'?'#efc263':'#9daab0',lineWidth:focus==='entry'?2:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:'ENTRY'});
   series.createPriceLine({price:trade.stop,color:'#d85b66',lineWidth:focus==='stop'?2:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:'STOP'});
   series.createPriceLine({price:trade.target,color:'#16a276',lineWidth:focus==='target'?2:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:'TARGET'});
   const entry=clip[nearest(clip,trade.entryTime)],exit=clip[nearest(clip,trade.exitTime)];
   if(entry&&exit)createSeriesMarkers(series,[
    {time:entry.time as UTCTimestamp,position:(trade.side==='LONG'?'belowBar':'aboveBar') as 'belowBar'|'aboveBar',
     shape:(trade.side==='LONG'?'arrowUp':'arrowDown') as 'arrowUp'|'arrowDown',color:'#229c7d',text:'Entry'},
    {time:exit.time as UTCTimestamp,position:(trade.side==='LONG'?'aboveBar':'belowBar') as 'aboveBar'|'belowBar',
     shape:(trade.side==='LONG'?'arrowDown':'arrowUp') as 'arrowDown'|'arrowUp',color:'#e29b3f',text:'Exit'}
   ].sort((a,b)=>Number(a.time)-Number(b.time)));
   chart.timeScale().fitContent();
   if(focus!=='all'){
    const point=focus==='exit'?trade.exitTime:trade.entryTime;
    const idx=nearest(clip,point);
    chart.timeScale().setVisibleLogicalRange({from:Math.max(0,idx-25),to:Math.min(clip.length-1,idx+25)});
   }
   if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>{if(el.clientWidth>0)chart?.applyOptions({width:el.clientWidth})});observer.observe(el)}
  }catch{setChartError('This browser cannot draw the trade chart. The recorded prices remain available below.')}
  return()=>{observer?.disconnect();chart?.remove()};
 },[clip,theme,trade,expanded,focus]);
 const surface=<section className={"tv-trade-inspector"+(expanded?" is-expanded":"")} ref={section} aria-label={'Inspect backtest trade '+tradeId}>
  <header className="tv-trade-inspector-head"><div><span className="tv-trade-inspector-eyebrow"><ChartCandlestick size={15}/> BACKTEST TRADE · #{trade.id}</span>
   <h3>{run.asset} · {trade.side} · <strong className={trade.pnl>=0?'positive':'negative'}>{trade.pnl>=0?'+':''}{fmt(trade.pnl)}R</strong></h3>
   <small>{(run.result.timeframe||'m1').toUpperCase()} · {displayTime(trade.entryTime*1000)} to {displayTime(trade.exitTime*1000)}</small></div>
   <div className="tv-trade-inspector-head-actions">
    <button type="button" className="tv-trade-inspector-close" onClick={()=>setExpanded(x=>!x)} aria-label={expanded?'Exit full screen chart':'Expand trade chart to full screen'}>{expanded?<Minimize2 size={17}/>:<Expand size={17}/>}</button>
    <button type="button" className="tv-trade-inspector-close" onClick={onClose} aria-label="Close trade inspection"><X size={17}/></button>
   </div></header>
  <div className="tv-trade-inspector-chart-toolbar" role="group" aria-label="Zoom to entry exit stop target">
   {([{key:'all',label:'Full trade',price:null},{key:'entry',label:'Entry',price:trade.entry},{key:'exit',label:'Exit',price:trade.exit},{key:'stop',label:'Stop',price:trade.stop},{key:'target',label:'Target',price:trade.target}] as const).map(item=>
    <button type="button" key={item.key} aria-pressed={focus===item.key} className={'tv-chart-focus tv-chart-'+item.key+(focus===item.key?' is-selected':'')}
     onClick={()=>setFocus(item.key)}>{item.label}{item.price!==null&&<strong>{fmt(item.price)}</strong>}</button>)}
  </div>
  {clip.length>0?<div ref={host} className="tv-trade-inspector-chart" role="img" aria-label={'Candlestick chart showing entry and exit markers and entry stop and target price lines for trade '+trade.id}/>:<div className="tv-trade-inspector-empty"><AlertTriangle size={16}/> Chart unavailable for this trade: complete entry-to-exit candles are missing or exceed the safe display limit.</div>}
  {chartError&&<p role="status">{chartError}</p>}
  <div className="tv-trade-inspector-facts">
   <div><small>Entry</small><strong>{fmt(trade.entry)}</strong></div>
   <div><small>Exit</small><strong>{fmt(trade.exit)}</strong></div>
   <div><small>Stop</small><strong>{fmt(trade.stop)}</strong></div>
   <div><small>Target</small><strong>{fmt(trade.target)}</strong></div>
   <div><small>Result</small><strong className={trade.pnl>=0?'positive':'negative'}>{fmt(trade.pnl)}R</strong></div>
   <div><small>Exit reason</small><strong>{trade.reason}</strong></div>
  </div>
  <p className="tv-trade-inspector-note"><Activity size={14}/> {audit.historySource}. Historical OHLC cannot prove the intrabar price sequence or broker fills.</p>
  <footer className="tv-trade-inspector-actions">
   <button type="button" className="tv-inspect-ai" disabled={!onAskAI} onClick={()=>onAskAI?.(trade)}><Sparkles size={16}/> Ask VIBES to analyse this trade</button>
   <button type="button" className="tv-inspect-dismiss" onClick={onClose}>Close inspection</button>
  </footer>
 </section>;
 return expanded&&typeof document!=='undefined'?createPortal(surface,document.body):surface;
}
