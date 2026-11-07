import {useEffect,useState} from 'react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';

export type MonitorOutput={type:'log'}|{type:'ai'}|{type:'telegram';account:string;destination:string};
export function WatchOutputFields({client,value,onChange}:{client:CloudClient|null;value:MonitorOutput;onChange:(value:MonitorOutput)=>void}){
 const [accounts,setAccounts]=useState<{name:string;connectedAccountId:string}[]>([]);
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!client||value.type!=='telegram')return;
  let active=true;
  setError('');
  void sharingRequest<{apps:{slug:string;name:string;connectedAccountId:string}[]}>(client,'/api/apps/connections').then(data=>{
   if(active)setAccounts(data.apps.filter(app=>app.slug==='telegram'));
  }).catch(()=>{if(active)setError('Could not verify connected Telegram accounts.');});
  return()=>{active=false};
 },[client,value.type]);
 return <>
  <label>On detection <select aria-label="Monitor output" value={value.type} onChange={event=>{
   const type=event.currentTarget.value;
   onChange(type==='telegram'?{type,account:'',destination:''}:type==='ai'?{type}:{type:'log'});
  }}>
   <option value="log">Record detection</option><option value="ai">Summarize with AI</option><option value="telegram">Send to Telegram</option>
  </select></label>
  {value.type==='ai'&&<p>Uses your connected OpenRouter model to write a short summary when a new event qualifies.</p>}
  {value.type==='telegram'&&<>
   <label>Telegram account <select aria-label="Telegram account" value={value.account} onChange={event=>onChange({...value,account:event.currentTarget.value})}>
    <option value="">Choose an account</option>{accounts.map(account=><option key={account.connectedAccountId} value={account.connectedAccountId}>{account.name}</option>)}
   </select></label>
   <label>Chat ID or channel <input aria-label="Telegram destination" value={value.destination} onChange={event=>onChange({...value,destination:event.currentTarget.value.trim()})}/></label>
   <p>{error||'Sends the instrument, detection, reference price and UTC time to this destination.'}</p>
  </>}
  {value.type!=='log'&&<p>Authorizing the monitor allows this output at most once every 15 minutes until you stop it.</p>}
 </>;
}
