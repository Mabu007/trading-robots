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
   const body=await req.json<{objective?:string;maxIterations?:number}>().catch(()=>null);
   if(!body||typeof body.objective!=='string')return Response.json({error:'Task objective required'},{status:400});
   try{
    const created=initialTask(uid,id,body.objective,Date.now(),body.maxIterations);
    await this.ctx.storage.put('task',created);
    await this.ctx.storage.setAlarm(Date.now()+1000);
    return Response.json({task:created},{status:201});
   }catch{return Response.json({error:'Invalid objective'},{status:400})}
  }
  if(!state)return Response.json({error:'Unknown task'},{status:404});
  if(path==='/status'&&req.method==='GET')return Response.json({task:state});
  if(path==='/cancel'&&req.method==='POST'){
   const updated={...state,status:'cancelled' as const,leaseId:undefined,updatedAt:Date.now()};
   await this.ctx.storage.put('task',updated);
   await this.ctx.storage.deleteAlarm();
   return Response.json({task:updated});
  }
  if(path==='/resume'&&req.method==='POST'){
   if(!['blocked','retrying'].includes(state.status)||state.iteration>=state.maxIterations||Date.now()>state.deadlineAt)return Response.json({error:'Task cannot resume. Create a new task with revised scope.'},{status:409});
   const updated={...state,status:'queued' as const,failureCount:0,nextRunAt:Date.now(),updatedAt:Date.now()};
   await this.ctx.storage.put('task',updated);await this.ctx.storage.setAlarm(Date.now()+1000);
   return Response.json({task:updated});
  }
  return Response.json({error:'Unknown task action'},{status:404});
 }
 async alarm(){
  const task=await this.ctx.storage.get<TaskRecord>('task');
  if(!task||!['queued','retrying','running'].includes(task.status))return;
  const now=Date.now();
  if(now>task.deadlineAt||task.iteration>=task.maxIterations){
   await this.ctx.storage.put('task',{...task,status:'blocked',lastError:'Task time or model-call budget exhausted',updatedAt:now,leaseId:undefined});return;
  }
  if(task.nextRunAt>now){await this.ctx.storage.setAlarm(task.nextRunAt);return;}
  // The lease identifies the callback. A crashed isolate re-runs the same idempotent iteration.
  const leaseId=task.id+':'+task.iteration;
  const current={...task,status:'running' as const,leaseId,updatedAt:now};
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
   if(!latest||latest.status==='cancelled'||latest.leaseId!==leaseId)return;
   const next=applyTaskStep(latest,result,Date.now());
   await this.ctx.storage.put('task',next);
   if(next.status==='queued')await this.ctx.storage.setAlarm(next.nextRunAt);
   else await this.ctx.storage.deleteAlarm();
  }catch(error){
   const latest=await this.ctx.storage.get<TaskRecord>('task');
   if(!latest||latest.status==='cancelled'||latest.leaseId!==leaseId)return;
   const failures=latest.failureCount+1,paused=failures>=4||Date.now()>latest.deadlineAt;
   const retryAt=Date.now()+Math.min(90_000,2000*2**failures);
   await this.ctx.storage.put('task',{...latest,status:paused?'blocked':'retrying',lastError:error instanceof Error?error.message.slice(0,180):'Task step failed',failureCount:failures,nextRunAt:retryAt,updatedAt:Date.now(),leaseId:undefined});
   if(!paused)await this.ctx.storage.setAlarm(retryAt);
  }
 }
}
export default {async fetch(req:Request,env:Env){
 if(!(await authorized(req.headers.get('authorization')||'',env.VIBES_TASK_INTERNAL_SECRET)))return Response.json({error:'Internal authorization required'},{status:401});
 const path=new URL(req.url).pathname.split('/').filter(Boolean);
 if(path.length===1&&path[0]==='health')return Response.json({ready:true,runtime:'durable-task-memory'});
 if(path.length!==3||path[0]!=='tasks'||!idPattern.test(path[1])||!['start','status','cancel','resume'].includes(path[2]))return Response.json({error:'Unknown task route'},{status:404});
 const uid=req.headers.get('X-TV-UID')||'';
 if(!uidPattern.test(uid))return Response.json({error:'Invalid owner'},{status:403});
 const key=new TextEncoder().encode(uid+':'+path[1]);const digest=await crypto.subtle.digest('SHA-256',key);
 const name=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 const target=env.TASKS.get(env.TASKS.idFromName(name));
 return target.fetch(new Request('https://task/'+path[2],{method:req.method,headers:{'X-TV-UID':uid,'X-TV-TASK-ID':path[1]},...(req.method==='POST'?{body:await req.text()}: {})}));
}} satisfies ExportedHandler<Env>;
