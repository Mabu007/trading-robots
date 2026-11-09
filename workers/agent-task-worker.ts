import {DurableObject} from 'cloudflare:workers';
import {applyTaskStep,initialTask,type TaskRecord,type TaskStepResult} from '../shared/agent-task-state.ts';

type Env={TASKS:DurableObjectNamespace;VIBES_TASK_INTERNAL_SECRET:string;VIBES_CONTROL_URL:string};
async function authorized(header:string,secret:string){
 if(!secret||secret.length<32||header.length>256)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const [a,b]=await Promise.all([header,'Bearer '+secret].map(v=>crypto.subtle.sign('HMAC',key,new TextEncoder().encode(v))));
 const x=new Uint8Array(a),y=new Uint8Array(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
 return diff===0;
}
const uidPattern=/^[\w:-]{1,128}$/;
const idPattern=/^[A-Za-z0-9_-]{8,100}$/;
const MONITOR_INTERVAL=60_000,RETRY_DELAY=30_000,RESEARCH_COOLDOWN=6*60*60_000;
export class DurableAgentTask extends DurableObject<Env>{
 async fetch(req:Request){
  const path=new URL(req.url).pathname;
  const uid=req.headers.get('X-TV-UID')||'',id=req.headers.get('X-TV-TASK-ID')||'';
  if(!uidPattern.test(uid)||!idPattern.test(id))return Response.json({error:'Invalid task identity'},{status:403});
  const state=await this.ctx.storage.get<TaskRecord>('task');
  if(state&&(state.id!==id||state.ownerUid!==uid))return Response.json({error:'Task ownership mismatch'},{status:403});
  if(path==='/start'&&req.method==='POST'){
   if(state)return Response.json({task:state});
   if(Number(req.headers.get('content-length')||0)>4000)return Response.json({error:'Task request too large'},{status:413});
   const body=await req.json<{objective?:string;maxIterations?:number;runtimeMinutes?:number;continuous?:boolean}>().catch(()=>null);
   if(!body||typeof body.objective!=='string')return Response.json({error:'Task objective required'},{status:400});
   try{
    const created=initialTask(uid,id,body.objective,Date.now(),body.maxIterations,body.runtimeMinutes,body.continuous===true);
    await this.ctx.storage.put('task',created);
    await this.ctx.storage.setAlarm(Date.now()+1000);
    return Response.json({task:created},{status:201});
   }catch{return Response.json({error:'Invalid objective'},{status:400})}
  }
  if(!state)return Response.json({error:'Unknown task'},{status:404});
  if(path==='/status'&&req.method==='GET')return Response.json({task:state});
  if(path==='/policy'&&req.method==='POST'){
   if(['completed','cancelled','failed'].includes(state.status))return Response.json({error:'Cannot link a policy to a terminal task'},{status:409});
   const body=await req.json<Partial<NonNullable<TaskRecord['policy']>>>().catch(()=>null);
   if(!body||typeof body.policyId!=='string'||!idPattern.test(body.policyId)||
    typeof body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.fingerprint)||
    typeof body.accountId!=='string'||!idPattern.test(body.accountId)||
    !Number.isFinite(body.expiresAt)||Number(body.expiresAt)<=Date.now()||
    !['bounded-demo','full-demo'].includes(String(body.mode)))return Response.json({error:'Invalid verified policy pointer'},{status:400});
   const policy:NonNullable<TaskRecord['policy']> = {
    policyId:body.policyId,fingerprint:body.fingerprint,accountId:body.accountId,
    expiresAt:body.expiresAt!,mode:body.mode!,linkedAt:Date.now()
   };
   const ready=state.autonomy?.enabled&&state.status==='waiting_for_review'&&state.memory.artifacts.some(
    a=>a.kind==='evaluation'&&a.reviewEligible&&state.memory.artifacts.some(b=>b.kind==='draft'&&b.codeHash===a.codeHash));
   const updated={...state,policy,
    ...(ready?{status:'activating' as const,autonomy:{...state.autonomy!,stage:'activating' as const}}:{}),
    stateVersion:state.stateVersion+1,updatedAt:Date.now()};
   await this.ctx.storage.put('task',updated);
   if(ready)await this.ctx.storage.setAlarm(Date.now()+1000);
   return Response.json({task:updated});
  }
  if(path==='/cancel'&&req.method==='POST'){
   const persistent=state.autonomy?.enabled===true;
   const updated={...state,status:persistent?'stopping' as const:'cancelled' as const,
    leaseId:undefined,stateVersion:state.stateVersion+1,updatedAt:Date.now(),
    ...(state.autonomy?{autonomy:{...state.autonomy,stopRequested:true,stage:'stopping' as const}}:{})};
   await this.ctx.storage.put('task',updated);
   if(persistent)await this.ctx.storage.setAlarm(Date.now()+1000);
   else await this.ctx.storage.deleteAlarm();
   return Response.json({task:updated});
  }
  if(path==='/pause'&&req.method==='POST'){
   if(state.autonomy?.enabled&&state.autonomy.botId)return Response.json({error:'A deployed autonomous robot must be stopped, not just pause its research loop'},{status:409});
   if(['completed','cancelled','failed'].includes(state.status))return Response.json({error:'Task is already terminal'},{status:409});
   const updated={...state,status:'paused' as const,leaseId:undefined,stateVersion:state.stateVersion+1,updatedAt:Date.now()};
   await this.ctx.storage.put('task',updated);await this.ctx.storage.deleteAlarm();
   return Response.json({task:updated});
  }
  if(path==='/resume'&&req.method==='POST'){
   if(!['blocked','retrying','paused'].includes(state.status)||state.iteration>=state.maxIterations||Date.now()>state.deadlineAt)return Response.json({error:'Task cannot resume. Create a new task with revised scope.'},{status:409});
   const updated={...state,status:'queued' as const,failureCount:0,nextRunAt:Date.now(),updatedAt:Date.now(),stateVersion:state.stateVersion+1};
   await this.ctx.storage.put('task',updated);await this.ctx.storage.setAlarm(Date.now()+1000);
   return Response.json({task:updated});
  }
  return Response.json({error:'Unknown task action'},{status:404});
 }
 async alarm(){
  const task=await this.ctx.storage.get<TaskRecord>('task');
  if(!task)return;
  if(['activating','monitoring','stopping','cooldown'].includes(task.status)&&task.autonomy?.enabled){await this.supervise(task);return;}
  if(!['queued','retrying','running'].includes(task.status))return;
  const now=Date.now();
  if(now>task.deadlineAt||task.iteration>=task.maxIterations){
   const persistent=task.autonomy?.enabled&&now<=task.deadlineAt;
   const retryAt=now+RESEARCH_COOLDOWN;
   await this.ctx.storage.put('task',{...task,status:persistent?'cooldown':'blocked',
    ...(persistent?{autonomy:{...task.autonomy!,stage:'cooldown' as const,nextResearchAt:retryAt}}:{}),
    nextRunAt:retryAt,lastError:'Research cycle exhausted its model budget. No unverified strategy can deploy.',
    updatedAt:now,stateVersion:task.stateVersion+1,leaseId:undefined});
   if(persistent)await this.ctx.storage.setAlarm(retryAt);
   return;
  }
  if(task.nextRunAt>now){await this.ctx.storage.setAlarm(task.nextRunAt);return;}
  // The lease identifies the callback. A crashed isolate re-runs the same idempotent iteration.
  const leaseId=task.id+':'+task.iteration;
  const current={...task,status:'running' as const,leaseId,updatedAt:now,stateVersion:task.stateVersion+1};
  await this.ctx.storage.put('task',current);
  await this.ctx.storage.setAlarm(now+90_000);
  try{
   const destination=new URL('/api/internal/agent-tasks/tick',this.env.VIBES_CONTROL_URL);
   if(destination.protocol!=='https:')throw Error('Control URL must use HTTPS');
   const reply=await fetch(destination.toString(),{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.env.VIBES_TASK_INTERNAL_SECRET},
    body:JSON.stringify({task:current,leaseId}),signal:AbortSignal.timeout(65_000)});
   if(!reply.ok)throw Error('Task step unavailable (HTTP '+reply.status+')');
   const result=await reply.json<TaskStepResult>();
   if(!result||!['continue','completed','waiting_for_review','blocked'].includes(result.next)||!Array.isArray(result.artifacts)||!Array.isArray(result.facts)||!Array.isArray(result.plan))throw Error('Invalid task step receipt');
   const latest=await this.ctx.storage.get<TaskRecord>('task');
   if(!latest||latest.status==='cancelled'||latest.status==='paused'||latest.leaseId!==leaseId)return;
   const next=applyTaskStep(latest,result,Date.now());
   await this.ctx.storage.put('task',next);
   if(next.status==='queued'||next.status==='activating')await this.ctx.storage.setAlarm(next.status==='queued'?next.nextRunAt:Date.now()+1000);
   else if(next.autonomy?.enabled&&next.status==='blocked'){
    const retryAt=Date.now()+RESEARCH_COOLDOWN;
    await this.ctx.storage.put('task',{...next,status:'cooldown',nextRunAt:retryAt,
     autonomy:{...next.autonomy,stage:'cooldown',nextResearchAt:retryAt}});
    await this.ctx.storage.setAlarm(retryAt);
   }else await this.ctx.storage.deleteAlarm();
  }catch(error){
   const latest=await this.ctx.storage.get<TaskRecord>('task');
   if(!latest||latest.status==='cancelled'||latest.status==='paused'||latest.leaseId!==leaseId)return;
   const failures=latest.failureCount+1,paused=failures>=4||Date.now()>latest.deadlineAt;
   const retryAt=Date.now()+Math.min(90_000,2000*2**failures);
   await this.ctx.storage.put('task',{...latest,status:paused?'blocked':'retrying',lastError:error instanceof Error?error.message.slice(0,180):'Task step failed',failureCount:failures,nextRunAt:retryAt,updatedAt:Date.now(),stateVersion:latest.stateVersion+1,leaseId:undefined});
   if(!paused)await this.ctx.storage.setAlarm(retryAt);
  }
 }

 /** Continue deterministic oversight without repeatedly asking the AI model.
  * The existing PropDAO Durable Object remains responsible for each signal/order.
  */
 private async supervise(task:TaskRecord){
  const now=Date.now(),autonomy=task.autonomy!;
  if(task.status==='cooldown'){
   if(autonomy.stopRequested){await this.ctx.storage.put('task',{...task,status:'cancelled',updatedAt:now,stateVersion:task.stateVersion+1});await this.ctx.storage.deleteAlarm();return;}
   if(task.nextRunAt>now){await this.ctx.storage.setAlarm(task.nextRunAt);return;}
   const queued={...task,status:'queued' as const,iteration:0,failureCount:0,nextRunAt:now,leaseId:undefined,
    memory:{...task.memory,artifacts:[],lastResult:'Starting next independent research cycle'},
    stateVersion:task.stateVersion+1,updatedAt:now,
    autonomy:{...autonomy,stage:'researching' as const,completedCycles:autonomy.completedCycles+1}};
   await this.ctx.storage.put('task',queued);await this.ctx.storage.setAlarm(now+1000);return;
  }
  if(task.nextRunAt>now&&task.status!=='stopping'){await this.ctx.storage.setAlarm(task.nextRunAt);return;}
  const leaseId=task.id+':'+task.iteration+':'+task.stateVersion+':'+task.status;
  const current={...task,leaseId,stateVersion:task.stateVersion+1,updatedAt:now};
  await this.ctx.storage.put('task',current);
  await this.ctx.storage.setAlarm(now+90_000);
  try{
   const action=task.status==='activating'?'activate':'supervise';
   const url=new URL('/api/internal/agent-tasks/'+action,this.env.VIBES_CONTROL_URL);
   if(url.protocol!=='https:')throw Error('Control URL must use HTTPS');
   const response=await fetch(url.toString(),{method:'POST',headers:{
    'Content-Type':'application/json',Authorization:'Bearer '+this.env.VIBES_TASK_INTERNAL_SECRET
   },body:JSON.stringify({task:current,leaseId}),signal:AbortSignal.timeout(65_000)});
   if(!response.ok)throw Error('Autonomy supervision returned HTTP '+response.status);
   const result=await response.json<{outcome:'running'|'stopped'|'retry'|'research'|'halted';botId?:string;codeHash?:string;exposure?:'open'|'pending'|'flat'|'unknown';message?:string}>();
   if(!['running','stopped','retry','research','halted'].includes(result?.outcome))throw Error('Invalid supervisor decision');
   const latest=await this.ctx.storage.get<TaskRecord>('task');
   if(!latest||latest.leaseId!==leaseId||latest.status==='cancelled')return;
   const stop=latest.autonomy!.stopRequested||(task.status!=='activating'&&result.outcome==='halted');
   const status=stop?(result.outcome==='stopped'?'cancelled':'stopping'):
    result.outcome==='running'?'monitoring':
    result.outcome==='research'?'cooldown':
    result.outcome==='halted'?'blocked':
    result.outcome==='stopped'?'cooldown':task.status==='activating'?'activating':'monitoring';
   const retryAt=Date.now()+(status==='monitoring'?MONITOR_INTERVAL:status==='cooldown'?RESEARCH_COOLDOWN:RETRY_DELAY);
   const updated:TaskRecord={...latest,status,nextRunAt:retryAt,leaseId:undefined,updatedAt:Date.now(),stateVersion:latest.stateVersion+1,
    ...(result.message?{lastError:result.outcome==='halted'?result.message:undefined}:{}),
    autonomy:{...latest.autonomy!,stopRequested:stop,stage:status==='monitoring'?'monitoring':status==='stopping'?'stopping':
      status==='cancelled'?'stopping':status==='cooldown'?'cooldown':'activating',
     botId:result.outcome==='research'?undefined:(result.botId||latest.autonomy!.botId),
     codeHash:result.outcome==='research'?undefined:(result.codeHash||latest.autonomy!.codeHash),
     lastMonitorAt:Date.now(),lastBrokerExposure:result.exposure||'unknown',
     lastDeploymentOutcome:(result.message||result.outcome).slice(0,380)}};
   await this.ctx.storage.put('task',updated);
   if(!['cancelled','blocked'].includes(status))await this.ctx.storage.setAlarm(retryAt);
   else await this.ctx.storage.deleteAlarm();
  }catch{
   const latest=await this.ctx.storage.get<TaskRecord>('task');
   if(!latest||latest.leaseId!==leaseId)return;
   const retryAt=Date.now()+RETRY_DELAY;
   await this.ctx.storage.put('task',{...latest,status:latest.autonomy!.stopRequested?'stopping':task.status,
    lastError:'Autonomous broker operation is unverified. Will reconcile; no duplicate deployment should be attempted.',
    nextRunAt:retryAt,leaseId:undefined,updatedAt:Date.now(),stateVersion:latest.stateVersion+1});
   await this.ctx.storage.setAlarm(retryAt);
  }
 }

}
export default {async fetch(req:Request,env:Env){
 if(!(await authorized(req.headers.get('authorization')||'',env.VIBES_TASK_INTERNAL_SECRET)))return Response.json({error:'Internal authorization required'},{status:401});
 const path=new URL(req.url).pathname.split('/').filter(Boolean);
 if(path.length===1&&path[0]==='health')return Response.json({ready:true,runtime:'durable-task-memory'});
 if(path.length!==3||path[0]!=='tasks'||!idPattern.test(path[1])||!['start','status','cancel','pause','resume','policy'].includes(path[2]))return Response.json({error:'Unknown task route'},{status:404});
 const uid=req.headers.get('X-TV-UID')||'';
 if(!uidPattern.test(uid))return Response.json({error:'Invalid owner'},{status:403});
 const key=new TextEncoder().encode(uid+':'+path[1]);const digest=await crypto.subtle.digest('SHA-256',key);
 const name=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 const target=env.TASKS.get(env.TASKS.idFromName(name));
 return target.fetch(new Request('https://task/'+path[2],{method:req.method,headers:{'X-TV-UID':uid,'X-TV-TASK-ID':path[1]},...(req.method==='POST'?{body:await req.text()}: {})}));
}} satisfies ExportedHandler<Env>;
