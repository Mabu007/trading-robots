import {describe,it,expect} from 'vitest';
import {DemoPolicyStore,demoPolicyInput,evaluateDemoPolicy} from './agent-demo-policy';
const now=Date.parse('2026-11-09T14:00:00Z');
const input={mode:'full-demo' as const,accountId:'demo_account',instruments:['GOLDUSDC'],maxRiskUsd:.5,maxDailyLossPct:1,maxDrawdownPct:3,maxOpenPositions:1,expiresInHours:120,allowReplace:true,confirmation:'I AUTHORIZE VIBES PROPDAO DEMO AUTONOMY' as const};
const broker={simulated:true,owned:true,status:'active',breached:false,roomUsd:50};
const make=()=>{
 const records=new Map<string,any>();
 const store={
  get:async(path:string)=>records.get(path)??null,
  create:async(path:string,data:any)=>{if(records.has(path))return false;records.set(path,data);return true},
  put:async(path:string,data:any)=>{records.set(path,data)},
  query:async(path:string)=>[...records].filter(([key])=>key.startsWith(path+'/')).map(([,v])=>v),
  transaction:async(paths:string[],update:(rows:any[])=>Record<string,any>)=>{
   const changes=update(paths.map(p=>records.get(p)??null));
   for(const [key,value] of Object.entries(changes))records.set(key,value);
  }
 };
 return new DemoPolicyStore(store,()=>now);
};
describe('explicit demo-only standing authorization',()=>{
 it('requires exact confirmation and owned active simulated broker account',async()=>{
  const store=make();
  expect(()=>demoPolicyInput.parse({...input,confirmation:'approve'})).toThrow();
  await expect(store.create('owner',input,{...broker,simulated:false})).rejects.toThrow();
  await expect(store.create('owner',input,{...broker,breached:true})).rejects.toThrow();
 });
 it('binds verified scope, denies cross-account, excess risk, expired, unknown exposure and invalid instrument',async()=>{
  const store=make(),policy=await store.create('owner',input,broker);
  const safe={uid:'owner',accountId:'demo_account',instrument:'GOLDUSDC',riskUsd:.25,action:'deploy' as const,now,existingPositions:0,existingOrders:0,breached:false,exposureVerified:true};
  expect(evaluateDemoPolicy(policy,safe).allowed).toBe(true);
  for(const bad of [{accountId:'other'},{instrument:'BTCUSD'},{riskUsd:2},{now:policy.expiresAt+1},{exposureVerified:false},{existingOrders:1},{existingPositions:1}])
   expect(evaluateDemoPolicy(policy,{...safe,...bad}).allowed).toBe(false);
  await expect(store.owned('intruder',policy.id)).rejects.toThrow();
 });
 it('revocation is durable, atomic, idempotent and blocks future decisions',async()=>{
  const store=make(),policy=await store.create('owner',input,broker);
  const revoked=await store.revoke('owner',policy.id);
  expect(revoked.revokedAt).toBe(now);
  expect((await store.revoke('owner',policy.id)).revokedAt).toBe(now);
  expect(evaluateDemoPolicy(revoked,{uid:'owner',accountId:input.accountId,instrument:'GOLDUSDC',riskUsd:.1,action:'deploy',now,existingPositions:0,existingOrders:0,breached:false,exposureVerified:true}).allowed).toBe(false);
 });
 it('does not allow widening a policy by silently creating an overlapping grant',async()=>{
  const store=make();await store.create('owner',input,broker);
  await expect(store.create('owner',{...input,instruments:['BTCUSDC']},broker)).rejects.toThrow('already exists');
 });
});
