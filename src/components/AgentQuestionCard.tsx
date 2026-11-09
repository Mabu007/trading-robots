import {useState} from 'react';
import {MessageCircleQuestion,Volume2} from 'lucide-react';
import {BrowserVoice} from './BrowserVoice';
import type {TaskQuestion} from '../../shared/agent-task-question.ts';
import {OTHER_ANSWER} from '../../shared/agent-task-question.ts';
import './agent-question-card.css';
export function AgentQuestionCard({question,disabled,onAnswer}:{
 question:TaskQuestion;disabled?:boolean;onAnswer:(answer:string)=>Promise<void>;
}){
 const [other,setOther]=useState(false),[text,setText]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState('');
 const speakQuestion=()=>{
  if(typeof window==='undefined'||!window.speechSynthesis)return;
  window.speechSynthesis.cancel();
  const prompt=new SpeechSynthesisUtterance(question.prompt+' Option one: '+question.options[0]+' Option two: '+question.options[1]+'. Or speak your own answer.');
  prompt.lang='en-ZA';window.speechSynthesis.speak(prompt);
 };
 const voiceReply=(spoken:string)=>{
  const words=spoken.toLowerCase().trim();
  const choice=/^(?:option|number)?\s*(?:one|1|first)\b/.test(words)?question.options[0]:
   /^(?:option|number)?\s*(?:two|2|second)\b/.test(words)?question.options[1]:'Other: '+spoken;
  void submit(choice);
 };
 const submit=async(answer:string)=>{
  if(working||disabled)return;
  setWorking(true);setError('');
  try{await onAnswer(answer)}catch(cause){setError(cause instanceof Error?cause.message:'Could not save your answer')}
  finally{setWorking(false)}
 };
 return <section className="tv-agent-question" role="group" aria-label="VIBES needs your decision">
  <header><MessageCircleQuestion size={18}/><strong>VIBES needs your direction</strong>
   <button type="button" className="tv-agent-question-hear" onClick={speakQuestion} aria-label="Hear VIBES question"><Volume2 size={16}/></button>
   <BrowserVoice disabled={disabled||working} assistantReply="" onTranscript={voiceReply}/>
  </header>
  <p>{question.prompt}</p>
  <div className="tv-agent-question-choices">
   {question.options.map((option,i)=><button type="button" key={i} disabled={working||disabled}
    onClick={()=>void submit(option)}>{option}</button>)}
   <button type="button" disabled={working||disabled} aria-expanded={other} onClick={()=>setOther(v=>!v)}>{OTHER_ANSWER}</button>
  </div>
  {other&&<div className="tv-agent-question-other"><textarea aria-label="Your own instruction to VIBES" rows={2} maxLength={580}
   placeholder="Describe your preferred limits or ask VIBES to explain the risk…" value={text} onChange={e=>setText(e.target.value)}/>
   <button type="button" disabled={working||disabled||text.trim().length<2} onClick={()=>void submit('Other: '+text.trim())}>Send my answer</button>
  </div>}
  <small>{question.context}</small>
  {error&&<p role="alert" className="tv-agent-question-error">{error}</p>}
 </section>;
}
