import {useEffect,useState} from 'react';
import {Activity,Clock3,CheckCircle2,Pause,Play,Square,ShieldCheck} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import type {TaskRecord} from '../../shared/agent-task-state';
import './agent-task-card.css';
const terminal=new Set(['completed','blocked','failed','cancelled','waiting_for_review']);
export function AgentTaskCard({client,taskId,onOpenScheduled}:{client:CloudClient;taskId:string;onOpenScheduled:()=>void}){
 const [task,setTask]=useState<TaskRecord|null>(null),[error,setError]=useState(''),[working,setWorking]=useState(false);
 useEffect(()=>{
  let active=true;
  const poll=async()=>{try{
   const r=await sharingRequest<{task:TaskRecord}>(client,'/api/agent-tasks/'+encodeURIComponent(taskId));
   if(active){setTask(r.task);setError('');}
  }catch(e){if(active)setError(e instanceof Error?e.message:'Task status unavailable');}};
  void poll();
  const timer=window.setInterval(()=>{if(!terminal.has(task?.status||''))void poll()},4000);
  return ()=>{active=false;window.clearInterval(timer);};
 },[client,taskId,task?.status]);
 const control=async(action:'cancel'|'pause'|'resume')=>{
  if(working)return;setWorking(true);setError('');
  try{const result=await sharingRequest<{task:TaskRecord}>(client,'/api/agent-tasks/'+encodeURIComponent(taskId)+'/'+action,'POST');setTask(result.task);}
  catch(e){setError(e instanceof Error?e.message:'Task operation could not be verified');}
  finally{setWorking(false);}
 };
 return <section className="tv-durable-task-card" aria-label="VIBES durable task">
  <header><div><Activity size={16}/><strong>VIBES is working on this objective</strong></div><span>{task?.status.replaceAll('_',' ')||'Checking task...'}</span></header>
  <p>{task?.memory.lastResult||task?.memory.summary||'Loading checkpointed task progress…'}</p>
  {task&&<div className="tv-task-meta"><span><Clock3 size={13}/> {task.phase} · checkpoint {task.iteration}/{task.maxIterations}</span>
   <span>Deadline {new Date(task.deadlineAt).toLocaleString()}</span></div>}
  {task?.memory.artifacts.length?<p>{task.memory.artifacts.filter(a=>a.kind==='draft').length} drafts · {task.memory.artifacts.filter(a=>a.kind==='backtest').length} reference backtests · {task.memory.artifacts.filter(a=>a.kind==='evaluation').length} evaluations</p>:null}
  {task?.status==='waiting_for_review'&&<p className="tv-task-review"><ShieldCheck size={15}/> Research candidate produced; demo deployment requires separate broker-specific validation and approval.</p>}
  {task?.lastError&&<p role="status">{task.lastError}</p>}
  {error&&<p role="alert">{error}</p>}
  <div className="tv-task-controls">
   <button onClick={onOpenScheduled} type="button">Open Scheduled</button>
   {task&&!terminal.has(task.status)&&task.status!=='paused'&&<button type="button" disabled={working} onClick={()=>void control('pause')}><Pause size={14}/> Pause</button>}
   {task?.status==='paused'&&<button type="button" disabled={working} onClick={()=>void control('resume')}><Play size={14}/> Resume</button>}
   {task&&!terminal.has(task.status)&&<button type="button" disabled={working} onClick={()=>void control('cancel')}><Square size={14}/> Cancel</button>}
  </div>
  <small><CheckCircle2 size={13}/> Research tasks do not authorize order execution.</small>
 </section>;
}
