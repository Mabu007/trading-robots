import {displayTime} from '../display-time';
import type {AppTheme} from '../theme';
import {useEffect,useRef,useState} from 'react';
import {ArrowDownRight,ArrowUpRight,ChartCandlestick,ChevronDown,Link2,Sparkles} from 'lucide-react';
import {CandlestickSeries,createChart,createSeriesMarkers,type UTCTimestamp} from 'lightweight-charts';
import type {MarketChartEvidence,MarketSource} from '../../shared/market-evidence';
import {toolTraceLabel,type ToolTrace} from '../tool-trace';
import './chat-evidence.css';

function publicLink(value:unknown){
 if(typeof value!=='string')return null;
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;
 }catch{return null}
}
function sourceRows(trace:ToolTrace[]):MarketSource[]{
 const rows=new Map<string,MarketSource>();
 function add(item:unknown){
  if(!item||typeof item!=='object')return;
  const {url,source,name,title,asOf,dated}=item as Record<string,unknown>;
  const href=publicLink(url);
  if(!href||rows.has(href)||rows.size>=12)return;
  rows.set(href,{url:href,name:String(name??source??new URL(href).hostname).slice(0,100),
   ...(typeof title==='string'?{title:title.slice(0,220)}:{}),
   ...(typeof (asOf??dated)==='string'?{asOf:String(asOf??dated)}:{})});
 }
 for(const item of trace){
  if(!item.output||typeof item.output!=='object')continue;
  const output=item.output as {sources?:unknown;articles?:unknown};
  add(output);
  if(Array.isArray(output.sources))output.sources.forEach(add);
  if(Array.isArray(output.articles))output.articles.forEach(add);
 }
 return [...rows.values()];
}
function verifiedChart(trace:ToolTrace[]){
 const output=trace.find(item=>item.name==='getPublicMarketEvidence'&&item.state==='completed')?.output as {chart?:MarketChartEvidence}|undefined;
 const chart=output?.chart;
 if(!chart||typeof chart.coin!=='string'||!['h1','h4','d1'].includes(chart.timeframe)||!Array.isArray(chart.candles)||!chart.candles.length||
  !chart.candles.every((c,i)=>c&&[c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)&&(i===0||c.time>chart.candles[i-1].time)))return null;
 return chart;
}
function EvidenceChart({evidence,theme}:{evidence:MarketChartEvidence;theme:AppTheme}){
 const host=useRef<HTMLDivElement>(null),card=useRef<HTMLElement>(null);
 useEffect(()=>{card.current?.scrollIntoView({block:'nearest',inline:'nearest'})},[]);
 const [unavailable,setUnavailable]=useState(false);
 useEffect(()=>{
  const el=host.current;
  if(!el)return;
  const dark=theme==='dark';
  const ink=dark?'#b2c1bc':'#475a54',grid=dark?'#273832':'#e3ebe7';
  let chart:ReturnType<typeof createChart>|undefined;
  let observer:ResizeObserver|undefined;
  try{
   chart=createChart(el,{width:el.clientWidth,height:252,layout:{background:{color:dark?'#15211e':'#fdfefd'},textColor:ink,attributionLogo:true},
    localization:{timeFormatter:(time:unknown)=>typeof time==='number'?displayTime(time*1000):String(time)},
    grid:{vertLines:{color:grid},horzLines:{color:grid}},rightPriceScale:{borderColor:grid},timeScale:{borderColor:grid,timeVisible:evidence.timeframe!=='d1'}});
   const series=chart.addSeries(CandlestickSeries,{upColor:dark?'#4cca9d':'#137c5e',downColor:dark?'#f07d87':'#bd3f52',borderVisible:false,wickUpColor:dark?'#4cca9d':'#137c5e',wickDownColor:dark?'#f07d87':'#bd3f52'});
   const bars=evidence.candles.map(c=>({...c,time:c.time as UTCTimestamp}));
   series.setData(bars);
   if(bars.length>1){
    const peak=bars.reduce((a,b)=>b.high>a.high?b:a);
    const trough=bars.reduce((a,b)=>b.low<a.low?b:a);
    createSeriesMarkers(series,[
     {time:peak.time,position:'aboveBar' as const,shape:'arrowDown' as const,color:'#df5965',text:'High'},
     {time:trough.time,position:'belowBar' as const,shape:'arrowUp' as const,color:'#159672',text:'Low'},
    ].sort((a,b)=>a.time-b.time));
   }
   chart.timeScale().fitContent();
   observer=new ResizeObserver(()=>chart?.applyOptions({width:el.clientWidth}));
   observer.observe(el);
  }catch{setUnavailable(true)}
  return()=>{observer?.disconnect();chart?.remove()};
 },[evidence,theme]);
 return <section ref={card} className="vibes-market-chart" aria-label={evidence.coin+' '+evidence.timeframe+' price chart'}>
  <header><div><strong>{evidence.coin} perpetual</strong><span>Hyperliquid · {evidence.timeframe.toUpperCase()} · completed candles</span></div>
   {evidence.trend==='uptrend'?<span className="vibes-chart-regime"><ArrowUpRight size={15}/> Uptrend</span>:evidence.trend==='downtrend'?<span className="vibes-chart-regime"><ArrowDownRight size={15}/> Downtrend</span>:null}</header>
  {unavailable?<p>Chart drawing is unavailable in this browser.</p>:<div className="vibes-chart-canvas" ref={host}/>}
  <footer>Last close · {displayTime(evidence.asOf)}{evidence.candles.length>1?' · UTC axis · arrows mark the displayed high and low.':''}</footer>
 </section>;
}
export function ChatEvidence({trace,onAsk,theme}:{trace:ToolTrace[];theme:AppTheme;onAsk?:(question:string)=>void}){
 const [showChart,setShowChart]=useState(false);
 const [showSources,setShowSources]=useState(false);
 const chart=verifiedChart(trace);
 const sources=sourceRows(trace);
 const snapshot=trace.find(item=>item.name==='getPublicMarketEvidence')?.output as {quote?:{coin?:string;asOf:string}}|undefined;
 const time=snapshot?.quote?.asOf??chart?.asOf;
 const other=trace.filter(item=>!['getPublicMarketEvidence','getWebResearchSources','requestConnectedAppAction'].includes(item.name));
 if(!chart&&!sources.length&&!other.length)return null;
 return <div className="vibes-evidence">
  {time&&<div className="vibes-evidence-caption">Hyperliquid {snapshot?.quote?.coin??chart?.coin} · {snapshot?.quote?'midpoint':'last close'} · {displayTime(time)}</div>}
  <div className="vibes-evidence-actions">
   {chart&&<button type="button" aria-expanded={showChart} onClick={()=>setShowChart(v=>!v)}><ChartCandlestick size={15}/>{showChart?'Hide chart':'View chart'}</button>}
   {chart&&onAsk&&<button type="button" onClick={()=>onAsk('What’s driving '+chart.coin+' right now? Search recent news and distinguish confirmed drivers from possibilities.')}><Sparkles size={15}/>What’s driving it?</button>}
   {(sources.length>0||other.length>0)&&<button type="button" aria-expanded={showSources} onClick={()=>setShowSources(v=>!v)}><Link2 size={15}/>Sources<ChevronDown size={13}/></button>}
  </div>
  {showChart&&chart&&<EvidenceChart evidence={chart} theme={theme}/>}
  {showSources&&<div className="vibes-source-list">
   {sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span><strong>{source.name}</strong>{source.title&&<span>{source.title}</span>}{source.asOf&&<small>{displayTime(source.asOf)}</small>}</span><ArrowUpRight size={15}/></a>)}
   {other.map(item=><details key={item.id}><summary>{toolTraceLabel(item.name)} · {item.state==='completed'?'Retrieved':'Checking'}</summary>
    {item.output!==undefined&&<pre>{JSON.stringify(item.output,null,2)}</pre>}
    {item.outputTruncated&&<p>Full tool output exceeded the evidence display size.</p>}
   </details>)}
  </div>}
 </div>;
}
