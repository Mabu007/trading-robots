import {useMemo} from 'react';
import {defineRegistry,Renderer,StateProvider,VisibilityProvider,ActionProvider} from '@json-render/react';
import {Activity,AlertTriangle,BookOpen,ChartCandlestick,Clock3,ExternalLink,FileCheck,Newspaper,ShieldCheck} from 'lucide-react';
import {BacktestChatCard,type BacktestCardData} from './BacktestChatCard';
import {AnalysisChatCard} from './AnalysisChatCard';
import type {MarketReport} from '../code-analysis';
import {tradingCatalog,visualSpec,type TradingComponentName} from '../visuals/catalog';
import './trading-visuals.css';

type Evidence=Record<string,any>;
type Kind='trade-audit'|'backtest-result'|'market-analysis'|'news-snapshot'|'candlestick-chart'|'equity-curve'|'broker-accounts'|'strategy-card'|'risk-breakdown'|'monitor-status'|'action-approval'|'news-coverage';
const layout:Record<Kind,TradingComponentName>={
 'trade-audit':'TradeInspection','backtest-result':'BacktestSummary','market-analysis':'MarketSnapshot','news-snapshot':'NewsSnapshot','candlestick-chart':'CandlestickChart','equity-curve':'EquityCurve','broker-accounts':'BrokerAccounts','strategy-card':'StrategyCard','risk-breakdown':'RiskBreakdown','monitor-status':'MonitorStatus','action-approval':'ActionApproval','news-coverage':'NewsCoverage'
};
const num=(v:unknown,decimals=4)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:decimals}):typeof v==='string'&&v.trim()&&Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:decimals}):'—';
const str=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():'—';
const first=(r:Evidence,...keys:string[])=>keys.map(k=>r[k]).find(v=>v!==null&&v!==undefined&&v!=='');
const date=(v:unknown)=>{if(typeof v!=='number'&&typeof v!=='string')return '—';const ms=typeof v==='number'?v:/^\d+$/.test(v)?Number(v):Date.parse(v);return Number.isFinite(ms)&&!Number.isNaN(new Date(ms).getTime())?new Date(ms).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC':'—';};
function Section({title,source,children}:{title:string;source?:string;children:React.ReactNode}){return <section className="tv-viz" aria-label={title}><header className="tv-viz-head"><strong>{title}</strong>{source&&<small>{source}</small>}</header>{children}</section>}
function Missing({message}:{message:string}){return <p className="tv-viz-missing"><AlertTriangle size={15}/>{message}</p>}
function Metrics({items}:{items:{label:string;value:string;hint?:string}[]}){return <div className="tv-viz-metrics">{items.map(item=><div key={item.label}><small>{item.label}</small><strong>{item.value}</strong>{item.hint&&<span>{item.hint}</span>}</div>)}</div>}
function Trade({record}:{record:Evidence}){
 const r=(record.providerRecord||record.trade||{}) as Evidence;
 const side=str(first(r,'side','direction','orderSide')).toUpperCase(),entry=first(r,'entry','entryPrice','avgEntryPrice','averageEntryPrice'),exit=first(r,'exit','exitPrice','avgExitPrice','averageExitPrice'),q=first(r,'quantity','qty','size','volume'),pnl=first(r,'pnl','realizedPnl','realizedPnL','profit'),fee=first(r,'fee','fees');
 const canCheck=['SELL','BUY'].includes(side)&&[entry,exit,q].every(v=>Number.isFinite(Number(v)))&&Number(q)>0;
 const change=canCheck?(side==='SELL'?Number(entry)-Number(exit):Number(exit)-Number(entry))*Number(q):null;
 return <Section title="Verified trade inspection" source={str(record.source)}><div className="tv-viz-caption">{str(record.venue).toUpperCase()} · {str(record.asset)} · {str(record.tradeKind)}</div>
 <Metrics items={[{label:'Reported PnL',value:num(pnl),hint:'Currency/gross-net definition unverified'},{label:'Side',value:side},{label:'Quantity',value:num(q,7)},{label:'Reported fee',value:num(fee)}]}/>
 <div className="tv-viz-fields"><span>Entry<strong>{num(entry,7)}</strong></span><span>Exit<strong>{num(exit,7)}</strong></span><span>Exit reason<strong>{str(first(r,'reason','closeReason','exitReason'))}</strong></span><span>Closed / UTC<strong>{date(first(r,'closedAt','closeTime','closeTimestamp'))}</strong></span></div>
 {canCheck&&<p className="tv-viz-foot">Price × quantity calculation: {num(change,7)} before fees. Provider PnL may use contract multipliers, currency conversions, funding or fee conventions not supplied here.</p>}
 <details><summary>Provider evidence</summary><p>Record ID: {str(first(r,'id','recordId','orderId','tradeId'))}</p><p>Opened: {date(first(r,'openedAt','openTime','entryTime'))}. Closed: {date(first(r,'closedAt','closeTime','exitTime'))}.</p><p>{str(record.limitations)}</p></details></Section>;
}
type Bar={time:number;open:number;high:number;low:number;close:number};
function checkedBars(input:unknown):Bar[]{
 if(!Array.isArray(input))return [];
 const bars:Bar[]=[];
 for(const b of input.slice(-140)){if(!b||typeof b!=='object')continue;const time=Number(b.time||b.t),open=Number(b.open??b.o),high=Number(b.high??b.h),low=Number(b.low??b.l),close=Number(b.close??b.c);if([time,open,high,low,close].every(Number.isFinite)&&high>=Math.max(open,close)&&low<=Math.min(open,close)&&high>=low)bars.push({time,open,high,low,close});}
 return bars.sort((a,b)=>a.time-b.time).filter((b,i,a)=>i===0||b.time>a[i-1].time).slice(-90);
}
function Candles({record}:{record:Evidence}){
 const bars=checkedBars(record.candles);
 if(bars.length<2)return <Section title="Candlestick chart"><Missing message="No validated OHLC candle series is attached to this response. A chart cannot be reconstructed from a trade fill."/></Section>;
 const min=Math.min(...bars.map(b=>b.low)),max=Math.max(...bars.map(b=>b.high)),range=max-min||1,width=700,height=230,padding=16,step=(width-2*padding)/bars.length;
 const y=(v:number)=>height-padding-(v-min)/range*(height-2*padding);
 return <Section title="Verified OHLC chart" source={str(record.source)}><div className="tv-viz-caption">{str(record.asset)} · {str(record.timeframe)} · {bars.length} candles</div><svg role="img" aria-label="OHLC candlesticks from supplied market data" className="tv-viz-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">{bars.map((bar,i)=>{const x=padding+(i+.5)*step,up=bar.close>=bar.open;return <g key={bar.time} fill={up?'#16a085':'#e36a70'} stroke={up?'#16a085':'#e36a70'}><line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)}/><rect x={x-Math.max(1,step*.28)} y={Math.min(y(bar.open),y(bar.close))} width={Math.max(2,step*.56)} height={Math.max(1,Math.abs(y(bar.open)-y(bar.close)))}/></g>})}</svg><p className="tv-viz-foot">OHLC supplied by {str(record.source)}. This chart does not establish the broker's fill sequence or execution slippage.</p></Section>;
}
function Equity({record}:{record:Evidence}){
 const rows=Array.isArray(record.points)?record.points:Array.isArray(record.trades)?record.trades:[];
 const values=rows.map((r:any)=>Number(r?.equity??r?.pnl)).filter(Number.isFinite);
 if(values.length<2)return <Section title="Equity curve"><Missing message="No verified result series supplied for this chart."/></Section>;
 const cumulative=Array.isArray(record.points)?values:values.reduce<number[]>((a,n)=>[...a,(a.at(-1)||0)+n],[]);
 const min=Math.min(...cumulative),max=Math.max(...cumulative),range=max-min||1;
 const path=cumulative.map((n,i)=>`${i===0?'M':'L'}${16+i*(668/Math.max(cumulative.length-1,1))},${212-(n-min)/range*190}`).join(' ');
 return <Section title="Equity progression" source={str(record.source)}><svg className="tv-viz-chart" viewBox="0 0 700 230" role="img" aria-label="Equity or simulated R progression"><path d={path} fill="none" stroke="currentColor" strokeWidth="2.5"/></svg><p className="tv-viz-foot">{Array.isArray(record.points)?'Provider-supplied equity progression':'Cumulative simulated R from saved backtest trades; not account equity.'}</p></Section>;
}
function News({record}:{record:Evidence}){
 const items=Array.isArray(record.articles)?record.articles:[];
 return <Section title="News snapshot" source="GDELT DOC 2.0"><div className="tv-viz-caption"><Newspaper size={16}/> {str(record.topic).toUpperCase()} · {str(record.span)} · Fetched {date(record.fetchedAt)}</div>{items.length?<div className="tv-viz-news">{items.slice(0,12).map((a:any,i:number)=><article key={String(a.url||i)}><a href={String(a.url)} target="_blank" rel="noopener noreferrer"><strong>{str(a.title)}</strong><ExternalLink size={13}/></a><small>{str(a.domain)}{a.sourceCountry?' · '+str(a.sourceCountry):''} · {a.seenAt?'Indexed '+date(a.seenAt):'Index time unavailable'}</small></article>)}</div>:<Missing message="No verified headlines were returned for this topic and window."/>}<p className="tv-viz-foot">{str(record.note)} Headlines are not a validated explanation for a price move.</p></Section>;
}
function NewsCoverage({record}:{record:Evidence}){
 const rows=Array.isArray(record.points)?record.points:[],values=rows.map((p:any)=>Number(p?.articles)).filter((n:number)=>Number.isFinite(n)&&n>=0);
 if(values.length<2)return <Section title="GDELT news coverage"><Missing message="No verified article-count history was returned."/></Section>;
 const high=Math.max(...values,1),w=700,h=190;
 const points=values.map((value:number,i:number)=>[12+i*(w-24)/Math.max(values.length-1,1),h-12-(value/high)*(h-24)] as const);
 return <Section title="News coverage over time" source="GDELT DOC 2.0"><div className="tv-viz-caption">{str(record.topic).toUpperCase()} · {str(record.span)} · Fetched {date(record.fetchedAt)}</div><svg className="tv-viz-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="GDELT indexed article count trend"><polyline points={points.map(([x,y])=>`${x},${y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={2.5}/></svg><p className="tv-viz-foot">This shows GDELT article coverage only. It is not a price indicator, sentiment signal, or traded volume. {str(record.note)}</p></Section>;
}
function Accounts({record}:{record:Evidence}){
 const accounts=Array.isArray(record.accounts)?record.accounts:[];return <Section title="Broker accounts" source={str(record.source)}>{accounts.length?<div className="tv-viz-list">{accounts.slice(0,15).map((a:any,i:number)=><div key={String(a.id||i)}><strong>{str(a.venue)} · {str(a.label||a.id)}</strong><span>Equity {num(a.equity)} {str(a.currency)} · {str(a.status)}</span></div>)}</div>:<Missing message="No authenticated broker account snapshot is attached."/>}</Section>;
}
function Strategy({record}:{record:Evidence}){return <Section title="Saved strategy" source={str(record.source)}>{record.name?<Metrics items={[{label:'Strategy',value:str(record.name)},{label:'Asset',value:str(record.asset)},{label:'Venue',value:str(record.venue)},{label:'State',value:str(record.status)}]}/>:<Missing message="No verified saved strategy is attached."/>}</Section>}
function Risk({record}:{record:Evidence}){return <Section title="Risk breakdown" source={str(record.source)}>{record.currency&&Number.isFinite(Number(record.equity))?<Metrics items={[{label:'Equity',value:num(record.equity)+' '+record.currency},{label:'Daily room',value:num(record.dailyLossRoom)+' '+record.currency},{label:'Max drawdown room',value:num(record.maxDrawdownRoom)+' '+record.currency},{label:'Open exposure',value:num(record.exposure)+' '+record.currency}]}/>:<Missing message="No verified account-level risk snapshot with a defined currency is attached."/>}</Section>}
function Market({record}:{record:Evidence}){return record.kind&&record.asset&&record.timeframe&&Array.isArray(record.findings)?<AnalysisChatCard report={record as MarketReport}/>:<Section title="Market snapshot"><Missing message="No timestamped market data is attached. News headlines do not substitute for prices."/></Section>}
function Monitor({record}:{record:Evidence}){return <Section title="Cloudflare monitor" source={str(record.source)}>{record.verified===true?<Metrics items={[{label:'Verified runtime',value:record.running?'Running':'Stopped'},{label:'Asset',value:str(record.asset)},{label:'Last checked',value:date(record.lastCheck)},{label:'Next alarm',value:date(record.nextAlarm)}]}/>:<Missing message="Watch status not verified with Cloudflare; do not assume a monitor is running."/>}</Section>}
function Approval({record}:{record:Evidence}){return <Section title="Action review"><p><ShieldCheck size={16}/> {str(record.description)} — requires approval through the existing authenticated Trading Vibes action review.</p><p className="tv-viz-foot">This visual panel does not submit trades, deployments or account changes.</p></Section>}
function registryFor(record:Evidence,recordId:string){
 const read=(id:string)=>id===recordId?record:null;
 const missing=<Missing message="This component references no verified evidence in this response."/>;
 return defineRegistry(tradingCatalog,{components:{
  TradeInspection:({props})=>read(props.recordId)?<Trade record={record}/>:missing,
  CandlestickChart:({props})=>read(props.recordId)?<Candles record={record}/>:missing,
  BacktestSummary:({props})=>read(props.recordId)&&record.botId?<BacktestChatCard data={record as BacktestCardData}/>:missing,
  EquityCurve:({props})=>read(props.recordId)?<Equity record={record}/>:missing,
  BrokerAccounts:({props})=>read(props.recordId)?<Accounts record={record}/>:missing,
  StrategyCard:({props})=>read(props.recordId)?<Strategy record={record}/>:missing,
  RiskBreakdown:({props})=>read(props.recordId)?<Risk record={record}/>:missing,
  MarketSnapshot:({props})=>read(props.recordId)?<Market record={record}/>:missing,
  MonitorStatus:({props})=>read(props.recordId)?<Monitor record={record}/>:missing,
  ActionApproval:({props})=>read(props.recordId)?<Approval record={record}/>:missing,
  NewsSnapshot:({props})=>read(props.recordId)?<News record={record}/>:missing,
  NewsCoverage:({props})=>read(props.recordId)?<NewsCoverage record={record}/>:missing,
 },actions:{}});
}
export function TradingVisualResponse({kind,data}:{kind:Kind;data:Evidence}){
 const recordId=String(data?.providerRecord?.id||data?.botId||data?.topic||kind).slice(0,160);
 const spec=useMemo(()=>visualSpec(layout[kind],recordId),[kind,recordId]);
 const registered=useMemo(()=>registryFor(data,recordId),[data,recordId]);
 if(!spec)return null;
 return <div className="tv-viz-container"><StateProvider initialState={{}}><VisibilityProvider><ActionProvider><Renderer spec={spec} registry={registered.registry}/></ActionProvider></VisibilityProvider></StateProvider></div>;
}
