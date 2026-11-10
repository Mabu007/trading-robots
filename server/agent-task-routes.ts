import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import type {Express,Request,Response} from 'express';
import {z} from 'zod';
import {sanitizeTaskStepResult,type TaskRecord,type TaskStepResult} from '../shared/agent-task-state.ts';
import {runDurableTaskStep} from './agent-task-engine.ts';
import type {OpenRouterAccounts} from './openrouter-account.ts';
import type {PropDAOAccounts} from './propdao-account.ts';
import type {VenueMarketData} from './venue-market-data.ts';
import {FirestoreStore,type RecordStore} from './firestore-store.ts';
import {validateSkill,skillPrompt,type UserSkill} from '../src/skills.ts';
import {DemoPolicyStore} from './agent-demo-policy.ts';
import {activateDemoRobot} from './agent-autonomy-activation.ts';
import {superviseDemoTask} from './agent-autonomy-supervisor.ts';
import type {PropDAOLiveService} from './propdao-live-routes.ts';

const safeId=z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const uidSchema=z.string().min(1).max(128).regex(/^[\w:-]+$/);
const questionSchema=z.object({id:safeId,prompt:z.string().min(10).max(440),options:z.tuple([z.string().min(5).max(185),z.string().min(5).max(185)]),context:z.string().max(310),createdAt:z.number().int()}).strict();
const taskSchema=z.object({
 schemaVersion:z.literal(1),stateVersion:z.number().int().min(1),id:safeId,ownerUid:uidSchema,objective:z.string().min(1).max(1200),
 status:z.enum(['queued','running','retrying','paused','activating','monitoring','stopping','cooldown','waiting_for_review','waiting_for_input','completed','blocked','failed','cancelled']),
 phase:z.enum(['discovery','research','authoring','validation','backtesting','evaluation','review']),
 createdAt:z.number().int(),updatedAt:z.number().int(),deadlineAt:z.number().int(),
 iteration:z.number().int().nonnegative().max(80),maxIterations:z.number().int().min(1).max(80),
 failureCount:z.number().int().nonnegative().max(100),nextRunAt:z.number().int(),
 leaseId:z.string().optional(),lastError:z.string().optional(),question:questionSchema.optional(),
 usage:z.object({inputTokens:z.number().nonnegative(),outputTokens:z.number().nonnegative(),estimatedModelUsd:z.number().nonnegative(),steps:z.number().int().nonnegative()}).strict().optional(),
 autonomy:z.object({
  enabled:z.literal(true),stage:z.enum(['researching','activating','monitoring','stopping','cooldown']),
  stopRequested:z.boolean(),botId:safeId.optional(),codeHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  lastMonitorAt:z.number().int().optional(),nextResearchAt:z.number().int().optional(),
  completedCycles:z.number().int().nonnegative(),policyRequired:z.literal(true),
  lastBrokerExposure:z.enum(['open','pending','flat','unknown']).optional(),lastDeploymentOutcome:z.string().max(400).optional()
 }).strict().optional(),
 policy:z.object({
  policyId:safeId,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),accountId:safeId,
  expiresAt:z.number().int(),mode:z.enum(['bounded-demo','full-demo']),linkedAt:z.number().int()
 }).strict().optional(),memory:z.object({
  summary:z.string().max(2500),plan:z.array(z.string().max(180)).max(12),
  facts:z.array(z.string().max(250)).max(16),
  artifacts:z.array(z.object({
   kind:z.enum(['draft','draft-fragment','backtest','evaluation','market-evidence']),id:safeId,codeHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
   venue:z.string().optional(),asset:z.string().optional(),quality:z.enum(['reference','verified']).optional(),reviewEligible:z.boolean().optional(),
   updatedAt:z.string()
  })).max(20),lastResult:z.string().max(1400)
 })
}).strict();
/** Normalize Zod's runtime-validated pair to the shared fixed tuple type.
 * Zod 4's variadic tuple inference can otherwise mark both items optional
 * under the production TypeScript compiler even after safeParse succeeds. */
function verifiedTaskRecord(validated:z.infer<typeof taskSchema>):TaskRecord{
 const {question,...rest}=validated;
 if(!question)return rest;
 const first=question.options[0],second=question.options[1];
 if(typeof first!=='string'||typeof second!=='string')
  throw Error('Task runtime question requires exactly two alternatives.');
 return {...rest,question:{...question,options:[first,second]}};
}
type Dependencies={
 uidOrReply:(req:Request,res:Response)=>Promise<string|null>;
 accounts:OpenRouterAccounts;market:VenueMarketData;propdao?:Pick<PropDAOAccounts,'list'|'accountRisk'>;
 deploymentStatus?:(uid:string,botId:string)=>Promise<unknown>;
 policyStatus?:(uid:string,policyId:string)=>Promise<import('./agent-demo-policy.ts').DemoPolicy>;
 read:(key:string)=>Promise<string|null>;
 write:(key:string,value:string)=>Promise<void>;
 owned:(uid:string,id:string)=>Promise<{id?:string;userId?:string;ownerUid?:string;asset?:string;venue?:string}|null>;
 tasks:RecordStore;
 live?:()=>Pick<PropDAOLiveService,'status'|'stop'|'deploy'|'reviewAutonomous'>;
};
export function taskRuntimeConfigured(env:NodeJS.ProcessEnv=process.env){
 try{
  const url=new URL(env.VIBES_TASK_WORKER_URL||'');
  return url.protocol==='https:'&&url.username===''&&url.password===''&&
   Boolean(env.VIBES_TASK_INTERNAL_SECRET&&env.VIBES_TASK_INTERNAL_SECRET.length>=32);
 }catch{return false;}
}
const validSecret=(presented:unknown,actual:string|undefined)=>{
 if(!actual||actual.length<32||typeof presented!=='string'||presented.length>256)return false;
 const a=createHash('sha256').update(presented).digest(),b=createHash('sha256').update('Bearer '+actual).digest();
 return timingSafeEqual(a,b);
};
async function callWorker(uid:string,id:string,action:'start'|'status'|'cancel'|'pause'|'resume'|'policy'|'answer',body?:unknown,request:typeof fetch=fetch){
 const target=process.env.VIBES_TASK_WORKER_URL,secret=process.env.VIBES_TASK_INTERNAL_SECRET;
 if(!taskRuntimeConfigured())throw Error('Durable agent task runtime is not configured');
 const uri=new URL('/tasks/'+id+'/'+action,target);
 const reply=await request(uri,{method:action==='status'?'GET':'POST',headers:{
  Authorization:'Bearer '+secret,'X-TV-UID':uid,'Content-Type':'application/json'
 },...(action==='status'?{}:{body:JSON.stringify(body||{})}),signal:AbortSignal.timeout(12000)});
 const data:any=await reply.json().catch(()=>null);
 if(!reply.ok)throw Error(typeof data?.error==='string'?data.error.slice(0,180):'Durable task runtime error');
 const state=taskSchema.safeParse(data?.task);
 if(!state.success||state.data.ownerUid!==uid||state.data.id!==id)throw Error('Task runtime returned unverified task data');
 return state.data;
}
export function registerAgentTaskRoutes(app:Express,deps:Dependencies){
 // This HTTP boundary is intentionally disabled until a separate, authenticated
 // Cloudflare Durable Object Worker has been deployed. No in-process fake durability.
 app.post('/api/agent-tasks',async(req,res)=>{
  const uid=await deps.uidOrReply(req,res);if(!uid)return;
  if(!taskRuntimeConfigured())return res.status(503).json({error:'Durable task runtime has not been connected.'});
  const input=z.object({objective:z.string().min(12).max(1200),maxIterations:z.number().int().min(1).max(80).optional(),runtimeMinutes:z.number().int().min(5).max(10080).optional(),continuous:z.boolean().optional(),policyId:z.string().uuid().optional()}).strict().safeParse(req.body);
  if(!input.success)return res.status(400).json({error:'Describe a specific task objective (12–1,200 characters).'});
  const id=randomUUID(),path='users/'+uid+'/agent-tasks/'+id;
  try{
   let policy:null|import('./agent-demo-policy.ts').DemoPolicy=null;
   if(input.data.continuous===true){
    if(!input.data.policyId)return res.status(400).json({error:'Choose an authorized DEMO policy before starting a run-until-stopped agent.'});
    policy=await new DemoPolicyStore(deps.tasks).owned(uid,input.data.policyId);
    if(!policy.demoOnly||policy.mode!=='full-demo'||policy.revokedAt!==null||policy.expiresAt<=Date.now())
     return res.status(409).json({error:'A full-demo active policy is required for continuous autonomous operation.'});
   }
   const existing=await deps.tasks.query('users/'+uid+'/agent-tasks');
   if(existing.filter(item=>item.ownerUid===uid&&typeof item.createdAt==='number'&&item.createdAt>Date.now()-86_400_000).length>=8)
    return res.status(429).json({error:'Daily agent task limit reached. Use or review existing tasks before starting more.'});
   await deps.tasks.put(path,{id,ownerUid:uid,objective:input.data.objective,createdAt:Date.now(),status:'starting'});
   let task=await callWorker(uid,id,'start',input.data);
   if(policy){
    task=await callWorker(uid,id,'policy',{policyId:policy.id,fingerprint:policy.fingerprint,
     accountId:policy.accountId,mode:policy.mode,expiresAt:policy.expiresAt});
   }
   await deps.tasks.put(path,{id,ownerUid:uid,objective:task.objective,createdAt:task.createdAt,status:task.status});
   return res.status(201).json({task});
  }catch(error){return res.status(503).json({error:error instanceof Error?error.message:'Could not create durable task'});}
 });
 app.get('/api/agent-tasks',async(req,res)=>{
  const uid=await deps.uidOrReply(req,res);if(!uid)return;
  try{
   const items=await deps.tasks.page?.('users/'+uid+'/agent-tasks',undefined,undefined,undefined,30) ??
    {items:await deps.tasks.query('users/'+uid+'/agent-tasks'),next:null};
   const owned=items.items.filter(row=>row.ownerUid===uid&&safeId.safeParse(row.id).success)
    .sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).slice(0,10);
   const verified=await Promise.all(owned.map(async row=>{
    if(!taskRuntimeConfigured())return {id:row.id,objective:row.objective,createdAt:row.createdAt,status:'unavailable'};
    try{const state=await callWorker(uid,row.id,'status');return {id:row.id,objective:row.objective,createdAt:row.createdAt,status:state.status}}
    catch{return {id:row.id,objective:row.objective,createdAt:row.createdAt,status:'unavailable'}}
   }));
   return res.json({tasks:verified});
  }catch{return res.status(503).json({error:'Could not load the task index'});}
 });
 app.get('/api/agent-tasks/:id',async(req,res)=>{
  const uid=await deps.uidOrReply(req,res);if(!uid)return;
  const parsed=safeId.safeParse(req.params.id);
  if(!parsed.success)return res.status(400).json({error:'Invalid task ID'});
  try{return res.json({task:await callWorker(uid,parsed.data,'status')})}
  catch(error){return res.status(503).json({error:error instanceof Error?error.message:'Task temporarily unavailable'});}
 });
 for(const action of ['cancel','pause','resume'] as const)app.post('/api/agent-tasks/:id/'+action,async(req,res)=>{
  const uid=await deps.uidOrReply(req,res);if(!uid)return;
  const parsed=safeId.safeParse(req.params.id);
  if(!parsed.success)return res.status(400).json({error:'Invalid task ID'});
  try{
    const task=await callWorker(uid,parsed.data,action);
    await deps.tasks.put('users/'+uid+'/agent-tasks/'+parsed.data,{id:task.id,ownerUid:uid,objective:task.objective,createdAt:task.createdAt,status:task.status}).catch(()=>undefined);
    return res.json({task});
   }
  catch(error){return res.status(409).json({error:error instanceof Error?error.message:'Task could not be updated'});}
 });
 app.post('/api/agent-tasks/:id/answer',async(req,res)=>{
  const uid=await deps.uidOrReply(req,res);if(!uid)return;
  const id=safeId.safeParse(req.params.id),response=z.object({
   questionId:safeId,answer:z.string().trim().min(1).max(600)
  }).strict().safeParse(req.body);
  if(!id.success||!response.success)return res.status(400).json({error:'Invalid question response'});
  try{
   const task=await callWorker(uid,id.data,'answer',response.data);
   await deps.tasks.put('users/'+uid+'/agent-tasks/'+id.data,{
    id:id.data,ownerUid:uid,objective:task.objective,createdAt:task.createdAt,status:task.status
   });
   return res.json({task,notice:'Clarification recorded. No new broker authorization was granted.'});
  }catch(error){return res.status(409).json({error:error instanceof Error?error.message:'The question could not be answered'});}
 });
 app.post('/api/agent-tasks/:id/policy',async(req,res)=>{
  const uid=await deps.uidOrReply(req,res);if(!uid)return;
  const taskId=safeId.safeParse(req.params.id),policyId=z.string().uuid().safeParse(req.body?.policyId);
  if(!taskId.success||!policyId.success)return res.status(400).json({error:'A valid task and policy ID are required'});
  try{
   const task=await callWorker(uid,taskId.data,'status');
   if(['cancelled','completed','failed'].includes(task.status))return res.status(409).json({error:'Task is terminal'});
   const stored=await new DemoPolicyStore(deps.tasks).owned(uid,policyId.data);
   if(stored.revokedAt!==null||Date.now()>=stored.expiresAt||stored.demoOnly!==true||
    !/^[a-f0-9]{64}$/.test(stored.fingerprint))return res.status(409).json({error:'Demo authorization is not active or verified'});
   const linked=await callWorker(uid,taskId.data,'policy',{policyId:stored.id,
    fingerprint:stored.fingerprint,accountId:stored.accountId,mode:stored.mode,expiresAt:stored.expiresAt});
   return res.json({task:linked,executionEnabled:false,
    warning:'A policy pointer is linked for research planning only. This does not authorize order placement.'});
  }catch(error){return res.status(409).json({error:error instanceof Error?error.message:'Could not link policy'});}
 });
 app.get('/api/agent-tasks/:id/events',async(req,res)=>{
  const uid=await deps.uidOrReply(req,res);if(!uid)return;
  const id=safeId.safeParse(req.params.id);
  if(!id.success)return res.status(400).json({error:'Invalid task ID'});
  try{
   const task=await callWorker(uid,id.data,'status');
   if(task.ownerUid!==uid)return res.status(403).json({error:'Task owner mismatch'});
   const receipts=await deps.tasks.query('users/'+uid+'/agentTaskReceipts');
   const events=receipts.filter(row=>row.taskId===id.data&&row.ownerUid===uid&&
    Number.isInteger(row.iteration)&&row.result&&typeof row.result==='object')
    .sort((a,b)=>a.iteration-b.iteration).slice(-25).map(row=>({
     iteration:row.iteration,at:row.savedAt,phase:row.result.phase,
     summary:String(row.result.message||'').slice(0,400),
     outcome:row.result.next,
     artifacts:Array.isArray(row.result.artifacts)?row.result.artifacts.map((a:any)=>a.kind).slice(0,8):[]
    }));
   return res.json({taskId:id.data,events,brokerExecutionNotifications:false});
  }catch{return res.status(503).json({error:'Task event history unavailable'});}
 });
 app.get('/api/agent-tasks/:id/drafts/:draftId',async(req,res)=>{
  const uid=await deps.uidOrReply(req,res);if(!uid)return;
  const id=safeId.safeParse(req.params.id),draft=z.string().regex(/^draft_[a-f0-9]{32}$/).safeParse(req.params.draftId);
  if(!id.success||!draft.success)return res.status(400).json({error:'Invalid task or draft ID'});
  try{
   const task=await callWorker(uid,id.data,'status');
   const savedRef=task.memory.artifacts.find(a=>a.kind==='draft'&&a.id===draft.data);
   if(!savedRef)return res.status(404).json({error:'No authorized draft on this task'});
   const key='agent-task-drafts/v1/'+Buffer.from(uid).toString('base64url')+'/'+id.data+'/'+draft.data+'.json';
   const raw=await deps.read(key);
   if(!raw||raw.length>25000)return res.status(404).json({error:'Draft source unavailable'});
   const saved=JSON.parse(raw);
   if(saved.ownerUid!==uid||saved.taskId!==id.data||savedRef.codeHash!==saved.codeHash||
    typeof saved.source!=='string'||createHash('sha256').update(saved.source).digest('hex')!==saved.codeHash)throw Error('Draft integrity mismatch');
   return res.json({draftId:draft.data,codeHash:saved.codeHash,venue:saved.venue,asset:saved.asset,source:saved.source});
  }catch{return res.status(503).json({error:'Could not verify the saved draft'});}
 });
 const internalLease=z.object({task:taskSchema,leaseId:z.string().min(15).max(160)}).strict();
 const leaseCurrent=async(task:TaskRecord,leaseId:string)=>{
  try{
   const actual=await callWorker(task.ownerUid,task.id,'status');
   return actual.leaseId===leaseId&&actual.stateVersion===task.stateVersion&&
    actual.status===task.status&&actual.autonomy?.stopRequested===task.autonomy?.stopRequested;
  }catch{return false}
 };
 for(const op of ['activate','supervise'] as const)app.post('/api/internal/agent-tasks/'+op,async(req,res)=>{
  if(!validSecret(req.header('authorization'),process.env.VIBES_TASK_INTERNAL_SECRET))
   return res.status(401).json({error:'Internal agent authorization required'});
  const parsed=internalLease.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid autonomous task lease'});
  const {leaseId}=parsed.data;
  const task=verifiedTaskRecord(parsed.data.task);
  if(!task.autonomy?.enabled||task.leaseId!==leaseId||
   !['activating','monitoring','stopping'].includes(task.status)||Date.now()-task.updatedAt>90_000||
   (op==='activate'&&task.status!=='activating')||
   (op==='supervise'&&task.status==='activating'))
   return res.status(409).json({error:'Task stage or lease is not authorized'});
  if(!(await leaseCurrent(task,leaseId)))return res.status(409).json({error:'Task was stopped, superseded or its lease changed'});
  if(!deps.live||!deps.propdao)return res.status(503).json({error:'Existing PropDAO broker adapter is not connected'});
  try{
   let result;
   if(op==='activate'){
    if(!FirestoreStore.configured())return res.status(503).json({error:'Server account and policy storage is not configured'});
    result=await activateDemoRobot(task,{store:deps.tasks,objects:{read:deps.read,write:deps.write},
     market:deps.market,accounts:deps.propdao as any,live:deps.live(),
     verifyLease:async()=>leaseCurrent(task,leaseId)});
   }else{
    const live=deps.live();
    result=await superviseDemoTask(task,{
     policy:(uid,id)=>new DemoPolicyStore(deps.tasks).owned(uid,id),
     snapshot:(uid,accountId)=>(deps.propdao as any).accountRisk(uid,accountId),
     status:(uid,botId)=>live.status(uid,botId),
     stop:(uid,botId)=>live.stop(uid,botId)});
   }
   const key='users/'+task.ownerUid+'/agentAutonomyEvents/'+task.id+'_'+task.stateVersion;
   await deps.tasks.put(key,{taskId:task.id,ownerUid:task.ownerUid,iteration:task.iteration,
    at:Date.now(),phase:task.status,outcome:result.outcome,botId:result.botId||null,
    codeHash:result.codeHash||null,exposure:result.exposure,message:result.message?.slice(0,380)});
   return res.json(result);
  }catch(error){
   console.error('Agent autonomy step failed',{task:task.id,action:op,type:error instanceof Error?error.name:'unknown'});
   return res.status(503).json({error:'Autonomous broker supervisor unavailable; robot status must be reconciled before retry'});
  }
 });
 app.post('/api/internal/agent-tasks/tick',async(req,res)=>{
  if(!validSecret(req.header('authorization'),process.env.VIBES_TASK_INTERNAL_SECRET))return res.status(401).json({error:'Internal task authorization required'});
  const parsed=z.object({task:taskSchema,leaseId:z.string().min(10).max(128)}).strict().safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid task checkpoint'});
  const {leaseId}=parsed.data;
  const task=verifiedTaskRecord(parsed.data.task);
  if(task.status!=='running'||task.leaseId!==leaseId||leaseId!==task.id+':'+task.iteration||
   Date.now()>task.deadlineAt||Date.now()-task.updatedAt>90_000)return res.status(409).json({error:'Stale or invalid task step lease'});
  try{
   const receiptPath='users/'+task.ownerUid+'/agentTaskReceipts/'+task.id+'_'+task.iteration;
   const prior=await deps.tasks.get(receiptPath);
   if(prior?.taskId===task.id&&prior.ownerUid===task.ownerUid&&prior.iteration===task.iteration&&prior.result)
    return res.json(prior.result);
   const receipt=sanitizeTaskStepResult(await runDurableTaskStep(task,{
    ...deps,
    loadSkills:async(owner,objective)=>{
     if(!FirestoreStore.configured())return '';
     const rows=await deps.tasks.query('users/'+owner+'/skills');
     const valid:UserSkill[]=[];
     for(const row of rows.slice(0,30)){
      try{valid.push(validateSkill({id:String(row.id||''),name:String(row.name||''),
       description:String(row.description||''),instructions:String(row.instructions||''),
       triggers:Array.isArray(row.triggers)?row.triggers:[],
       enabled:row.enabled===true,alwaysOn:row.alwaysOn===true}));}catch{}
     }
     return skillPrompt(objective,valid).replace(/sk-or-v1-[a-z0-9]{16,}/gi,'[REDACTED]')
      .replace(/Bearer\s+[a-z0-9._-]{24,}/gi,'Bearer [REDACTED]');
    }
   }));
   await deps.tasks.put(receiptPath,{taskId:task.id,ownerUid:task.ownerUid,iteration:task.iteration,result:receipt,savedAt:Date.now()});
   return res.json(receipt satisfies TaskStepResult);
  }catch(error){
   // Do not disclose external provider credentials, raw SDK error objects or secrets.
   console.error('Agent task step unsuccessful',{taskId:task.id,iteration:task.iteration,errorType:error instanceof Error?error.name:'unknown'});
   return res.status(503).json({error:'Agent task step unavailable. The durable runtime will retry within its budget.'});
  }
 });
}
