import {describe,it,expect} from 'vitest';
import {applyTaskStep,initialTask} from '../shared/agent-task-state';
import {listDataCapabilities,declaredToolForCapability} from './data-capability-registry';
const t=1700000000000;
describe('durable task memory and completion gating',()=>{
 it('creates bounded state with a real deadline, scoped owner and no secrets',()=>{
  const state=initialTask('u_test','task_12345678','Build a PropDAO robot',t,20);
  expect(state).toMatchObject({ownerUid:'u_test',iteration:0,status:'queued',maxIterations:20});
  expect(state.deadlineAt-t).toBe(3600000);
 });
 it('does not accept an LLM completion claim without matching validated evidence',()=>{
  const state=initialTask('u','task_12345678','Build a PropDAO robot',t);
  const result=applyTaskStep(state,{phase:'review',summary:'It works',plan:[],facts:[],artifacts:[],next:'completed',message:'done'},t+10);
  expect(result.status).toBe('queued');
 });
 it('requires matching revision between draft and reference backtest before review',()=>{
  const state=initialTask('u','task_12345678','Build a PropDAO strategy',t);
  const step=(hash:string)=>({phase:'evaluation' as const,summary:'tested',plan:[],facts:[],artifacts:[
   {kind:'draft' as const,id:'draft_aabbcc11',codeHash:'aabb',updatedAt:'2026-11-09T10:00:00Z'},
   {kind:'backtest' as const,id:'backtest_aaccff11',codeHash:hash,quality:'reference' as const,updatedAt:'2026-11-09T10:00:00Z'}],next:'completed' as const,message:'done'});
  expect(applyTaskStep(state,step('mismatch'),t+10).status).toBe('queued');
  expect(applyTaskStep(state,step('aabb'),t+10).status).toBe('waiting_for_review');
 });
 it('caps summary and structured evidence, does not store raw chain of thought',()=>{
  const state=initialTask('u','task_12345678','How is gold doing?',t);
  const result=applyTaskStep(state,{phase:'research',summary:'x'.repeat(3000),plan:Array(100).fill('q'),facts:Array(100).fill('f'),artifacts:[],next:'completed',message:'y'.repeat(5000)},t+10);
  expect(result.status).toBe('completed');expect(result.memory.summary).toHaveLength(2500);
  expect(result.memory.plan).toHaveLength(12);expect(result.memory.facts.length).toBeLessThanOrEqual(16);
  expect(result.memory.lastResult).toHaveLength(1400);
 });
 it('registers unavailable approvals without exposing order tools as callable data',()=>{
  const capabilities=listDataCapabilities({allowReadOwner:true,allowDraft:true,allowSimulation:true});
  expect(capabilities.find(x=>x.id==='execution.review')?.available).toBe(false);
  expect(declaredToolForCapability('market.ohlcv')).toBe('readCompletedCandles');
  expect(declaredToolForCapability('made.up')).toBeNull();
 });
});
