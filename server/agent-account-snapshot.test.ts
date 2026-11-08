import {describe,it,expect,vi} from 'vitest';
import {accountSnapshotInputSchema,createPropDAOAccountSnapshotTool} from './agent-account-snapshot.ts';
const call=(t:any,id:string)=>t.execute({accountId:id},{toolCallId:'snapshot',messages:[],abortSignal:new AbortController().signal});
describe('owner-scoped live broker snapshot tool',()=>{
 it('requires one explicit account and rejects unsupported arguments',()=>{
  expect(accountSnapshotInputSchema.safeParse({accountId:'prop-1'}).success).toBe(true);
  expect(accountSnapshotInputSchema.safeParse({accountId:'prop-1',venue:'valr'}).success).toBe(false);
  expect(accountSnapshotInputSchema.safeParse({accountId:'../prop-2'}).success).toBe(false);
 });
 it('returns sanitized owner-verified equity, positions and pending orders',async()=>{
  const read=vi.fn(async()=>({account:{status:'active'},risk:{equity:999,balance:1000,roomUsd:40,breached:false},
   positions:[{id:'pos-1',symbol:'GOLDUSDC',side:'LONG',qty:0.1,entry:4000,privateKey:'SECRET'}],
   orders:[{orderId:'ord-2',symbol:'GOLDUSDC',side:'BUY',status:'PENDING',qty:0.2,token:'SECRET'}]}));
  const result:any=await call(createPropDAOAccountSnapshotTool('alice',read),'prop-1');
  expect(read).toHaveBeenCalledWith('alice','prop-1');
  expect(result).toMatchObject({available:true,accountId:'prop-1',exposure:'verified',openPositionCount:1,pendingOrderCount:1,equity:999});
  expect(JSON.stringify(result)).not.toContain('SECRET');
 });
 it('does not convert a broker failure into zero positions or a healthy account',async()=>{
  const read=vi.fn(async():Promise<any>=>{throw Error('provider secret credential rejected')});
  const result:any=await call(createPropDAOAccountSnapshotTool('alice',read),'prop-1');
  expect(result).toMatchObject({available:false,exposure:'unknown',openPositionCount:null,pendingOrderCount:null,positions:null,equity:null});
  expect(JSON.stringify(result)).not.toContain('provider secret');
 });
});
