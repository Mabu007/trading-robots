import {useEffect,useState} from 'react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import {Dialog} from './Dialog';
import './marketplace.css';

type Model={id:string;name:string;pricing:{prompt:string;completion:string}};
export function OpenRouterDialog({client,onClose}:{client:CloudClient;onClose:()=>void}){
 const [spending,setSpending]=useState<{limit:number|null;remaining:number|null;usage:number|null;settingsUrl:string}|null>(null);
 const [models,setModels]=useState<Model[]>([]),[model,setModel]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{let active=true;Promise.all([sharingRequest<{models:Model[]}>(client,'/api/openrouter/models'),sharingRequest<{connected:boolean;model?:string}>(client,'/api/openrouter/account'),sharingRequest<any>(client,'/api/openrouter/spending').catch(()=>null)]).then(([list,status,usage])=>{if(!active)return;setModels(list.models);setConnected(status.connected);setModel(status.model||list.models.find(m=>m.id.endsWith(':free'))?.id||list.models[0]?.id||'');if(usage?.connected)setSpending(usage)}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load AI settings.')}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[client]);
 const startOAuth=async()=>{setBusy(true);setError('');try{const {url}=await sharingRequest<{url:string}>(client,'/api/openrouter/oauth/start','POST',{model});const target=new URL(url);if(target.origin!=='https://openrouter.ai')throw Error('Invalid authorization URL');window.location.assign(target.href)}catch(e){setError(e instanceof Error?e.message:'Connection failed');setBusy(false)}};
 const action=async(path:string,body:object)=>{setBusy(true);setError('');setNotice('');try{const result=await sharingRequest<{connected:boolean;model?:string}>(client,path,'POST',body);setConnected(result.connected);if(result.model)setModel(result.model);setNotice(result.connected?'AI settings saved.':'Disconnected. Revoke access in OpenRouter if you no longer need it.')}catch(e){setError(e instanceof Error?e.message:'AI settings failed.')}finally{setBusy(false)}};
 return <Dialog title="OpenRouter AI" onClose={onClose} busy={busy}>
  <p>Connect your OpenRouter account to choose AI models. Any model charges are billed to your OpenRouter account.</p>
  {error&&<p className="share-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <label>Default model<select value={model} onChange={e=>setModel(e.target.value)} disabled={busy}>{models.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}</select></label>
  {models.find(m=>m.id===model)&&<small>Price per token (USD): input {models.find(m=>m.id===model)?.pricing.prompt}, output {models.find(m=>m.id===model)?.pricing.completion}.</small>}
  <div className="market-buttons">{connected?<><button className="primary" disabled={busy||!model} onClick={()=>void action('/api/openrouter/model',{model})}>Save model</button><button className="text-button" disabled={busy} onClick={()=>void action('/api/openrouter/disconnect',{})}>Disconnect</button></>:<button className="primary" disabled={busy||!model} onClick={()=>void startOAuth()}>Connect with OpenRouter</button>}</div>
  {spending&&<p>Key limit: {spending.limit===null?'Not set':`$${spending.limit}`} · Remaining: {spending.remaining===null?'Unavailable':`$${spending.remaining}`} · Used: {spending.usage===null?'Unavailable':`$${spending.usage}`}<br/><a href={spending.settingsUrl} target="_blank" rel="noreferrer">Manage spending limit ↗</a></p>}
 </Dialog>;
}
