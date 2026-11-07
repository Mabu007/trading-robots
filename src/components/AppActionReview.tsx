import {useState} from 'react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';

export function AppActionReview({client,output}:{client:CloudClient;output:unknown}){
 const [busy,setBusy]=useState(false);
 const [decision,setDecision]=useState('');
 const [result,setResult]=useState('');
 if(!output||typeof output!=='object')return null;
 const action=output as Record<string,unknown>;
 if(action.requiresApproval!==true||typeof action.approvalId!=='string'||!/^[a-f0-9]{32}$/.test(action.approvalId))return null;
 const id=action.approvalId;
 const expired=typeof action.expiresAt!=='number'||action.expiresAt<=Date.now();
 async function submit(choice:'approve'|'deny'){
  if(busy||decision||expired)return;
  setBusy(true);
  try{
   const response=await sharingRequest<{denied?:boolean;available?:boolean;content?:string;reason?:string}>(client,'/api/apps/actions/'+id+'/'+choice,'POST',{});
   setDecision(response.denied?'Denied':response.available?'Action confirmed':'External service did not confirm execution');
   setResult(response.content||response.reason||'');
  }catch(error){
   setDecision('Action unavailable');
   setResult(error instanceof Error?error.message:'Check the destination before trying again.');
  }finally{setBusy(false)}
 }
 return <section className="tv-chat-result-card" aria-label="Connected app review">
  <strong>Review connected app action</strong>
  <p>{String(action.toolkit)} · {String(action.account)} · {String(action.action)}</p>
  <details open={!decision}><summary>Exact information the app will receive</summary><pre>{String(action.arguments||'{}')}</pre></details>
  {decision?<p role="status">{decision}</p>:expired?<p>Review expired. Ask for a new action.</p>:<div className="tv-operation-actions">
   <button type="button" disabled={busy} onClick={()=>void submit('approve')}>Approve app action</button>
   <button type="button" disabled={busy} onClick={()=>void submit('deny')}>Deny app action</button>
  </div>}
  {result&&<pre>{result}</pre>}
 </section>;
}
