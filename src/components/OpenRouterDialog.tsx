import {useEffect,useState} from 'react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import {Dialog} from './Dialog';
const DEFAULT_MODEL='baidu/ernie-5.5-flash-preview:free';
import './marketplace.css';

type Model={id:string;name:string;pricing:{prompt:string;completion:string}};
export function OpenRouterDialog({client,onClose}:{client:CloudClient;onClose:()=>void}){
 const [spending,setSpending]=useState<{limit:number|null;remaining:number|null;usage:number|null;settingsUrl:string}|null>(null);
 const [models,setModels]=useState<Model[]>([]),[model,setModel]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [apiKey,setApiKey]=useState(''),[showKey,setShowKey]=useState(false);
 useEffect(()=>{let active=true;Promise.all([sharingRequest<{models:Model[]}>(client,'/api/openrouter/models'),sharingRequest<{connected:boolean;model?:string}>(client,'/api/openrouter/account'),sharingRequest<any>(client,'/api/openrouter/spending').catch(()=>null)]).then(([list,status,usage])=>{if(!active)return;setModels(list.models);setConnected(status.connected);setModel(status.connected&&status.model?status.model:list.models.some(m=>m.id===DEFAULT_MODEL)?DEFAULT_MODEL:list.models.find(m=>m.id.endsWith(':free'))?.id||list.models[0]?.id||'');if(usage?.connected)setSpending(usage)}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load AI settings.')}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[client]);
 const action=async(path:string,body:object)=>{
  setBusy(true);setError('');setNotice('');
  try{
   const result=await sharingRequest<{connected:boolean;model?:string}>(client,path,'POST',body);
   setConnected(result.connected);
   if(result.model)setModel(result.model);
   if(path==='/api/openrouter/connect'){
    setApiKey('');setShowKey(false);
    const latest=await sharingRequest<{connected:boolean;limit:number|null;remaining:number|null;usage:number|null;settingsUrl:string}>(client,'/api/openrouter/spending').catch(()=>null);
    setSpending(latest?.connected?latest:null);
   }else if(!result.connected){
    setApiKey('');setShowKey(false);setSpending(null);
   }
   setNotice(path==='/api/openrouter/connect'?'API key connected. You can now use OpenRouter AI models.':result.connected?'AI settings saved.':'Disconnected. Revoke the key in OpenRouter if you no longer need it.');
  }catch(e){setError(e instanceof Error?e.message:'AI settings failed.')}
  finally{setBusy(false)}
 };
 return <Dialog title="OpenRouter AI" onClose={onClose} busy={busy}>
  <p>Use your own OpenRouter API key to connect AI models. Any model charges are billed to your OpenRouter account.</p>
  {error&&<p className="share-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <label>Default model<select value={model} onChange={e=>setModel(e.target.value)} disabled={busy}>{models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}</select></label>
  {models.find(m=>m.id===model)&&<small>Price per token (USD): input {models.find(m=>m.id===model)?.pricing.prompt}, output {models.find(m=>m.id===model)?.pricing.completion}.</small>}
  {connected&&<p role="status">OpenRouter is connected. To replace your current key, enter a new one below.</p>}
  <form onSubmit={e=>{e.preventDefault();if(!busy&&model&&apiKey.trim())void action('/api/openrouter/connect',{apiKey:apiKey.trim(),model})}}>
   <label htmlFor="openrouter-api-key">OpenRouter API key</label>
   <div style={{display:'flex',alignItems:'center',gap:8}}>
    <input id="openrouter-api-key" type={showKey?'text':'password'} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-or-v1-..." autoComplete="off" spellCheck={false} disabled={busy} style={{minWidth:0,flex:1}}/>
    <button type="button" className="text-button" disabled={busy||!apiKey} onClick={()=>setShowKey(value=>!value)} aria-label={showKey?'Hide API key':'Show API key'}>{showKey?'Hide':'Show'}</button>
   </div>
   <small>Don't have a key? <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">Create an OpenRouter API key</a>. Your key is encrypted when saved and won't be displayed again.</small>
   <div className="market-buttons">
    <button type="submit" className="primary" disabled={busy||!model||!apiKey.trim()}>{connected?'Replace API key':'Save & Connect'}</button>
    {connected&&<><button type="button" className="primary" disabled={busy||!model} onClick={()=>void action('/api/openrouter/model',{model})}>Save model</button><button type="button" className="text-button" disabled={busy} onClick={()=>void action('/api/openrouter/disconnect',{})}>Disconnect</button></>}
   </div>
  </form>
  {spending&&<p>Key limit: {spending.limit===null?'Not set':`$${spending.limit}`} · Remaining: {spending.remaining===null?'Unavailable':`$${spending.remaining}`} · Used: {spending.usage===null?'Unavailable':`$${spending.usage}`}<br/><a href={spending.settingsUrl} target="_blank" rel="noreferrer">Manage spending limit ↗</a></p>}
 </Dialog>;
}
