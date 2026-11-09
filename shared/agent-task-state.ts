/** User-scoped durable task contract. Stores decisions and evidence, never chain-of-thought or credentials. */
export type TaskPhase='discovery'|'research'|'authoring'|'validation'|'backtesting'|'evaluation'|'review';
export type TaskStatus='queued'|'running'|'retrying'|'paused'|'activating'|'monitoring'|'stopping'|'cooldown'|'waiting_for_review'|'completed'|'blocked'|'failed'|'cancelled';
export type TaskArtifact={kind:'draft'|'draft-fragment'|'backtest'|'evaluation'|'market-evidence';id:string;codeHash?:string;venue?:string;asset?:string;quality?:'reference'|'verified';reviewEligible?:boolean;updatedAt:string};
export type TaskMemory={summary:string;plan:string[];facts:string[];artifacts:TaskArtifact[];lastResult:string};
export type TaskRecord={
 schemaVersion:1;stateVersion:number;id:string;ownerUid:string;objective:string;status:TaskStatus;phase:TaskPhase;
 createdAt:number;updatedAt:number;deadlineAt:number;iteration:number;maxIterations:number;
 failureCount:number;nextRunAt:number;lastError?:string;leaseId?:string;
 autonomy?:{enabled:true;stage:'researching'|'activating'|'monitoring'|'stopping'|'cooldown';stopRequested:boolean;botId?:string;codeHash?:string;lastMonitorAt?:number;nextResearchAt?:number;completedCycles:number;policyRequired:true;lastBrokerExposure?:'open'|'pending'|'flat'|'unknown';lastDeploymentOutcome?:string};
 policy?:{policyId:string;fingerprint:string;accountId:string;expiresAt:number;mode:'bounded-demo'|'full-demo';linkedAt:number};
 memory:TaskMemory;
};
export type TaskStepResult={
 phase:TaskPhase;summary:string;plan:string[];facts:string[];artifacts:TaskArtifact[];
 next:'continue'|'completed'|'waiting_for_review'|'blocked';message:string;
};
export const emptyTaskMemory=():TaskMemory=>({summary:'',plan:[],facts:[],artifacts:[],lastResult:''});
const compact=(s:unknown,n:number)=>typeof s==='string'?s
 .replace(/sk-or-v1-[a-z0-9]{16,}/gi,'[REDACTED]')
 .replace(/pd_live_[a-z0-9_-]{16,}/gi,'[REDACTED]')
 .replace(/Bearer\s+[A-Za-z0-9._-]{24,}/gi,'Bearer [REDACTED]')
 .replace(/((?:api[_-]?key|password|client[_-]?secret)\s*[:=]\s*)['"]?[A-Za-z0-9._-]{16,}['"]?/gi,'$1[REDACTED]')
 .slice(0,n):'';
/** Scrub credential-shaped material before Firestore receipts and Durable Object checkpoints. */
export function sanitizeTaskStepResult(r:TaskStepResult):TaskStepResult{
 return {
  phase:r.phase,next:r.next,
  summary:compact(r.summary,2500),message:compact(r.message,1400),
  plan:(r.plan||[]).slice(0,12).map(x=>compact(x,180)),
  facts:(r.facts||[]).slice(-16).map(x=>compact(x,250)),
  artifacts:(r.artifacts||[]).filter(x=>x&&/^[a-z0-9_-]{8,100}$/i.test(x.id)).slice(0,12)
 };
}
export function applyTaskStep(task:TaskRecord,result:TaskStepResult,now:number):TaskRecord{
 result=sanitizeTaskStepResult(result);
 const artifacts=new Map(task.memory.artifacts.map(a=>[a.kind+':'+a.id,a]));
 for(const a of result.artifacts.slice(0,12))if(a&&/^[a-z0-9_-]{8,100}$/i.test(a.id)&&['draft','draft-fragment','backtest','evaluation','market-evidence'].includes(a.kind))artifacts.set(a.kind+':'+a.id,a);
 const memory:TaskMemory={
  summary:compact(result.summary,2500),
  plan:result.plan.slice(0,12).map(x=>compact(x,180)),
  facts:[...task.memory.facts,...result.facts].slice(-16).map(x=>compact(x,250)),
  artifacts:[...artifacts.values()].slice(-20),
  lastResult:compact(result.message,1400)
 };
 const hasReviewableEvidence=memory.artifacts.some(a=>a.kind==='evaluation'&&a.reviewEligible===true&&a.codeHash&&
  memory.artifacts.some(b=>b.kind==='draft'&&b.codeHash===a.codeHash)&&
  memory.artifacts.some(c=>c.kind==='backtest'&&c.codeHash===a.codeHash));
 // Research-only tasks may complete without a draft; strategy tasks must have a validated simulation and stop for review.
 const isStrategy=/\b(strategy|strategies|robot|bot|backtest|propdao|pass.*firm)\b/i.test(task.objective);
 let status:TaskStatus=result.next==='blocked'?'blocked':result.next==='waiting_for_review'?'waiting_for_review':result.next==='completed'?'completed':'queued';
 if(isStrategy&&['completed','waiting_for_review'].includes(status))status=hasReviewableEvidence?'waiting_for_review':'queued';
 if(task.autonomy?.enabled&&status==='waiting_for_review')status=task.policy&&Date.now()<task.policy.expiresAt?'activating':'waiting_for_review';
 const iteration=task.iteration+1;
 if(status==='queued'&&(iteration>=task.maxIterations||now>=task.deadlineAt))status='blocked';
 return {...task,phase:result.phase,status,iteration,updatedAt:now,stateVersion:task.stateVersion+1,leaseId:undefined,failureCount:0,nextRunAt:now+1200,
  lastError:status==='blocked'&&result.next!=='blocked'?'Task work budget was exhausted before the completion gate passed.':undefined,memory};
}
export function initialTask(ownerUid:string,id:string,objective:string,now=Date.now(),maxIterations=12,runtimeMinutes=60,continuous=false):TaskRecord{
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id)||!ownerUid||ownerUid.length>128||!objective.trim()||objective.length>1200||!Number.isInteger(runtimeMinutes)||runtimeMinutes<5||runtimeMinutes>10080)throw Error('Invalid task identity, deadline or objective');
 return {schemaVersion:1,stateVersion:1,id,ownerUid,objective:objective.trim(),status:'queued',phase:'discovery',
  createdAt:now,updatedAt:now,deadlineAt:continuous?253402300799000:now+runtimeMinutes*60_000,iteration:0,maxIterations:Number.isInteger(maxIterations)?Math.min(Math.max(maxIterations,1),80):12,
  failureCount:0,nextRunAt:now,...(continuous?{autonomy:{enabled:true as const,stage:'researching' as const,stopRequested:false,completedCycles:0,policyRequired:true as const}}:{}),memory:emptyTaskMemory()};
}
