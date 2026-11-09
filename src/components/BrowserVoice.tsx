import {useEffect,useRef,useState} from 'react';
import {Mic,MicOff,Volume2} from 'lucide-react';
import './browser-voice.css';
type SpeechResult={isFinal:boolean;0:{transcript:string}};
type SpeechEvent={resultIndex:number;results:ArrayLike<SpeechResult>};
type BrowserRecognition={
 lang:string;continuous:boolean;interimResults:boolean;
 onresult:((e:SpeechEvent)=>void)|null;onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;
 start:()=>void;stop:()=>void;abort:()=>void;
};
type SpeechConstructor=new()=>BrowserRecognition;
function recognitionConstructor():SpeechConstructor|undefined{
 if(typeof window==='undefined')return undefined;
 const browser=window as unknown as {SpeechRecognition?:SpeechConstructor;webkitSpeechRecognition?:SpeechConstructor};
 return browser.SpeechRecognition||browser.webkitSpeechRecognition;
}
export function speakable(source:string):string{
 return source.replace(/\x60{3}[\s\S]*?\x60{3}/g,'Code omitted from spoken response.')
  .replace(/https?:\/\/\S+/g,'a link').replace(/[*_#\x60~]/g,'')
  .replace(/\[[^\]]+\]\([^)]+\)/g,'a link')
  .replace(/\s+/g,' ').trim().slice(0,780);
}
/** Trading Vibes does not upload audio itself; the browser's speech-recognition
 * implementation may process microphone input remotely.
 * Only the transcript is passed to the authenticated chat interface. */
export function BrowserVoice({onTranscript,assistantReply,replyReady=true,disabled=false}:{
 onTranscript:(text:string)=>void;assistantReply:string;replyReady?:boolean;disabled?:boolean;
}){
 const [available,setAvailable]=useState(false),[listening,setListening]=useState(false);
 const [message,setMessage]=useState(''),[speaking,setSpeaking]=useState(false);
 const recognition=useRef<BrowserRecognition|null>(null);
 const text=useRef(''),finalText=useRef('');
 const pending=useRef(false),previousAnswer=useRef('');
 const onTranscriptRef=useRef(onTranscript);onTranscriptRef.current=onTranscript;
 useEffect(()=>{setAvailable(Boolean(recognitionConstructor()));return()=>{
  recognition.current?.abort();recognition.current=null;
  if(typeof window!=='undefined')window.speechSynthesis?.cancel();
 };},[]);
 useEffect(()=>{
  if(!pending.current||!replyReady||!assistantReply||assistantReply===previousAnswer.current)return;
  pending.current=false;
  if(typeof window==='undefined'||!window.speechSynthesis)return;
  const line=speakable(assistantReply);
  if(!line)return;
  window.speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(line);
  utterance.lang='en-ZA';utterance.rate=1.03;
  utterance.onstart=()=>setSpeaking(true);
  utterance.onend=()=>setSpeaking(false);
  utterance.onerror=()=>setSpeaking(false);
  window.speechSynthesis.speak(utterance);
 },[assistantReply,replyReady]);
 const start=()=>{
  if(disabled||!available||recognition.current)return;
  setMessage('');text.current='';finalText.current='';pending.current=false;
  window.speechSynthesis?.cancel();setSpeaking(false);
  const Ctor=recognitionConstructor();
  if(!Ctor)return setMessage('Speech recognition is unavailable in this browser. Type your message instead.');
  const rec=new Ctor();recognition.current=rec;
  rec.lang='en-ZA';rec.continuous=false;rec.interimResults=true;
  rec.onresult=e=>{
   let transcript='';
   for(let i=0;i<e.results.length;i++){
    const item=e.results[i];if(!item)continue;
    const part=item[0]?.transcript?.trim();
    if(part)transcript+=(transcript?' ':'')+part;
    if(item.isFinal&&part)finalText.current+=(finalText.current?' ':'')+part;
   }
   text.current=transcript;
   setMessage(transcript||'Listening…');
  };
  rec.onerror=e=>setMessage(e.error==='not-allowed'?'Microphone permission denied. Enable it in browser settings.':
    e.error==='no-speech'?'No speech detected. Try again.':'Browser speech recognition: '+e.error);
  rec.onend=()=>{
   recognition.current=null;setListening(false);
   const transcript=(finalText.current||text.current).trim().slice(0,1800);
   if(!transcript)return;
   previousAnswer.current=assistantReply;pending.current=true;
   setMessage('Sent: '+transcript);
   onTranscriptRef.current(transcript);
  };
  try{rec.start();setListening(true);setMessage('Listening — release to send');}
  catch{recognition.current=null;setListening(false);setMessage('Could not start your microphone.');}
 };
 const stop=()=>{if(!recognition.current)return;try{recognition.current.stop()}catch{recognition.current=null;setListening(false);}};
 const stopSpeaking=()=>{window.speechSynthesis?.cancel();setSpeaking(false);pending.current=false;};
 return <div className="tv-browser-voice">
  <button type="button" className={'tv-voice-mic'+(listening?' is-listening':'')}
   aria-label={listening?'Release microphone to send':'Hold to speak to VIBES'}
   title={available?'Press and hold to speak; release to send. Browser speech recognition.':'Voice recognition unavailable in this browser.'}
   disabled={disabled||!available}
   onPointerDown={e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);start();}}
   onPointerUp={e=>{e.preventDefault();stop();}}
   onPointerCancel={stop}
   onKeyDown={e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();start();}}}
   onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();stop();}}}>
   {available?<Mic size={18}/>:<MicOff size={18}/>}
  </button>
  {speaking&&<button type="button" className="tv-voice-stop" aria-label="Stop spoken reply" title="Stop VIBES speaking" onClick={stopSpeaking}><Volume2 size={15}/></button>}
  {(listening||message)&&<span className="tv-voice-caption" role="status">{message}</span>}
 </div>;
}
