import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {RecordStore,RecordData} from './firestore-store.ts';

const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const finiteValue=z.union([z.string().max(500),z.number().finite(),z.boolean(),z.null()]);
export const approvalActionSchema=z.object({
 operation:z.enum(['strategy.apply','strategy.create','strategy.delete','strategy.deploy','order.open','order.modify','order.close','risk.change','app.execute']),
 connectionId:id,accountId:id,venue:z.enum(['propdao','ctrader','valr','hyperliquid','composio']),instrument:z.string().min(1).max(64),
 strategyId:id,strategyVersion:z.string().min(1).max(128),
 parameters:z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/),finiteValue),
 riskContext:z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/),finiteValue)
}).strict().refine(v=>Object.keys(v.parameters).length<=40&&Object.keys(v.riskContext).length<=40);
export type ApprovalAction=z.infer<typeof approvalActionSchema>;
type State='pending'|'approved'|'denied'|'consumed';
type Intent={ownerUid:string;id:string;state:State;action:ApprovalAction;fingerprint:string;createdAt:number;expiresAt:number;approvedAt?:number;consumedAt?:number};
function canonical(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 const item=value as Record<string,unknown>;
 return '{'+Object.keys(item).sort().map(k=>JSON.stringify(k)+':'+canonical(item[k])).join(',')+'}';
}
export function approvalFingerprint(input:unknown){const action=approvalActionSchema.parse(input);return createHash('sha256').update(canonical(action)).digest('hex')}
function path(uid:string,intentId:string){
 if(!uid||uid.length>128||!id.safeParse(intentId).success)throw Error('Invalid approval');
 return 'serverActionApprovals/'+createHash('sha256').update(uid+'\0'+intentId).digest('hex');
}
/** Storage and transitions only. A broker adapter must independently recheck
 * ownership, risk and current state at execution, and use intent ID as its
 * idempotency key. Consuming approval never submits an order. */
export class ApprovalIntents{
 private store:RecordStore;private now:()=>number;private uuid:()=>string;
 constructor(store:RecordStore,now:()=>number=Date.now,uuid:()=>string=randomUUID){this.store=store;this.now=now;this.uuid=uuid}
 async create(uid:string,input:unknown,ttlMs=120000){
  if(!this.store.transaction)throw Error('Atomic approval storage unavailable');
  if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>300000)throw Error('Invalid approval expiry');
  const action=approvalActionSchema.parse(input),at=this.now(),intentId=this.uuid().replace(/-/g,'');
  const record:Intent={ownerUid:uid,id:intentId,state:'pending',action,fingerprint:approvalFingerprint(action),createdAt:at,expiresAt:at+ttlMs};
  if(!await this.store.create(path(uid,intentId),record))throw Error('Approval already exists');
  return record;
 }
 private async transition(uid:string,intentId:string,expected:State,next:State,action?:unknown){
  if(!this.store.transaction)throw Error('Atomic approval storage unavailable');
  const ref=path(uid,intentId);let updated:Intent|undefined;
  await this.store.transaction([ref],records=>{
   const r=records[0] as Intent|null;const at=this.now();
   if(!r||r.ownerUid!==uid||r.id!==intentId||r.state!==expected||!Number.isFinite(r.expiresAt)||at>=r.expiresAt)throw Error('Approval is missing, expired or no longer valid');
   if(approvalFingerprint(r.action)!==r.fingerprint)throw Error('Approval data is invalid');
   if(action!==undefined&&approvalFingerprint(action)!==r.fingerprint)throw Error('Approval does not match this action');
   updated={...r,state:next,...(next==='approved'?{approvedAt:at}:{}),...(next==='consumed'?{consumedAt:at}:{})};
   return {[ref]:updated as unknown as RecordData};
  });
  if(!updated)throw Error('Approval transaction did not complete');return updated;
 }
 approve(uid:string,intentId:string,reviewedAction:unknown){return this.transition(uid,intentId,'pending','approved',reviewedAction)}
 deny(uid:string,intentId:string){return this.transition(uid,intentId,'pending','denied')}
 consume(uid:string,intentId:string,currentAction:unknown){return this.transition(uid,intentId,'approved','consumed',currentAction)}
}
