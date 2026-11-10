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

it('paginates closed broker history for daily retroactive audits without changing the live 50-trade poll',async()=>{
 const store=new Map<string,string>();
 const key='pd_live_abcdefghijklmnopqrstuvwxyz123456';
 const accessed:string[]=[];
 const since=Date.parse('2026-11-10T00:00:00Z');
 const createTrade=(i:number,time:number)=>({id:'hist-'+i,symbol:'GOLDUSDC',side:'BUY',
  qty:.1,entry:4000,exit:4005,pnl:3,openedAt:time-90_000,closedAt:time,
  reason:'Take Profit',fee:.1});
 const sample=[...Array.from({length:100},(_,i)=>createTrade(i,since+3600_000+i*1000)),
  ...Array.from({length:100},(_,i)=>createTrade(i+100,since-3600_000-i*1000))];
 const request=vi.fn(async(url:string)=>{
  accessed.push(url);
  if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
  if(url.includes('/trades?')){
   const u=new URL(url),size=Number(u.searchParams.get('limit')),offset=Number(u.searchParams.get('offset')||0);
   return Response.json({data:sample.slice(offset,offset+size),total:200});
  }
  return Response.json({ok:true});
 });
 const accounts=new PropDAOAccounts({
  read:async k=>store.get(k)??null,write:async(k,v)=>{store.set(k,v)},remove:async k=>{store.delete(k)}
 },request as typeof fetch,()=>Buffer.alloc(32,8).toString('base64'));
 await accounts.connect('alice',key);
 const history=await accounts.tradesSince('alice','prop-1',since,500);
 expect(history).toMatchObject({complete:true,capped:false,pages:2,providerTotal:200});
 expect(history.trades).toHaveLength(100);
 expect(history.trades.every(t=>t.closedAt!==null&&t.closedAt>=since)).toBe(true);
 expect(await accounts.recentTrades('alice','prop-1')).toHaveLength(50);
 expect(accessed.some(url=>url.includes('trades?limit=50')&&!url.includes('offset='))).toBe(true);
});
it('labels broker pagination incomplete when max audit records are exhausted',async()=>{
 const store=new Map<string,string>(),since=Date.parse('2026-11-10T00:00:00Z');
 const request=vi.fn(async(url:string)=>{
  if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
  const data=Array.from({length:100},(_,i)=>({id:'hist-'+i,symbol:'GOLDUSDC',
   side:'BUY',qty:1,entry:100,exit:110,pnl:10,openedAt:since,closedAt:since+1000,reason:'Stop Loss',fee:.1}));
  return Response.json({data,total:1000});
 });
 const accounts=new PropDAOAccounts({
  read:async k=>store.get(k)??null,write:async(k,v)=>{store.set(k,v)},remove:async k=>{store.delete(k)}
 },request as typeof fetch,()=>Buffer.alloc(32,8).toString('base64'));
 await accounts.connect('alice','pd_live_abcdefghijklmnopqrstuvwxyz123456');
 const history=await accounts.tradesSince('alice','prop-1',since,100);
 expect(history).toMatchObject({complete:false,capped:true,providerTotal:1000,pages:1});
 expect(history.trades).toHaveLength(100);
});
