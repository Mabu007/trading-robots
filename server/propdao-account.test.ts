import { expect, it, vi } from 'vitest';
import { PropDAOAccounts } from './propdao-account.ts';

it('encrypts credentials, isolates users, and returns only a verified account snapshot',async()=>{
 const stored=new Map<string,string>();const storage={read:async(k:string)=>stored.get(k)??null,write:async(k:string,v:string)=>{stored.set(k,v)},remove:async(k:string)=>{stored.delete(k)}};
 const apiKey='pd_live_abcdefghijklmnopqrstuv';
 const request=vi.fn(async (url:string,init:RequestInit)=>{
  expect((init.headers as Record<string,string>).Authorization).toBe(`Bearer ${apiKey}`);
  if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active',challenge:{name:'Evaluation'}}]});
  if(url.endsWith('/risk'))return Response.json({equity:1000,floor:950,roomUsd:50,breached:false});
  if(url.endsWith('/positions')||url.endsWith('/orders'))return Response.json({data:[]});
  return Response.json({startingBalance:1000,stage:'Evaluation'});
 });
 const service=new PropDAOAccounts(storage,request as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));
 expect((await service.connect('alice',apiKey)).connected).toBe(true);
 expect([...stored.values()][0]).not.toContain(apiKey);
 expect((await service.list('bob')).connected).toBe(false);
 const result=await service.snapshot('alice','prop-1');expect(result.simulated).toBe(true);expect(result.executionEnabled).toBe(false);expect(result.risk.roomUsd).toBe(50);
 await expect(service.snapshot('alice','prop-2')).rejects.toThrow('not found');
 await service.disconnect('alice');expect((await service.list('alice')).connected).toBe(false);
});
