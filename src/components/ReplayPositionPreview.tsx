import {useEffect,useState} from 'react';
import type {ReplaySide} from '../market-replay-engine';

export type PositionPreview={side:ReplaySide;entry:number;stop:number;target:number;movableEntry:boolean};
type Props={chart:any;series:any;preview:PositionPreview;onChange:(preview:PositionPreview)=>void};
/** Pointer-only handles sit above the drawing layer; unoccupied space passes through. */
export function ReplayPositionPreview({chart,series,preview,onChange}:Props){
 const [,redraw]=useState(0);
 useEffect(()=>{if(!chart)return;const update=()=>redraw(n=>n+1);chart.timeScale().subscribeVisibleLogicalRangeChange(update);window.addEventListener('resize',update);return()=>{chart.timeScale().unsubscribeVisibleLogicalRangeChange(update);window.removeEventListener('resize',update)}},[chart]);
 if(!series)return null;
 const e=series.priceToCoordinate(preview.entry),s=series.priceToCoordinate(preview.stop),t=series.priceToCoordinate(preview.target);
 if(e===null||s===null||t===null)return null;
 const drag=(which:'entry'|'stop'|'target')=>(event:React.PointerEvent<HTMLButtonElement>)=>{
  event.preventDefault();event.stopPropagation();const el=event.currentTarget,host=el.parentElement;if(!host)return;el.setPointerCapture(event.pointerId);
  const move=(ev:PointerEvent)=>{const value=series.coordinateToPrice(ev.clientY-host.getBoundingClientRect().top);if(value===null||!Number.isFinite(value)||value<=0)return;const v=Math.round(value*1000)/1000;
   if(which==='entry'){const delta=v-preview.entry;onChange({...preview,entry:v,stop:Math.max(.001,preview.stop+delta),target:Math.max(.001,preview.target+delta)});}
   else if(which==='stop'&&(preview.side==='BUY'?v<preview.entry:v>preview.entry))onChange({...preview,stop:v});
   else if(which==='target'&&(preview.side==='BUY'?v>preview.entry:v<preview.entry))onChange({...preview,target:v});
  };
  const end=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end)};
  el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
 };
 return <div className="replay-position-preview" aria-label="Editable order preview">
  <div className="replay-position-zone risk" style={{top:Math.min(e,s),height:Math.abs(e-s)}}/>
  <div className="replay-position-zone reward" style={{top:Math.min(e,t),height:Math.abs(e-t)}}/>
  {([['target',t,'TARGET',preview.target],['entry',e,'ENTRY',preview.entry],['stop',s,'STOP',preview.stop]] as const).map(([key,y,label,value])=><button key={key} type="button" className={'replay-position-line '+key} style={{top:y}} onPointerDown={key==='entry'&&!preview.movableEntry?undefined:drag(key)} aria-label={`${key} ${value.toFixed(3)}${key==='entry'&&!preview.movableEntry?'':' draggable'}`}><span>{label} · {value.toFixed(3)}</span></button>)}
 </div>;
}
