import {useEffect,useState} from 'react';
import {Activity,ArrowRight,CheckCircle2,FileCode2,ShieldCheck,XCircle} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {readApiJson} from '../api';
import type {TaskRecord} from '../../shared/agent-task-state';
import type {DemoPolicy} from '../../server/agent-demo-policy.ts';
import './agent-task-panel.css';
import {AgentDemoPolicyPanel} from './AgentDemoPolicyPanel';
import {AgentQuestionCard} from './AgentQuestionCard';

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
 const [budget,setBudget]=useState(12),[runtimeMinutes,setRuntimeMinutes]=useState(60),[continuous,setContinuous]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [draft,setDraft]=useState('');
 const [recent,setRecent]=useState<{id:string;objective:string;createdAt:number;status:string}[]>([]);
 const [policies,setPolicies]=useState<DemoPolicy[]>([]);
 const [policyId,setPolicyId]=useState('');
 const refreshPolicies=async()=>{
  const response=await taskRequest<{policies:DemoPolicy[]}>(client,'/api/agent-policies');
  const active=response.policies.filter(p=>p.demoOnly&&p.revokedAt===null&&p.expiresAt>Date.now());
  setPolicies(active);setPolicyId(id=>active.some(p=>p.id===id)?id:active[0]?.id||'');
 };
 useEffect(()=>{void refreshPolicies().catch(()=>{});},[client,task?.id]);
 const replyQuestion=async(answer:string)=>{
  if(!task||!task.question||busy)return;
  const result=await taskRequest<{task:TaskRecord}>(client,'/api/agent-tasks/'+encodeURIComponent(task.id)+'/answer','POST',
   {questionId:task.question.id,answer});
  setTask(result.task);setError('');
 };
 const attachPolicy=async()=>{
  if(!task||!policyId||busy)return;
  setBusy(true);setError('');
  try{
   const result=await taskRequest<{task:TaskRecord}>(client,'/api/agent-tasks/'+encodeURIComponent(task.id)+'/policy','POST',{policyId});
   setTask(result.task);
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not bind the demo-only policy')}
  finally{setBusy(false)}
 };
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
   const result=await taskRequest<{task:TaskRecord}>(client,'/api/agent-tasks','POST',{objective:objective.trim(),maxIterations:continuous?80:budget,runtimeMinutes,continuous,...(continuous?{policyId}:{})});
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
   <label className="tv-agent-policy-checkbox"><input type="checkbox" checked={continuous} onChange={e=>setContinuous(e.target.checked)}/> Run autonomously until stopped · build, evaluate, deploy on the selected PropDAO Evaluation demo, monitor, and research again when safe</label>
   {continuous&&<div className="tv-agent-task-policy-link"><strong>Required full-demo standing consent</strong><select value={policyId} onChange={e=>setPolicyId(e.target.value)}>{policies.filter(p=>p.mode==='full-demo').length===0&&<option value="">First create a full-demo policy below</option>}{policies.filter(p=>p.mode==='full-demo').map(p=><option key={p.id} value={p.id}>{p.accountId+' · '+(p.untilStopped?'until stopped':'time-limited')}</option>)}</select><button type="button" onClick={()=>void refreshPolicies().catch(()=>{})}>Refresh consent</button><small>Broker execution requires the server feature gate, valid policy, independent backtests, and live risk checks. A demo account can still lose or fail.</small></div>}
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
   <button type="button" className="tv-hub-primary" disabled={busy||objective.trim().length<12||(continuous&&(!policyId||!policies.some(p=>p.id===policyId&&p.mode==='full-demo')))} onClick={()=>void create()}>{continuous?'Start autonomous demo agent':'Start research task'} <ArrowRight size={15}/></button>
  </div>:<div className="tv-agent-task-progress">
   <div className="tv-agent-task-status"><strong>{task.autonomy?.enabled?'AUTONOMOUS DEMO AGENT':'RESEARCH TASK'} · {task.status.replaceAll('_',' ')}</strong><span>{task.autonomy?.enabled?'Run-until-stopped · cycle '+task.autonomy.completedCycles:'Step '+task.iteration+' / '+task.maxIterations}</span></div>
   <p>{task.memory.lastResult||task.memory.summary||'Task accepted. Preparing the first evidence-gathering step.'}</p>
   {task.autonomy?.enabled&&<p role="status">Broker robot: {task.autonomy.botId||'awaiting validated candidate'} · Exposure: {task.autonomy.lastBrokerExposure||'unknown'} · {task.autonomy.lastDeploymentOutcome||'no broker action yet'}. Last check: {task.autonomy.lastMonitorAt?new Date(task.autonomy.lastMonitorAt).toLocaleString():'not verified yet'}</p>}
   {task.usage&&<p>{'Estimated model spending: $'+task.usage.estimatedModelUsd.toFixed(4)+' over '+(task.usage.inputTokens+task.usage.outputTokens).toLocaleString()+' tokens · '+task.usage.steps+' AI turns. Execution, storage and broker fees are separate.'}</p>}
   {task.status==='waiting_for_input'&&task.question&&<AgentQuestionCard key={task.question.id} question={task.question} onAnswer={replyQuestion} disabled={busy}/>}
   <div className="tv-agent-task-policy-link">
    <strong>Demo policy for this task</strong>
    {task.policy?<p>{'Linked policy: '+task.policy.accountId+' · '+task.policy.mode+' · expires '+new Date(task.policy.expiresAt).toLocaleString()}</p>:
     <p>No standing policy linked. VIBES can conduct research, but cannot operate a broker account.</p>}
    <div><select value={policyId} onChange={event=>setPolicyId(event.target.value)}>
     {policies.length===0&&<option value="">No active, demo-only policy</option>}
     {policies.map(p=><option key={p.id} value={p.id}>{p.accountId+' · '+p.mode}</option>)}
    </select>
    <button type="button" disabled={busy||!policyId} onClick={()=>void attachPolicy()}>Link policy</button>
    <button type="button" onClick={()=>void refreshPolicies().catch(e=>setError(e instanceof Error?e.message:'Policy list unavailable'))}>Refresh policies</button>
    </div>
    <small>Linking a policy does not enable autonomous deployment. Its scope is checked again server-side before any future execution action.</small>
   </div>
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
    {(!terminal.has(task.status)||(task.autonomy?.enabled&&task.autonomy.botId&&task.status!=='cancelled'))&&<button type="button" disabled={busy||task.status==='stopping'} onClick={()=>void cancel()}><XCircle size={15}/> {task.autonomy?.enabled?'STOP AGENT — disable new entries':'Cancel task'}</button>}
    <button type="button" onClick={()=>{setTask(null);setDraft('');setError('')}}>New task</button>
   </div>
  </div>}
  {error&&<p className="tv-agent-task-error" role="alert">{error}</p>}
  <AgentDemoPolicyPanel client={client}/>
 </section>;
}
