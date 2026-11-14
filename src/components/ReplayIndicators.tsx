import {useMemo,useState} from 'react';
import {Activity,Check,LineChart,Plus,Search,SlidersHorizontal,Trash2,TrendingUp,X} from 'lucide-react';
import type {IndicatorSpec,IndicatorType} from '../replay-indicators';

type Category='All'|'Trend'|'Momentum'|'Volatility';
const categories:Category[]=['All','Trend','Momentum','Volatility'];
const studies:{type:IndicatorType;category:Exclude<Category,'All'>;description:string;defaultPeriod:number;color:string}[]=[
 {type:'EMA',category:'Trend',description:'Smooth price action and follow the trend.',defaultPeriod:20,color:'#e6aa60'},
 {type:'SMA',category:'Trend',description:'See a classic moving-average baseline.',defaultPeriod:20,color:'#64b7dc'},
 {type:'Ichimoku',category:'Trend',description:'Explore multiple trend reference lines.',defaultPeriod:26,color:'#b999f5'},
 {type:'Bollinger Bands',category:'Volatility',description:'Map a moving average and volatility bands.',defaultPeriod:20,color:'#61c8b1'},
 {type:'ATR',category:'Volatility',description:'Measure the size of recent price moves.',defaultPeriod:14,color:'#ffb772'},
 {type:'RSI',category:'Momentum',description:'Read the strength of recent price movement.',defaultPeriod:14,color:'#cf98ec'},
 {type:'MACD',category:'Momentum',description:'Compare fast and slow momentum.',defaultPeriod:26,color:'#78a7e9'},
 {type:'Stochastic',category:'Momentum',description:'Track closes within recent high–low ranges.',defaultPeriod:14,color:'#e6b76c'},
 {type:'ADX',category:'Trend',description:'Measure trend strength, not direction.',defaultPeriod:14,color:'#84c598'},
];

export function ReplayIndicators({active,onChange,onClose}:{active:IndicatorSpec[];onChange:(items:IndicatorSpec[])=>void;onClose:()=>void}){
 const [query,setQuery]=useState('');
 const [category,setCategory]=useState<Category>('All');
 const [message,setMessage]=useState('');
 const filtered=useMemo(()=>studies.filter(study=>(category==='All'||study.category===category)&&
  (study.type.toLowerCase().includes(query.trim().toLowerCase())||study.description.toLowerCase().includes(query.trim().toLowerCase()))),[query,category]);
 const add=(study:typeof studies[number])=>{
  if(active.length>=12){setMessage('You can display up to 12 studies at a time. Remove one to add another.');return}
  setMessage('');onChange([...active,{id:crypto.randomUUID(),type:study.type,period:study.defaultPeriod,color:study.color}]);
 };
 return <div className="tv-replay-date-backdrop replay-indicator-backdrop" onClick={onClose}>
  <section className="replay-indicator-modal" role="dialog" aria-modal="true" aria-labelledby="replay-indicator-heading" onClick={event=>event.stopPropagation()}>
   <header className="replay-indicator-head">
    <div><span className="replay-indicator-kicker"><LineChart size={15}/> CHART STUDIES</span><h3 id="replay-indicator-heading">Indicators</h3><p>Make the chart yours. Add the tools you need, keep everything else out of the way.</p></div>
    <button type="button" className="replay-indicator-close" aria-label="Close indicators" onClick={onClose}><X size={19}/></button>
   </header>
   <div className="replay-indicator-columns">
    <div className="replay-indicator-browser">
     <label className="replay-indicator-search"><Search size={17}/><input type="search" aria-label="Find indicators" placeholder="Search indicators..." value={query} onChange={event=>setQuery(event.target.value)}/><span>9 STUDIES</span></label>
     <nav className="replay-indicator-filters" aria-label="Indicator categories">{categories.map(item=><button key={item} type="button" className={category===item?'is-active':''} aria-pressed={category===item} onClick={()=>setCategory(item)}>{item}</button>)}</nav>
     <div className="replay-indicator-results" role="group" aria-label="Available indicators">
      {filtered.map(study=>{const count=active.filter(item=>item.type===study.type).length;return <button key={study.type} type="button" className="replay-indicator-option" onClick={()=>add(study)} aria-label={'Add '+study.type}>
       <span className="replay-indicator-symbol" style={{color:study.color}}>{study.category==='Momentum'?<Activity size={21}/>:study.category==='Volatility'?<SlidersHorizontal size={21}/>:<TrendingUp size={21}/>}</span>
       <span className="replay-indicator-option-copy"><strong>{study.type}</strong><small>{study.description}</small></span>
       <span className="replay-indicator-add">{count>0?<Check size={14}/>:<Plus size={17}/>}</span>
      </button>})}
      {filtered.length===0&&<div className="replay-indicator-empty"><Search size={19}/><strong>No matching indicators</strong><p>Try another name or category.</p></div>}
     </div>
    </div>
    <aside className="replay-indicator-active-pane">
     <div className="replay-indicator-pane-heading"><div><span>ON YOUR CHART</span><strong>Active indicators <em>{active.length}</em></strong></div>{active.length>0&&<button type="button" onClick={()=>{onChange([]);setMessage('')}}>Clear all</button>}</div>
     {active.length?<div className="replay-indicator-active-list">{active.map((item,index)=><div className="replay-indicator-study" key={item.id}>
      <div className="replay-indicator-study-heading"><span className="replay-indicator-study-dot" style={{background:item.color}}/><strong>{item.type}</strong><small>#{index+1}</small><button type="button" className="replay-indicator-remove" aria-label={'Remove '+item.type} onClick={()=>onChange(active.filter(x=>x.id!==item.id))}><Trash2 size={15}/></button></div>
      <div className="replay-indicator-study-options"><label>Period<input type="number" min={2} max={200} step={1} aria-label={item.type+' period'} disabled={item.type==='MACD'||item.type==='Ichimoku'} value={item.period} onChange={event=>{const period=Number(event.target.value);if(Number.isInteger(period)&&period>=2&&period<=200)onChange(active.map(x=>x.id===item.id?{...x,period}:x))}}/></label><label>Line colour<input type="color" aria-label={item.type+' line colour'} value={item.color} onChange={event=>onChange(active.map(x=>x.id===item.id?{...x,color:event.target.value}:x))}/></label></div>
     </div>)}</div>:<div className="replay-indicator-nothing"><div><LineChart size={25}/></div><strong>Start with a clear chart.</strong><p>Indicators are optional. Choose one from the library when you need it.</p></div>}
     <div className="replay-indicator-footnote">Indicators only use revealed candles. Volume-based studies are unavailable. Ichimoku spans are displayed without displacement.</div>
    </aside>
   </div>
   <footer className="replay-indicator-footer"><span role="status">{message||'Changes appear instantly on your replay chart.'}</span><button type="button" onClick={onClose}>Done <Check size={16}/></button></footer>
  </section>
 </div>;
}
