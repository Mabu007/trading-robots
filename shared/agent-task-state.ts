/** User-scoped durable task contract. Stores decisions and evidence, never chain-of-thought or credentials. */
export type TaskPhase='discovery'|'research'|'authoring'|'validation'|'backtesting'|'evaluation'|'review';
export type TaskStatus='queued'|'running'|'retrying'|'waiting_for_review'|'completed'|'blocked'|'failed'|'cancelled';
export type TaskArtifact={kind:'draft'|'backtest'|'market-evidence';id:string;codeHash?:string;venue?:string;asset?:string;quality?:'reference'|'verified';updatedAt:string};
export type TaskMemory={summary:string;plan:string[];facts:string[];artifacts:TaskArtifact[];lastResult:string};
export type TaskRecord={
 schemaVersion:1;id:string;ownerUid:string;objective:string;status:TaskStatus;phase:TaskPhase;
 createdAt:number;updatedAt:number;deadlineAt:number;iteration:number;maxIterations:number;
 failureCount:number;nextRunAt:number;lastError?:string;leaseId?:string;
 memory:TaskMemory;
};
export type TaskStepResult={
 phase:TaskPhase;summary:string;plan:string[];facts:string[];artifacts:TaskArtifact[];
 next:'continue'|'completed'|'waiting_for_review'|'blocked';message:string;
};
export const emptyTaskMemory=():TaskMemory=>({summary:'',plan:[],facts:[],artifacts:[],lastResult:''});
const compact=(s:unknown,n:number)=>typeof s==='string'?s.replace(/sk-or-v1-[a-z0-9]{16,}/gi,'[REDACTED]').replace(/Bearer\s+[A-Za-z0-9._-]{24,}/g,'Bearer [REDACTED]').slice(0,n):'';
export function applyTaskStep(task:TaskRecord,result:TaskStepResult,now:number):TaskRecord{
 const artifacts=new Map(task.memory.artifacts.map(a=>[a.kind+':'+a.id,a]));
 for(const a of result.artifacts.slice(0,12))if(a&&/^[a-z0-9_-]{8,100}$/i.test(a.id)&&['draft','backtest','market-evidence'].includes(a.kind))artifacts.set(a.kind+':'+a.id,a);
 const memory:TaskMemory={
  summary:compact(result.summary,2500),
  plan:result.plan.slice(0,12).map(x=>compact(x,180)),
  facts:[...task.memory.facts,...result.facts].slice(-16).map(x=>compact(x,250)),
  artifacts:[...artifacts.values()].slice(-20),
  lastResult:compact(result.message,1400)
 };
 const hasDraft=memory.artifacts.some(a=>a.kind==='draft');
 const hasBacktest=memory.artifacts.some(a=>a.kind==='backtest'&&a.codeHash&&memory.artifacts.some(b=>b.kind==='draft'&&b.codeHash===a.codeHash));
 // Research-only tasks may complete without a draft; strategy tasks must have a validated simulation and stop for review.
 const isStrategy=/\b(strategy|strategies|robot|bot|backtest|propdao|pass.*firm)\b/i.test(task.objective);
 let status:TaskStatus=result.next==='blocked'?'blocked':result.next==='waiting_for_review'?'waiting_for_review':result.next==='completed'?'completed':'queued';
 if(isStrategy&&['completed','waiting_for_review'].includes(status))status=hasDraft&&hasBacktest?'waiting_for_review':'queued';
 const iteration=task.iteration+1;
 if(status==='queued'&&(iteration>=task.maxIterations||now>=task.deadlineAt))status='blocked';
 return {...task,phase:result.phase,status,iteration,updatedAt:now,leaseId:undefined,failureCount:0,nextRunAt:now+1200,
  lastError:status==='blocked'&&result.next!=='blocked'?'Task work budget was exhausted before the completion gate passed.':undefined,memory};
}
export function initialTask(ownerUid:string,id:string,objective:string,now=Date.now(),maxIterations=12):TaskRecord{
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id)||!ownerUid||ownerUid.length>128||!objective.trim()||objective.length>1200)throw Error('Invalid task identity or objective');
 return {schemaVersion:1,id,ownerUid,objective:objective.trim(),status:'queued',phase:'discovery',
  createdAt:now,updatedAt:now,deadlineAt:now+3_600_000,iteration:0,maxIterations:Number.isInteger(maxIterations)?Math.min(Math.max(maxIterations,1),80):12,
  failureCount:0,nextRunAt:now,memory:emptyTaskMemory()};
}
