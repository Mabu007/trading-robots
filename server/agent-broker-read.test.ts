import {describe,it,expect,vi} from 'vitest';
import {createBrokerConnectionReadTool,brokerReadInputSchema} from './agent-broker-read.ts';
const call=(tool:any,venue='all')=>tool.execute({venue},{toolCallId:'broker',messages:[],abortSignal:new AbortController().signal});
describe('owner-bound read-only broker connection tool',()=>{
 const deps=()=>({
  propdao:vi.fn(async(uid:string)=>({connected:uid==='alice',accounts:[{accountId:'prop-1',status:'active',secret:'not-to-display'}]})),
  ctrader:vi.fn(async(uid:string)=>({connected:uid==='alice',gatewayConfigured:true,accounts:[{ctidTraderAccountId:'1234',isLive:false,brokerTitleShort:'Broker',accessToken:'private'}]})),
  valr:vi.fn(async(uid:string)=>uid==='alice'),
  now:()=>Date.parse('2026-11-06T16:00:00Z')
 });
 it('rejects arbitrary venue and broker account arguments',()=>{
  expect(brokerReadInputSchema.safeParse({venue:'all'}).success).toBe(true);
  expect(brokerReadInputSchema.safeParse({venue:'all',accountId:'target'}).success).toBe(false);
 });
 it('lists only bounded provider metadata without broker secrets',async()=>{
  const d=deps(),result:any=await call(createBrokerConnectionReadTool('alice',d));
  expect(result.available).toBe(true);
  expect(result.connections.propdao.accounts).toEqual([{accountId:'prop-1',status:'active'}]);
  expect(result.connections.ctrader.accounts).toEqual([{accountId:'1234',isLive:false,broker:'Broker'}]);
  expect(result.connections.valr.connected).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/not-to-display|accessToken|private/);
  expect(d.propdao).toHaveBeenCalledWith('alice');
 });
 it('does not claim provider readiness on failure',async()=>{
  const d=deps();d.propdao=vi.fn(async()=>{throw Error('Secret rejected')});
  const result:any=await call(createBrokerConnectionReadTool('alice',d),'propdao');
  expect(result.connections.propdao).toMatchObject({available:false,connected:null});
  expect(JSON.stringify(result)).not.toContain('Secret rejected');
  expect(d.ctrader).not.toHaveBeenCalled();
 });
});
