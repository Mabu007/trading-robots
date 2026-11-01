import {useState} from 'react';
import type {CloudClient} from '../firebase';
import {ValrPaperDeployment} from './ValrPaperDeployment';
import {ValrLiveDeployment} from './ValrLiveDeployment';

export function ValrDeployment(props:{client:CloudClient;botId:string;market:string;maxRisk:number;initialMode?:'paper'|'live';onModeChange?:(mode:'paper'|'live')=>void;onClose:()=>void;onConnect:()=>void;onLog:(line:string)=>void}) {
 const [mode,setMode]=useState(props.initialMode||'paper');
 const tabs=<div className="market-buttons" role="group" aria-label="Trading mode"><button className={mode==='paper'?'primary':'ghost'} aria-pressed={mode==='paper'} onClick={()=>(setMode('paper'),props.onModeChange?.('paper'))}>Demo (paper)</button><button className={mode==='live'?'primary':'ghost'} aria-pressed={mode==='live'} onClick={()=>(setMode('live'),props.onModeChange?.('live'))}>Live</button></div>;
 return mode==='paper'?<ValrPaperDeployment {...props} modeTabs={tabs}/>:<ValrLiveDeployment {...props} modeTabs={tabs}/>;
}
