import {describe,expect,it,vi} from 'vitest';
import {PropDAOAccounts} from './propdao-account.ts';

describe('PropDAO protected live order adapter',()=>{
 it.each(['timeout','rejected','missing-fill','protection-failed','resting-remainder'])('fails closed after %s without resubmitting',async(mode)=>{
  const saved=new Map<string,string>();let submitted=0;
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
   if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
   if(url.endsWith('/markets'))return Response.json({data:[{symbol:'BTCUSDC',lotStep:0.001,maxLeverage:2}],fees:{taker:0.00045}});
   if(url.endsWith('/risk'))return Response.json({equity:1000,roomUsd:50,breached:false});
   if(init.method==='POST'){
    submitted++;
    if(mode==='timeout')throw new Error('timeout');
    if(mode==='rejected')return Response.json({error:'Insufficient margin'},{status:400});
    return Response.json({status:'submitted'});
   }
   if(init.method==='PATCH')return Response.json({error:'Cannot attach protection'},{status:400});
   if(url.endsWith('/positions'))return Response.json({data:submitted&&mode!=='missing-fill'?[{id:'pos-1',symbol:'BTCUSDC',side:'BUY',qty:0.5,slPrice:mode==='protection-failed'?null:99,tpPrice:103}]:[]});
   if(url.endsWith('/orders'))return Response.json({data:submitted&&mode==='resting-remainder'?[{id:'ord-1',status:'PARTIALLY_FILLED'}]:[]});
   return Response.json({},{status:404});
  });
  const storage={read:async(k:string)=>saved.get(k)??null,write:async(k:string,v:string)=>{saved.set(k,v)},remove:async(k:string)=>{saved.delete(k)}};
  const accounts=new PropDAOAccounts(storage,fetcher as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));
  await accounts.connect('alice','pd_live_test');
  await expect(accounts.executeOrder('alice','prop-1',{symbol:'BTCUSDC',side:'BUY',price:100,stop:99,target:103,leverage:1,riskUsd:2,intentId:'intent-1234567890',quoteTime:Date.now()})).rejects.toThrow();
  expect(submitted).toBe(1);
 });
 it('sends an idempotent order only after reading risk and validates attached bracket',async()=>{
  const stored=new Map<string,string>(),calls:string[]=[];
  const apiKey='pd_live_abcdefghijklmnopqrstuv';
  let placed=false;
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
   calls.push(`${init.method||'GET'} ${url}`);
   if(url.endsWith('/markets'))return Response.json({data:[{symbol:'BTCUSDC',coin:'BTC',lotStep:0.001,maxLeverage:2}],fees:{taker:0.00045}});
   if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
   if(url.endsWith('/risk'))return Response.json({equity:1000,roomUsd:50,breached:false,floor:950});
   if(url.endsWith('/positions'))return Response.json({data:placed?[{id:'pos-1',symbol:'BTCUSDC',side:'BUY',qty:1,slPrice:99,tpPrice:103}]:[]});
   if(url.endsWith('/orders')&&init.method==='POST'){const body=JSON.parse(String(init.body));expect(body).toMatchObject({symbol:'BTCUSDC',side:'BUY',orderType:'limit',tif:'gtc',sl:99,tp:103,intentId:'intent-1234567890'});expect(body.qty).toBeGreaterThan(0);expect(body.limitPrice).toBeCloseTo(100.1);placed=true;return Response.json({status:'FILLED'})}
   if(url.endsWith('/orders'))return Response.json({data:[]});
   return Response.json({error:'unknown'}, {status:404});
  });
  const storage={read:async(k:string)=>stored.get(k)??null,write:async(k:string,v:string)=>{stored.set(k,v)},remove:async(k:string)=>{stored.delete(k)}};
  const account=new PropDAOAccounts(storage,fetcher as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));
  await account.connect('alice',apiKey);
  const result=await account.executeOrder('alice','prop-1',{symbol:'BTCUSDC',side:'BUY',price:100,stop:99,target:103,leverage:1,riskUsd:2,intentId:'intent-1234567890',quoteTime:Date.now()});
  expect(result.protected).toBe(true);expect(result.positionId).toBe('pos-1');
  expect(calls.some(x=>x.startsWith('POST')&&x.endsWith('/orders'))).toBe(true);
 });
 it('blocks any order if risk room is exhausted before placing it',async()=>{
  const stored=new Map<string,string>();const apiKey='pd_live_abcdefghijklmnopqrstuv';let posted=0;
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
   if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
   if(url.endsWith('/markets'))return Response.json({data:[{symbol:'BTCUSDC',lotStep:0.001,maxLeverage:2}],fees:{taker:0.00045}});
   if(url.endsWith('/risk'))return Response.json({equity:940,roomUsd:0,breached:true});
   if(url.endsWith('/positions')||url.endsWith('/orders')){if(init.method==='POST')posted++;return Response.json({data:[]})}
   return Response.json({}, {status:404});
  });
  const storage={read:async(k:string)=>stored.get(k)??null,write:async(k:string,v:string)=>{stored.set(k,v)},remove:async(k:string)=>{stored.delete(k)}};
  const account=new PropDAOAccounts(storage,fetcher as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));await account.connect('alice',apiKey);
  await expect(account.executeOrder('alice','prop-1',{symbol:'BTCUSDC',side:'BUY',price:100,stop:99,target:103,leverage:1,riskUsd:2,intentId:'intent-1234567890',quoteTime:Date.now()})).rejects.toThrow();
  expect(posted).toBe(0);
 });
 it.each([false,true])('cancels linked GTC remainder and reconciles fill=%s before resuming',async(partialFill)=>{
  const stored=new Map<string,string>();let submitted=false,cancelled=false,deleted=0;
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
   if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
   if(url.endsWith('/markets'))return Response.json({data:[{symbol:'BTCUSDC',lotStep:0.001,maxLeverage:2}],fees:{taker:0.00045}});
   if(url.endsWith('/risk'))return Response.json({equity:1000,roomUsd:50,breached:false});
   if(url.endsWith('/positions'))return Response.json({data:submitted&&partialFill?[{id:'pos-1',symbol:'BTCUSDC',side:'BUY',qty:0.5,slPrice:99,tpPrice:103}]:[]});
   if(url.endsWith('/orders')&&init.method==='POST'){submitted=true;return Response.json({orderId:'ord-1',status:'PENDING'});}
   if(url.endsWith('/orders/ord-1')&&init.method==='DELETE'){deleted++;cancelled=true;return Response.json({status:'CANCELLED'});}
   if(url.endsWith('/orders'))return Response.json({data:submitted&&!cancelled?[{id:'ord-1',symbol:'BTCUSDC',side:'BUY',qty:1,status:partialFill?'PARTIALLY_FILLED':'PENDING'}]:[]});
   return Response.json({error:'unknown'},{status:404});
  });
  const storage={read:async(k:string)=>stored.get(k)??null,write:async(k:string,v:string)=>{stored.set(k,v)},remove:async(k:string)=>{stored.delete(k)}};
  const account=new PropDAOAccounts(storage,fetcher as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));
  await account.connect('alice','pd_live_abcdefghijklmnopqrstuv');
  const result=await account.executeOrder('alice','prop-1',{symbol:'BTCUSDC',side:'BUY',price:100,stop:99,target:103,leverage:1,riskUsd:2,intentId:'intent-1234567890',quoteTime:Date.now()});
  expect(deleted).toBe(1);expect(result.filled).toBe(partialFill);
  if(partialFill){expect(result).toMatchObject({protected:true,quantity:0.5,positionId:'pos-1'});}
  else expect(result).toMatchObject({protected:false,quantity:0,providerStatus:'CANCELLED_UNFILLED'});
 });
});
