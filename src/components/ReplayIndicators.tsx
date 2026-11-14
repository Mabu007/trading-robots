import {useState} from 'react';
import {X} from 'lucide-react';
import type {IndicatorSpec,IndicatorType} from '../replay-indicators';
const types:IndicatorType[]=['EMA','SMA','Bollinger Bands','RSI','MACD','Stochastic','ATR','ADX','Ichimoku'];
export function ReplayIndicators({active,onChange,onClose}:{active:IndicatorSpec[];onChange:(items:IndicatorSpec[])=>void;onClose:()=>void}){
 const [query,setQuery]=useState('');
 const add=(type:IndicatorType)=>onChange([...active,{id:crypto.randomUUID(),type,period:type==='EMA'?20:14,color:'#e8b15b'}]);
 return <div className="tv-replay-date-backdrop" onClick={onClose}><section className="tv-replay-date-dialog replay-indicator-dialog" role="dialog" aria-modal="true" aria-label="Indicators" onClick={e=>e.stopPropagation()}>
  <div><h3>Indicators</h3><button type="button" aria-label="Close indicators" onClick={onClose}><X size={16}/></button></div>
  <p>Studies use only candles revealed in this replay. Volume-based studies are unavailable for this feed. Ichimoku spans are shown without displacement.</p>
  <input aria-label="Search indicators" placeholder="Search indicators" value={query} onChange={e=>setQuery(e.target.value)}/>
  <div className="replay-indicator-list">{types.filter(type=>type.toLowerCase().includes(query.toLowerCase())).map(type=><button type="button" key={type} onClick={()=>add(type)}>{type} <span>+</span></button>)}</div>
  <h4>Active indicators</h4>{active.length?active.map(item=><div className="replay-indicator-active" key={item.id}><strong>{item.type}</strong><input type="number" disabled={item.type==='MACD'||item.type==='Ichimoku'} title={item.type==='MACD'?'Fixed 12 / 26 / 9':item.type==='Ichimoku'?'Fixed 9 / 26 / 52, unshifted':''} min={2} max={200} aria-label={`${item.type} period`} value={item.period} onChange={e=>{const period=Number(e.target.value);if(Number.isInteger(period)&&period>=2&&period<=200)onChange(active.map(x=>x.id===item.id?{...x,period}:x))}}/><input type="color" aria-label={`${item.type} color`} value={item.color} onChange={e=>onChange(active.map(x=>x.id===item.id?{...x,color:e.target.value}:x))}/><button type="button" aria-label={`Remove ${item.type}`} onClick={()=>onChange(active.filter(x=>x.id!==item.id))}><X size={14}/></button></div>):<p>No active indicators.</p>}
 </section></div>;
}
