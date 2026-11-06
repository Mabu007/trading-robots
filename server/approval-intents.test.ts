import {describe,it,expect} from 'vitest';
import {ApprovalIntents,approvalFingerprint} from './approval-intents.ts';
import type {RecordStore,RecordData} from './firestore-store.ts';
function memory(){
 const rows=new Map<string,RecordData>();let chain=Promise.resolve();
 const store:RecordStore={
  async get(k){return rows.get(k)||null},async put(k,v){rows.set(k,v)},async create(k,v){if(rows.has(k))return false;rows.set(k,v);return true},
  async query(){return []},
  async transaction(keys,update){const next=chain.then(()=>{const changes=update(keys.map(k=>rows.get(k)||null));for(const [k,v] of Object.entries(changes))rows.set(k,v)});chain=next.catch(()=>{});return next}
 };
 return store;
}
const action={operation:'order.open',connectionId:'connection-1',accountId:'account-1',venue:'propdao',instrument:'GOLDUSDC',strategyId:'bot-1',strategyVersion:'abc',parameters:{size:1,side:'BUY'},riskContext:{dailyLoss:20,maxLoss:50}} as const;
describe('durable action approval records',()=>{
 it('binds all fields, ignores object key order, and rejects changes before approval or consumption',async()=>{
  const svc=new ApprovalIntents(memory(),()=>1000,()=> '12345678-1234-4234-8234-123456789000');const v=await svc.create('alice',action);
  expect(approvalFingerprint(action)).toBe(approvalFingerprint({...action,parameters:{side:'BUY',size:1}}));
  await expect(svc.approve('alice',v.id,{...action,accountId:'other'})).rejects.toThrow();
  await expect(svc.approve('alice',v.id,{...action,connectionId:'other'})).rejects.toThrow();
  await expect(svc.approve('bob',v.id,action)).rejects.toThrow();
  await svc.approve('alice',v.id,action);
  await expect(svc.consume('alice',v.id,{...action,riskContext:{...action.riskContext,dailyLoss:21}})).rejects.toThrow();
  expect((await svc.consume('alice',v.id,action)).state).toBe('consumed');
  await expect(svc.consume('alice',v.id,action)).rejects.toThrow();
 });
 it('prevents concurrent double consumption and enforces expiry and denial',async()=>{
  let now=1000;let count=0;const svc=new ApprovalIntents(memory(),()=>now,()=>String(++count).padStart(32,'0'));
  const v=await svc.create('alice',action,1000);await svc.approve('alice',v.id,action);
  const outcomes=await Promise.allSettled([svc.consume('alice',v.id,action),svc.consume('alice',v.id,action)]);
  expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const v2=await svc.create('alice',action,1000);await svc.deny('alice',v2.id);await expect(svc.approve('alice',v2.id,action)).rejects.toThrow();
  const v3=await svc.create('alice',action,1000);now=2000;await expect(svc.approve('alice',v3.id,action)).rejects.toThrow();
 });
 it('refuses to operate without atomic storage',async()=>{
  const store=memory();delete store.transaction;await expect(new ApprovalIntents(store).create('alice',action)).rejects.toThrow('Atomic');
 });
});
