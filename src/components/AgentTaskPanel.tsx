import {useEffect,useState} from 'react';
import {Activity,ArrowRight,CheckCircle2,FileCode2,ShieldCheck,XCircle} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {readApiJson} from '../api';
import type {TaskRecord} from '../../shared/agent-task-state';
import './agent-task-panel.css';

async function taskRequest<T>(client:CloudClient,path:string,method:'GET'|'POST'='GET',body?:unknown):Promise<T>{
 const request=async(refresh:boolean)=>{
  const token=await client.getIdToken(refresh);
  return fetch(path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
 };
 let response=await request(false);
 if(response.status===401)response=await request(true);
 return readApiJson<T>(response,'VIBES Agent Tasks');
}
const terminal=new Set(['waiting_for_review','completed','blocked','failed','cancelled']);
export function AgentTaskPanel({client}:{client:CloudClient}){
 const [objective,setObjective]=useState('Research and validate a PropDAO GOLDUSDC robot for a demo evaluation. Investigate unrealistic stop losses, run isolated reference backtests, report risks and prepare a candidate for review.');
 const [task,setTask]=useState<TaskRecord|null>(null);
 const [budget,setBudget]=useState(12),[runtimeMinutes,setRuntimeMinutes]=useState(60);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [draft,setDraft]=useState('');
 const [recent,setRecent]=useState<{id:string;objective:string;createdAt:number;status:string}[]>([]);
 useEffect(()=>{
  let active=true;
  void taskRequest<{tasks:{id:string;objective:string;createdAt:number;status:string}[]}>(client,'/api/agent-tasks')
   .then(result=>{if(active)setRecent(result.tasks)})
   .catch(()=>{});
  return()=>{active=false};
 },[client]);
 const openRecent=async(id:string)=>{
  if(busy)return;setBusy(true);setError('');setDraft('');
  try{const result=await taskRequest<{task:TaskRecord}>(client,'/api/agent-tasks/'+encodeURIComponent(id));setTask(result.task)}
  catch(cause){setError(cause instanceof Error?cause.message:'Could not open task')}
  finally{setBusy(false)}
 };
 useEffect(()=>{
  if(!task||terminal.has(task.status))return;
  let active=true;
  const poll=async()=>{
   try{
    const response=await taskRequest<{task:TaskRecord}>(client,'/api/agent-tasks/'+encodeURIComponent(task.id));
    if(active)setTask(response.task);
   }catch(cause){if(active)setError(cause instanceof Error?cause.message:'Task status unavailable');}
  };
  const interval=window.setInterval(()=>void poll(),3500);
  return()=>{active=false;window.clearInterval(interval)};
 },[client,task?.id,task?.status]);
 const create=async()=>{
  if(busy||!objective.trim())return;
  setBusy(true);setError('');setDraft('');
  try{
   const result=await taskRequest<{task:TaskRecord}>(client,'/api/agent-tasks','POST',{objective:objective.trim(),maxIterations:budget,runtimeMinutes});
   setTask(result.task);
   setRecent(items=>[{id:result.task.id,objective:result.task.objective,createdAt:result.task.createdAt,status:result.task.status},...items]);
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not create task')}
  finally{setBusy(false)}
 };
 const cancel=async()=>{
  if(!task||busy)return;
  setBusy(true);setError('');
  try{
   const result=await taskRequest<{task:TaskRecord}>(client,'/api/agent-tasks/'+encodeURIComponent(task.id)+'/cancel','POST');
   setTask(result.task);
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not stop task')}
  finally{setBusy(false)}
 };
 const inspect=async(id:string)=>{
  if(!task)return;
  setBusy(true);setError('');
  try{
   const result=await taskRequest<{source:string}>(client,'/api/agent-tasks/'+encodeURIComponent(task.id)+'/drafts/'+encodeURIComponent(id));
   setDraft(result.source);
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not read draft')}
  finally{setBusy(false)}
 };
 return <section className="tv-agent-task-panel" aria-label="Durable VIBES research tasks">
  <header><div><span className="tv-destination-kicker"><Activity size={14}/> DURABLE AI TASKS</span><h2>Give VIBES a goal. It will do the work.</h2>
   <p>Research, draft and backtest with checkpointed task memory. Research never authorizes trades or changes an existing robot.</p></div></header>
  {!task?<div className="tv-agent-task-setup">
   {recent.length>0&&<div className="tv-agent-task-recent"><strong>Recent tasks</strong>{recent.slice(0,6).map(item=><button key={item.id} type="button" disabled={busy} onClick={()=>void openRecent(item.id)}>{item.objective.slice(0,85)} · {item.status.replaceAll('_',' ')}</button>)}</div>}
   <label htmlFor="tv-agent-task-goal">Objective</label>
   <textarea id="tv-agent-task-goal" value={objective} onChange={event=>setObjective(event.target.value)} maxLength={1200} rows={4} placeholder="What should VIBES investigate, build or validate?"/>
   <label htmlFor="tv-agent-task-budget">Work budget</label>
   <select id="tv-agent-task-budget" value={budget} onChange={event=>setBudget(Number(event.target.value))}>
    <option value={12}>Standard · up to 12 checkpoints</option>
    <option value={60}>Deep research · up to 60 checkpoints (higher AI cost)</option>
   </select>
   <label htmlFor="tv-agent-task-runtime">Task deadline</label>
   <select id="tv-agent-task-runtime" value={runtimeMinutes} onChange={event=>setRuntimeMinutes(Number(event.target.value))}>
    <option value={60}>1 hour research</option>
    <option value={360}>6 hours (research with breaks)</option>
    <option value={1440}>1 day (limited iterations)</option>
    <option value={7200}>5 days (limited iterations)</option>
   </select>
   <small>Tasks checkpoint between requests; the deadline is not continuous AI execution. Usage is billed to your connected OpenRouter key. No live orders are placed by research tasks.</small>
   <button type="button" className="tv-hub-primary" disabled={busy||objective.trim().length<12} onClick={()=>void create()}>Start research task <ArrowRight size={15}/></button>
  </div>:<div className="tv-agent-task-progress">
   <div className="tv-agent-task-status"><strong>{task.phase.toUpperCase()} · {task.status.replaceAll('_',' ')}</strong><span>Step {task.iteration} / {task.maxIterations}</span></div>
   <p>{task.memory.lastResult||task.memory.summary||'Task accepted. Preparing the first evidence-gathering step.'}</p>
   {task.memory.plan.length>0&&<ol>{task.memory.plan.map((item,index)=><li key={index}>{item}</li>)}</ol>}
   {task.memory.artifacts.length>0&&<div className="tv-agent-task-artifacts">{task.memory.artifacts.map(item=><div key={item.kind+item.id}>
    {item.kind==='draft'?<FileCode2 size={16}/>:<CheckCircle2 size={16}/>}
    <span>{item.kind} · {item.id.slice(0,16)} · {item.quality||'reference'}</span>
    {item.kind==='draft'&&<button type="button" disabled={busy} onClick={()=>void inspect(item.id)}>Inspect code</button>}
   </div>)}</div>}
   {draft&&<details open><summary>Generated draft (not deployed)</summary><pre>{draft}</pre></details>}
   {task.status==='waiting_for_review'&&<p className="tv-agent-task-guard"><ShieldCheck size={16}/> Reference backtest candidate ready for review; NOT certified for PropDAO fills or auto-deployed.</p>}
   {task.lastError&&<p role="alert">{task.lastError}</p>}
   <div className="tv-agent-task-actions">
    {!terminal.has(task.status)&&<button type="button" disabled={busy} onClick={()=>void cancel()}><XCircle size={15}/> Cancel task</button>}
    <button type="button" onClick={()=>{setTask(null);setDraft('');setError('')}}>New task</button>
   </div>
  </div>}
  {error&&<p className="tv-agent-task-error" role="alert">{error}</p>}
 </section>;
}
