/** A strategy signal is not a broker trade. Worker outcomes are journalled
 * independently of PropDAO open positions, resting orders and closed history. */
export type ExecutionStage='SIGNAL'|'ENTRY_SKIPPED'|'SUBMISSION_STARTED'|'PRE_SUBMIT_REJECTED'|
 'PROTECTED_FILL'|'CANCELLED_UNFILLED'|'OUTCOME_UNKNOWN';
export type ExecutionEvent={
 id:string;time:number;accountId:string;botId:string;grantId:string;symbol:string;
 stage:ExecutionStage;side?:'BUY'|'SELL';intentId?:string;
 quantity?:number;positionId?:string;reason?:string;
};
/** A missing durable write for these transitions can leave an order without
 * an auditable causal chain. Never proceed to an order after such a failure. */
export function requiresDurableJournal(stage:ExecutionStage):boolean{
 return stage==='SIGNAL'||stage==='SUBMISSION_STARTED'||
  stage==='PROTECTED_FILL'||stage==='CANCELLED_UNFILLED';
}
export const MAX_EXECUTION_EVENTS=200;
const stages=new Set<ExecutionStage>(['SIGNAL','ENTRY_SKIPPED','SUBMISSION_STARTED',
 'PRE_SUBMIT_REJECTED','PROTECTED_FILL','CANCELLED_UNFILLED','OUTCOME_UNKNOWN']);
export function safeExecutionEvents(raw:unknown,accountId:string):ExecutionEvent[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(-MAX_EXECUTION_EVENTS).filter((v):v is ExecutionEvent=>{
  return !!v&&typeof v==='object'&&v.accountId===accountId&&
   typeof v.id==='string'&&/^[A-Za-z0-9_-]{5,140}$/.test(v.id)&&
   typeof v.time==='number'&&Number.isFinite(v.time)&&v.time>0&&v.time<=Date.now()+300000&&
   typeof v.botId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v.botId)&&
   typeof v.grantId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v.grantId)&&
   typeof v.symbol==='string'&&/^[A-Z0-9]{2,40}$/.test(v.symbol)&&
   stages.has(v.stage);
 }).map(v=>({...v,
  reason:typeof v.reason==='string'?v.reason.replace(/[\r\n\t]/g,' ').slice(0,180):undefined,
  intentId:typeof v.intentId==='string'&&/^[A-Za-z0-9_-]{8,140}$/.test(v.intentId)?v.intentId:undefined,
  side:v.side==='BUY'||v.side==='SELL'?v.side:undefined,
  quantity:typeof v.quantity==='number'&&Number.isFinite(v.quantity)&&v.quantity>=0?v.quantity:undefined,
 })).sort((a,b)=>b.time-a.time);
}
/** Older Workers expose textual events. They have no reliable bot/revision
 * identity, so label their provenance as unknown rather than guessing. */
export function oldWorkerEvents(raw:unknown,accountId:string):ExecutionEvent[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(-100).flatMap((line:string,i:number)=>{
  if(typeof line!=='string')return [];
  const m=/^(\d{4}-\d\d-\d\dT[\d:.]+Z) · (.*)$/.exec(line);
  if(!m)return [];
  const at=Date.parse(m[1]),body=m[2];
  if(!Number.isFinite(at))return [];
  const signal=/\bCandle \w+ · .* · (BUY|SELL)\b/.exec(body);
  const fill=/Protected fill (BUY|SELL) ([A-Z0-9]+)/.exec(body);
  const stage:ExecutionStage|null=fill?'PROTECTED_FILL':signal?'SIGNAL':
   body.includes('Unfilled entry cancelled')?'CANCELLED_UNFILLED':
   body.includes('Pre-submit validation rejected')?'PRE_SUBMIT_REJECTED':
   body.includes('Execution halted')?'OUTCOME_UNKNOWN':null;
  if(!stage)return [];
  return [{id:'legacy_'+at+'_'+i,time:at,accountId,botId:'unattributed',grantId:'legacy',
   symbol:fill?.[2]||'UNKNOWN',stage,
   side:(fill?.[1]||signal?.[1]) as 'BUY'|'SELL'|undefined,
   reason:'Older Worker log (trade not independently matched): '+body.slice(0,160)}];
 }).sort((a,b)=>b.time-a.time);
}
