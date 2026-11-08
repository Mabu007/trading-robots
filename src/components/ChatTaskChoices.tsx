import {useState} from 'react';
import {ArrowRight,CalendarDays,Check,Keyboard,RotateCcw} from 'lucide-react';
import type {ConversationTask,TradingPreferences} from '../conversation-workflow';
import type {CloudBot} from '../firebase';
export function ChatTaskChoices({task,prefs,bots,onChoose,onCancel,disabled=false}:{
 task:ConversationTask;prefs:TradingPreferences;bots:CloudBot[];onChoose:(choice:string)=>void;onCancel:()=>void;disabled?:boolean;
}){
 const [manual,setManual]=useState(false),[answer,setAnswer]=useState('');
 const [from,setFrom]=useState(''),[to,setTo]=useState('');
 const [kind,setKind]=useState<'short'|'long'|'custom'>('short');
 let question='',choices:{label:string;value:string;description?:string}[]=[];
 if(task.kind==='create'){
  question=!task.asset?'Which market should this new robot trade?':'Where should '+task.asset+' run?';
  if(!task.asset)choices=[
   {label:prefs.useDefaults?'Use my default: '+prefs.preferredAsset+' · '+prefs.preferredVenue:'Gold · PropDAO',value:prefs.useDefaults?prefs.preferredAsset+' on '+prefs.preferredVenue:'GOLDUSDC on propdao',description:'Recommended starting point'},
   {label:'Bitcoin · Hyperliquid',value:'BTCUSDC on hyperliquid'}
  ];
  else choices=[
   {label:'PropDAO',value:'on propdao',description:'Demo account supported'},
   {label:'Hyperliquid',value:'on hyperliquid'}
  ];
 }else if(task.kind==='choose-robot'){
  question='Which saved robot do you mean?';
  choices=task.robotIds.flatMap(id=>{const bot=bots.find(b=>b.id===id);return bot?[{label:bot.name,value:'robot:'+bot.id,description:bot.asset+' · '+String(bot.venue).toUpperCase()}]:[]}).slice(0,2);
 }else{
  question='Choose the historical test dates for '+task.botName+'.';
  choices=[
   {label:'Last 7 completed days',value:'preset:7',description:'UTC · quick validation'},
   {label:'Last 30 completed days',value:'preset:30',description:'UTC · broader sample'}
  ];
 }
 return <section className="tv-task-choices" role="group" aria-label={question}>
  <header><span>{task.kind==='backtest'?<CalendarDays size={17}/>:<Check size={17}/>}</span><div><strong>{question}</strong><small>{task.kind==='backtest'?'Pick the range before VIBES starts the backtest.':'Choose once. VIBES will keep the answer for this conversation.'}</small></div></header>
  <div className="tv-task-choice-options">
   {choices.map((choice,i)=><button type="button" key={choice.value} disabled={disabled} onClick={()=>onChoose(choice.value)}>
    <span className="tv-task-choice-number">{i+1}</span><span><strong>{choice.label}</strong>{choice.description&&<small>{choice.description}</small>}</span><ArrowRight size={14}/></button>)}
   <button type="button" aria-expanded={manual} disabled={disabled} onClick={()=>setManual(value=>!value)}>
    <span className="tv-task-choice-number">3</span><span><strong>{task.kind==='backtest'?'Choose custom dates':'Type my answer'}</strong><small>{task.kind==='backtest'?'Select From and To (UTC)':'Enter a different option'}</small></span><Keyboard size={15}/></button>
  </div>
  {manual&&<form className="tv-task-custom" onSubmit={event=>{event.preventDefault();if(task.kind==='backtest'){if(from&&to&&from<=to)onChoose('dates:'+from+':'+to)}else if(answer.trim())onChoose(answer.trim())}}>
   {task.kind==='backtest'?<div className="tv-task-date-range"><label>From (UTC)<input type="date" value={from} onChange={e=>setFrom(e.target.value)} required/></label><label>To (UTC)<input type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)} required/></label></div>:<label className="tv-task-custom-label">Your answer<input value={answer} onChange={event=>setAnswer(event.target.value)} maxLength={180} placeholder="Your market, venue or robot name…" autoFocus/></label>}
   <button type="submit" disabled={disabled||(task.kind==='backtest'?(!from||!to||from>to):!answer.trim())}>Continue <ArrowRight size={14}/></button>
  </form>}
  <button type="button" disabled={disabled} className="tv-task-cancel" onClick={onCancel}><RotateCcw size={13}/> Cancel this task</button>
 </section>;
}
