import {describe,it,expect} from 'vitest';
import {ApprovalIntents} from './approval-intents.ts';
import {ReviewedStrategyUpdates} from './strategy-approval-flow.ts';
import type {RecordStore,RecordData} from './firestore-store.ts';

const original='export const config = {timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2};export function onCandle(){return {action:"WAIT"};}';
const revised='export const config = {timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:3};export function onCandle(){return {action:"WAIT"};}';

function memory(now=()=>1000){
 const records=new Map<string,RecordData>(),objects=new Map<string,string>();let chain=Promise.resolve(),serial=Promise.resolve();
 const store:RecordStore={
  get:async key=>records.get(key)||null,
  put:async(key,v)=>{records.set(key,v)},
  create:async(key,v)=>{if(records.has(key))return false;records.set(key,v);return true},
  query:async()=>[],
  transaction:async(keys,callback)=>{const n=chain.then(()=>{const changes=callback(keys.map(k=>records.get(k)||null));for(const [k,v]of Object.entries(changes))records.set(k,v)});chain=n.catch(()=>{});return n}
 };
 const codeKey='user-bots/YWxpY2U/bot-1/current.json';
 objects.set(codeKey,JSON.stringify({userId:'alice',botId:'bot-1',code:original,venue:'propdao'}));
 const approvals=new ApprovalIntents(store,now);
 const deps={
  approvals,read:async(key:string)=>objects.get(key)||null,write:async(key:string,v:string)=>{objects.set(key,v)},
  getOwnedBot:async(uid:string,botId:string)=>uid==='alice'&&botId==='bot-1'?{id:'bot-1',userId:'alice',asset:'GOLDUSDC',venue:'propdao'}:null,
  commit:async(uid:string,botId:string,code:string,expected:string,beforeCommit:()=>Promise<void>,venue:string)=>{
   const work=serial.then(async()=>{const saved=JSON.parse(objects.get(codeKey)||'null');if(!saved||saved.userId!==uid||saved.botId!==botId||(saved.code!==expected||saved.venue!==venue))throw Error('Stale reviewed code');await beforeCommit();objects.set(codeKey,JSON.stringify({...saved,code}));return codeKey});
   serial=work.then(()=>{},()=>{});return work;
  },now
 };
 return {service:new ReviewedStrategyUpdates(deps),objects,codeKey,approvals};
}
describe('owner-bound staged strategy approval flow',()=>{
 it('cannot apply before user approval, then applies exactly once',async()=>{
  const m=memory();const stage=await m.service.stage('alice','bot-1',original,revised);
  await expect(m.service.apply('alice','bot-1',stage.intentId)).rejects.toThrow();
  await m.service.approve('alice','bot-1',stage.intentId);
  expect((await m.service.apply('alice','bot-1',stage.intentId)).applied).toBe(true);
  expect(JSON.parse(m.objects.get(m.codeKey)!).code).toBe(revised);
  await expect(m.service.apply('alice','bot-1',stage.intentId)).rejects.toThrow();
 });
 it('rejects a different user and rejects approval identity tampering',async()=>{
  const m=memory(),stage=await m.service.stage('alice','bot-1',original,revised);
  await expect(m.service.approve('bob','bot-1',stage.intentId)).rejects.toThrow();
  await expect(m.service.approve('alice','another-bot',stage.intentId)).rejects.toThrow();
 });
 it('rejects stale code after a separate edit',async()=>{
  const m=memory(),stage=await m.service.stage('alice','bot-1',original,revised);
  await m.service.approve('alice','bot-1',stage.intentId);
  m.objects.set(m.codeKey,JSON.stringify({userId:'alice',botId:'bot-1',code:original+'// changed',venue:'propdao'}));
  await expect(m.service.apply('alice','bot-1',stage.intentId)).rejects.toThrow(/Stale/);
 });
 it('refuses tampering with staged code or action fingerprint',async()=>{
  const m=memory(),stage=await m.service.stage('alice','bot-1',original,revised);
  const stageKey='user-bots/YWxpY2U/bot-1/approvals/'+stage.intentId+'.json';
  const record=JSON.parse(m.objects.get(stageKey)!);
  m.objects.set(stageKey,JSON.stringify({...record,proposedCode:revised+'// another action'}));
  await expect(m.service.approve('alice','bot-1',stage.intentId)).rejects.toThrow(/changed/);
 });
 it('rejects an expired review',async()=>{
  let time=1000;const m=memory(()=>time),stage=await m.service.stage('alice','bot-1',original,revised);
  time=122000;
  await expect(m.service.approve('alice','bot-1',stage.intentId)).rejects.toThrow(/expired/);
 });
 it('rejects denial after approval and prevents a denied action from applying',async()=>{
  const m=memory(),stage=await m.service.stage('alice','bot-1',original,revised);
  await m.service.deny('alice','bot-1',stage.intentId);
  await expect(m.service.approve('alice','bot-1',stage.intentId)).rejects.toThrow();
  await expect(m.service.apply('alice','bot-1',stage.intentId)).rejects.toThrow();
 });
 it('concurrent double execution consumes the approval once',async()=>{
  const m=memory(),stage=await m.service.stage('alice','bot-1',original,revised);
  await m.service.approve('alice','bot-1',stage.intentId);
  const results=await Promise.allSettled([m.service.apply('alice','bot-1',stage.intentId),m.service.apply('alice','bot-1',stage.intentId)]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
 });
});
