import {useState} from 'react';
import type {ToolTrace} from '../tool-trace';
import './chat-strategy-approvals.css';

type Operation='strategy.apply'|'strategy.create'|'strategy.delete';
type Proposal={reviewRequired:true;operation:Operation;intentId:string;botId:string;
 expiresAt:number;name?:string;asset?:string;venue?:string;
 previousCodeHash?:string;proposedCodeHash?:string;codeHash?:string;
 oldSnippet?:string;newSnippet?:string;codePreview?:string;note?:string};
type Preview={before:string|null;after:string|null;operation:Operation;
 botId:string;intentId:string;expiresAt:number};
function proposal(value:unknown):Proposal|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>;
 if(v.reviewRequired!==true||!['strategy.apply','strategy.create','strategy.delete'].includes(String(v.operation))||
    typeof v.botId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v.botId)||
    typeof v.intentId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v.intentId)||
    typeof v.expiresAt!=='number')return null;
 return v as Proposal;
}
export function ChatStrategyApproval({trace,request,onApplied}:{
 trace:ToolTrace[];
 request:(path:string,method:'GET'|'POST',body?:unknown)=>Promise<any>;
 onApplied:(operation:Operation,botId:string)=>Promise<void>|void
}){
 const item=[...trace].reverse().find(t=>t.state==='completed'&&
  ['proposeStrategySourceEdit','proposeCreateRobot','proposeDeleteRobot'].includes(t.name)&&proposal(t.output));
 const stage=proposal(item?.output);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [confirmed,setConfirmed]=useState(false);
 const [approved,setApproved]=useState(false);
 const [state,setState]=useState<'pending'|'loading'|'applying'|'applied'|'denied'>('pending');
 const [error,setError]=useState('');
 if(!stage)return null;
 const selected:Proposal=stage;
 const path=selected.operation==='strategy.apply'?
  '/api/agent/strategy-reviews/'+encodeURIComponent(selected.botId)+'/'+encodeURIComponent(selected.intentId):
  '/api/agent/robot-mutations/'+encodeURIComponent(selected.intentId);
 const expired=Date.now()>=selected.expiresAt;
 async function review(){
  setError('');setState('loading');
  try{
   const p=await request(path,'GET');
   if(p.intentId!==selected.intentId||p.botId!==selected.botId||p.operation!==selected.operation||
      typeof p.expiresAt!=='number'||p.expiresAt!==selected.expiresAt)
    throw Error('Reviewed proposal does not match this chat action');
   if(p.after!==null&&typeof p.after!=='string'||p.before!==null&&typeof p.before!=='string')
    throw Error('Full source review is invalid');
   setPreview(p);
  }catch(e){setError(e instanceof Error?e.message:'Could not load the verified review')}
  finally{setState('pending')}
 }
 async function commit(){
  if(!preview||!confirmed||expired||state!=='pending')return;
  setError('');setState('applying');
  try{
   if(!approved){
    await request(path+'/approve','POST',{});
    setApproved(true);
   }
   const applied=await request(path+'/apply','POST',{});
   if(applied.applied!==true||applied.botId!==selected.botId||
      applied.operation&&applied.operation!==selected.operation)
    throw Error('Server did not confirm applied source mutation');
   setState('applied');
   try{await onApplied(selected.operation,selected.botId)}
   catch{setError('Source change succeeded on the server, but your library view did not refresh. Reload the page.')}
   return;
  }catch(e){setError(e instanceof Error?e.message:'Source mutation was not completed');setState('pending');setConfirmed(false)}
 }
 async function deny(){
  setError('');setState('loading');
  try{await request(path+'/deny','POST',{});setState('denied')}
  catch(e){setError(e instanceof Error?e.message:'Cannot deny this review');setState('pending')}
 }
 const label=selected.operation==='strategy.create'?'Create saved robot':
  selected.operation==='strategy.delete'?'Delete saved robot':'Apply source edit';
 return <section className="tv-source-review" aria-label="Strategy source change requires approval">
  <header><strong>{label} — human approval required</strong>
   <small>{stage.name||stage.botId} · {stage.venue||'saved strategy'} · {stage.asset||'instrument not supplied'}</small>
  </header>
  <p>{stage.note||'This is a pending source proposal. No robot or broker order has changed.'}</p>
  <div className="tv-source-hashes">
   {stage.previousCodeHash&&<span>Before: <code>{stage.previousCodeHash.slice(0,12)}</code></span>}
   {(stage.proposedCodeHash||stage.codeHash)&&<span>Proposal: <code>{(stage.proposedCodeHash||stage.codeHash)!.slice(0,12)}</code></span>}
  </div>
  {stage.operation==='strategy.apply'&&stage.oldSnippet&&<details><summary>Proposed source edit</summary>
   <div className="tv-source-diff"><div><strong>Existing source</strong><pre>{stage.oldSnippet}</pre></div>
    <div><strong>Replacement source</strong><pre>{stage.newSnippet}</pre></div></div></details>}
  {preview&&<details open><summary>Verified complete source — review before approving</summary>
   {preview.before!==null&&<div><strong>Before</strong><pre className="tv-source-full">{preview.before}</pre></div>}
   {preview.after!==null&&<div><strong>After</strong><pre className="tv-source-full">{preview.after}</pre></div>}
  </details>}
  {state==='applied'?<p role="status">Confirmed by server. Only saved source changed; no trading order was submitted.</p>:
   state==='denied'?<p role="status">Review denied. No saved source changed.</p>:
   expired?<p role="alert">This review expired. Ask VIBES to prepare a fresh proposal.</p>:
   <div className="tv-source-review-actions">
    {!preview?<button type="button" disabled={state!=='pending'} onClick={()=>void review()}>Review complete source</button>:
     <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
      I reviewed the exact source change and authorize this {stage.operation==='strategy.delete'?'deletion':'save'}.</label>}
    {preview&&<button type="button" disabled={!confirmed||state!=='pending'} onClick={()=>void commit()}>
      {state==='applying'?'Applying…':approved?'Apply approved change':label}</button>}
    <button type="button" disabled={state!=='pending'} onClick={()=>void deny()}>Deny</button>
   </div>}
  {error&&<p role="alert" className="tv-source-error">{error}</p>}
  <small>Live robots require stop and reconciliation before edits or deletion. Approving source never deploys it.</small>
 </section>;
}
