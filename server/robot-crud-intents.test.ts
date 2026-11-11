import {describe,it,expect,vi} from 'vitest';
import {RobotCrudIntents} from './robot-crud-intents.ts';
import {ApprovalIntents} from './approval-intents.ts';
import {starterCode} from '../src/strategy.ts';
import type {RecordStore,RecordData} from './firestore-store.ts';
import {createHash} from 'node:crypto';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function harness(){
 const docs=new Map<string,RecordData>(),r2=new Map<string,string>();
 const store:RecordStore={
  get:async path=>docs.get(path)||null,
  put:async(path,data)=>{docs.set(path,data)},
  create:async(path,data)=>{if(docs.has(path))return false;docs.set(path,data);return true},
  remove:async path=>{docs.delete(path)},
  query:async()=>[],
  transaction:async(paths,fn)=>{
   const updates=fn(paths.map(path=>docs.get(path)||null));
   Object.entries(updates).forEach(([path,v])=>docs.set(path,v));
  }
 };
 const guards={assertDeletable:vi.fn(async()=>{}),deleteOwned:vi.fn(async(_:string,botId:string)=>{
   const prefix='user-bots/'+Buffer.from('alice').toString('base64url')+'/'+botId+'/';
   docs.delete('users/alice/bots/'+botId);
   for(const k of [...r2.keys()])if(k.startsWith(prefix))r2.delete(k);
  })};
 const service=new RobotCrudIntents({approvals:new ApprovalIntents(store),store,
  read:async key=>r2.get(key)??null,write:async(key,s)=>{r2.set(key,s)},
  remove:async key=>{r2.delete(key)},
  withLock:async<T>(_:string,__:string,work:()=>Promise<T>):Promise<T>=>work(),...guards});
 const seed=(uid:string,botId:string,code=starterCode)=>{
  const key='user-bots/'+Buffer.from(uid).toString('base64url')+'/'+botId+'/current.json';
  docs.set('users/'+uid+'/bots/'+botId,{id:botId,ownerUid:uid,userId:uid,
   name:'Gold robot',asset:'GOLDUSDC',venue:'propdao'});
  r2.set(key,JSON.stringify({userId:uid,botId,code,venue:'propdao'}));
  return key;
 };
 return {service,store,docs,r2,guards,seed};
}
describe('owner-checked reviewed source CRUD',()=>{
 it('stages a new strategy without writing catalog or current.json; requires human approval to create',async()=>{
  const {service,docs,r2}=harness();
  const stage=await service.stageCreate('alice',{name:'Gold robot',asset:'GOLDUSDC',
   venue:'propdao',code:starterCode});
  expect(stage).toMatchObject({reviewRequired:true,operation:'strategy.create'});
  expect(docs.has('users/alice/bots/'+stage.botId)).toBe(false);
  const prefix='user-bots/'+Buffer.from('alice').toString('base64url')+'/'+stage.botId+'/current.json';
  expect(r2.has(prefix)).toBe(false);
  const review=await service.preview('alice',stage.intentId);
  expect(review.after).toBe(starterCode);
  await expect(service.apply('alice',stage.intentId)).rejects.toThrow(/pending|no longer valid/);
  await service.approve('alice',stage.intentId);
  const result=await service.apply('alice',stage.intentId);
  expect(result).toMatchObject({applied:true,operation:'strategy.create',botId:stage.botId});
  expect(docs.get('users/alice/bots/'+stage.botId)).toMatchObject({ownerUid:'alice',venue:'propdao'});
  expect(JSON.parse(r2.get(prefix)!)).toMatchObject({code:starterCode,userId:'alice'});
  await expect(service.apply('alice',stage.intentId)).rejects.toThrow(/now exists|no longer valid|review is missing/);
 });
 it('denial prevents creation and never writes robot source',async()=>{
  const {service,docs}=harness();
  const stage=await service.stageCreate('alice',{name:'Demo bot',asset:'BTCUSDC',
   venue:'propdao',code:starterCode});
  await service.deny('alice',stage.intentId);
  await expect(service.approve('alice',stage.intentId)).rejects.toThrow();
  expect(docs.has('users/alice/bots/'+stage.botId)).toBe(false);
 });
 it('does not allow a different owner to inspect, approve or apply a mutation',async()=>{
  const {service}=harness();
  const stage=await service.stageCreate('alice',{name:'Gold robot',asset:'GOLDUSDC',
   venue:'propdao',code:starterCode});
  await expect(service.preview('bob',stage.intentId)).rejects.toThrow();
  await expect(service.approve('bob',stage.intentId)).rejects.toThrow();
  await expect(service.apply('bob',stage.intentId)).rejects.toThrow();
 });
 it('rechecks live stop and source hash before approved deletion; broker trades never touched',async()=>{
  const {service,seed,docs,guards,r2}=harness();
  const key=seed('alice','bot-1');
  const stage=await service.stageDelete('alice','bot-1');
  expect(stage).toMatchObject({operation:'strategy.delete',reviewRequired:true});
  expect(await service.preview('alice',stage.intentId)).toMatchObject({before:starterCode,after:null});
  await service.approve('alice',stage.intentId);
  guards.assertDeletable.mockRejectedValueOnce(Error('Stop and reconcile live robot before deleting'));
  await expect(service.apply('alice',stage.intentId)).rejects.toThrow(/Stop and reconcile/);
  expect(docs.has('users/alice/bots/bot-1')).toBe(true);
  expect(r2.has(key)).toBe(true);
  await service.apply('alice',stage.intentId);
  expect(guards.deleteOwned).toHaveBeenCalledOnce();
  expect(docs.has('users/alice/bots/bot-1')).toBe(false);
 });
 it('rejects stale approved deletion if strategy changed after review',async()=>{
  const {service,seed,r2,guards}=harness();
  const key=seed('alice','bot-1');
  const stage=await service.stageDelete('alice','bot-1');
  await service.approve('alice',stage.intentId);
  r2.set(key,JSON.stringify({userId:'alice',botId:'bot-1',venue:'propdao',
   code:starterCode+'\n// edited after approval'}));
  await expect(service.apply('alice',stage.intentId)).rejects.toThrow(/changed/);
  expect(guards.deleteOwned).not.toHaveBeenCalled();
 });
 it('never allows deleting an unowned robot or cTrader source through this approval path',async()=>{
  const {service,seed,docs}=harness();
  seed('bob','bot-1');
  await expect(service.stageDelete('alice','bot-1')).rejects.toThrow(/unavailable/);
  seed('alice','bot-c');
  const item=docs.get('users/alice/bots/bot-c')!;
  docs.set('users/alice/bots/bot-c',{...item,venue:'ctrader'});
  await expect(service.stageDelete('alice','bot-c')).rejects.toThrow();
 });
 it('fingerprints the exact reviewed strategy before a create grant can be applied',async()=>{
  const {service,r2}=harness();
  const stage=await service.stageCreate('alice',{name:'Gold robot',asset:'GOLDUSDC',
   venue:'propdao',code:starterCode});
  const stageKey=[...r2.keys()].find(key=>key.endsWith(stage.intentId+'.json'))!;
  const original=JSON.parse(r2.get(stageKey)!);
  r2.set(stageKey,JSON.stringify({...original,code:starterCode+'\n// changed without user approval'}));
  await expect(service.preview('alice',stage.intentId)).rejects.toThrow(/changed/);
 });
});
