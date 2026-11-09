import {displayTime} from '../display-time';
import type {AppTheme} from '../theme';
import {useState} from 'react';
import {ArrowUpRight,ChevronDown,Link2} from 'lucide-react';
import type {MarketSource} from '../../shared/market-evidence';
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
export function ChatEvidence({trace}:{trace:ToolTrace[];theme:AppTheme;onAsk?:(question:string)=>void}){
 const [showSources,setShowSources]=useState(false);
 const sources=sourceRows(trace);
 const snapshot=trace.find(item=>item.name==='getPublicMarketEvidence')?.output as {quote?:{coin?:string;asOf:string}}|undefined;
 const time=snapshot?.quote?.asOf;
 const other=trace.filter(item=>!['getPublicMarketEvidence','getWebResearchSources','requestConnectedAppAction'].includes(item.name));
 if(!sources.length&&!other.length)return null;
 return <div className="vibes-evidence">
  {time&&<div className="vibes-evidence-caption">Hyperliquid {snapshot?.quote?.coin??'market'} · {snapshot?.quote?'midpoint':'last close'} · {displayTime(time)}</div>}
  <div className="vibes-evidence-actions">
   {(sources.length>0||other.length>0)&&<button type="button" aria-expanded={showSources} onClick={()=>setShowSources(v=>!v)}><Link2 size={15}/>Sources<ChevronDown size={13}/></button>}
  </div>
  {showSources&&<div className="vibes-source-list">
   {sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span><strong>{source.name}</strong>{source.title&&<span>{source.title}</span>}{source.asOf&&<small>{displayTime(source.asOf)}</small>}</span><ArrowUpRight size={15}/></a>)}
   {other.map(item=><details key={item.id}><summary>{toolTraceLabel(item.name)} · {item.state==='completed'?'Retrieved':'Checking'}</summary>
    {item.output!==undefined&&<pre>{JSON.stringify(item.output,null,2)}</pre>}
    {item.outputTruncated&&<p>Full tool output exceeded the evidence display size.</p>}
   </details>)}
  </div>}
 </div>;
}
