import {describe,expect,it,vi} from 'vitest';
import {PropDAOAccounts} from './propdao-account.ts';

describe('PropDAO protected live order adapter',()=>{
 it.each(['timeout','rejected','missing-fill','protection-failed','resting-remainder'])('fails closed after %s without resubmitting',async(mode)=>{
  const saved=new Map<string,string>();let submitted=0,submittedTarget=0,submittedQuantity=0;
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
   if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
   if(url.endsWith('/markets'))return Response.json({data:[{symbol:'BTCUSDC',lotStep:0.001,maxLeverage:2}],fees:{taker:0.00045}});
   if(url.endsWith('/risk'))return Response.json({equity:1000,roomUsd:50,breached:false});
   if(init.method==='POST'){
    submittedTarget=JSON.parse(String(init.body)).tp;submittedQuantity=JSON.parse(String(init.body)).qty;
    submitted++;
    if(mode==='timeout')throw new Error('timeout');
    if(mode==='rejected')return Response.json({error:'Insufficient margin'},{status:400});
    return Response.json({status:'submitted'});
   }
   if(init.method==='PATCH')return Response.json({error:'Cannot attach protection'},{status:400});
   if(url.endsWith('/positions'))return Response.json({data:submitted&&mode!=='missing-fill'?[{id:'pos-1',symbol:'BTCUSDC',side:'BUY',qty:Math.min(0.5,submittedQuantity),slPrice:mode==='protection-failed'?null:99,tpPrice:submittedTarget}]:[]});
   if(url.endsWith('/orders'))return Response.json({data:submitted&&mode==='resting-remainder'?[{id:'ord-1',status:'PARTIALLY_FILLED'}]:[]});
   return Response.json({},{status:404});
  });
  const storage={read:async(k:string)=>saved.get(k)??null,write:async(k:string,v:string)=>{saved.set(k,v)},remove:async(k:string)=>{saved.delete(k)}};
  const accounts=new PropDAOAccounts(storage,fetcher as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));
  await accounts.connect('alice','pd_live_test');
  const postError=await accounts.executeOrder('alice','prop-1',{symbol:'BTCUSDC',side:'BUY',price:100,stop:99,target:103,leverage:1,riskUsd:2,riskReward:2,intentId:'intent-1234567890',quoteTime:Date.now()}).catch(e=>e);
  expect(postError).toBeInstanceOf(Error);
  expect(postError.notSubmitted).not.toBe(true);
  expect(submitted).toBe(1);
 });
 it('sends an idempotent order only after reading risk and validates attached bracket',async()=>{
  const stored=new Map<string,string>(),calls:string[]=[];
  const apiKey='pd_live_abcdefghijklmnopqrstuv';
  let placed=false,submittedTarget=0,submittedQuantity=0;
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
   calls.push(`${init.method||'GET'} ${url}`);
   if(url.endsWith('/markets'))return Response.json({data:[{symbol:'BTCUSDC',coin:'BTC',lotStep:0.001,maxLeverage:2}],fees:{taker:0.00045}});
   if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
   if(url.endsWith('/risk'))return Response.json({equity:1000,roomUsd:50,breached:false,floor:950});
   if(url.endsWith('/positions'))return Response.json({data:placed?[{id:'pos-1',symbol:'BTCUSDC',side:'BUY',qty:submittedQuantity,slPrice:99,tpPrice:submittedTarget}]:[]});
   if(url.endsWith('/orders')&&init.method==='POST'){const body=JSON.parse(String(init.body));expect(body).toMatchObject({symbol:'BTCUSDC',side:'BUY',orderType:'limit',tif:'gtc',sl:99,intentId:'intent-1234567890'});expect(body.qty).toBeGreaterThan(0);expect(body.limitPrice).toBeCloseTo(100.1);submittedTarget=body.tp;submittedQuantity=body.qty;expect(body.tp).toBeGreaterThan(102);placed=true;return Response.json({status:'FILLED'})}
   if(url.endsWith('/orders'))return Response.json({data:[]});
   return Response.json({error:'unknown'}, {status:404});
  });
  const storage={read:async(k:string)=>stored.get(k)??null,write:async(k:string,v:string)=>{stored.set(k,v)},remove:async(k:string)=>{stored.delete(k)}};
  const account=new PropDAOAccounts(storage,fetcher as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));
  await account.connect('alice',apiKey);
  const result=await account.executeOrder('alice','prop-1',{symbol:'BTCUSDC',side:'BUY',price:100,stop:99,target:103,leverage:1,riskUsd:2,riskReward:2,intentId:'intent-1234567890',quoteTime:Date.now()});
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
  await expect(account.executeOrder('alice','prop-1',{symbol:'BTCUSDC',side:'BUY',price:100,stop:99,target:103,leverage:1,riskUsd:2,riskReward:2,intentId:'intent-1234567890',quoteTime:Date.now()})).rejects.toMatchObject({notSubmitted:true});
  expect(posted).toBe(0);
 });
 it.each([false,true])('cancels linked GTC remainder and reconciles fill=%s before resuming',async(partialFill)=>{
  const stored=new Map<string,string>();let submitted=false,cancelled=false,deleted=0,submittedTarget=0,submittedQty=0;
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
   if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
   if(url.endsWith('/markets'))return Response.json({data:[{symbol:'BTCUSDC',lotStep:0.001,maxLeverage:2}],fees:{taker:0.00045}});
   if(url.endsWith('/risk'))return Response.json({equity:1000,roomUsd:50,breached:false});
   if(url.endsWith('/positions'))return Response.json({data:submitted&&partialFill?[{id:'pos-1',symbol:'BTCUSDC',side:'BUY',qty:Math.min(0.5,submittedQty),slPrice:99,tpPrice:submittedTarget}]:[]});
   if(url.endsWith('/orders')&&init.method==='POST'){submittedTarget=JSON.parse(String(init.body)).tp;submittedQty=JSON.parse(String(init.body)).qty;submitted=true;return Response.json({orderId:'ord-1',status:'PENDING'});}
   if(url.endsWith('/orders/ord-1')&&init.method==='DELETE'){deleted++;cancelled=true;return Response.json({status:'CANCELLED'});}
   if(url.endsWith('/orders'))return Response.json({data:submitted&&!cancelled?[{id:'ord-1',symbol:'BTCUSDC',side:'BUY',qty:1,status:partialFill?'PARTIALLY_FILLED':'PENDING'}]:[]});
   return Response.json({error:'unknown'},{status:404});
  });
  const storage={read:async(k:string)=>stored.get(k)??null,write:async(k:string,v:string)=>{stored.set(k,v)},remove:async(k:string)=>{stored.delete(k)}};
  const account=new PropDAOAccounts(storage,fetcher as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));
  await account.connect('alice','pd_live_abcdefghijklmnopqrstuv');
  const result=await account.executeOrder('alice','prop-1',{symbol:'BTCUSDC',side:'BUY',price:100,stop:99,target:103,leverage:1,riskUsd:2,riskReward:2,intentId:'intent-1234567890',quoteTime:Date.now()});
  expect(deleted).toBe(1);expect(result.filled).toBe(partialFill);
  if(partialFill){expect(result).toMatchObject({protected:true,quantity:Math.min(0.5,submittedQty),positionId:'pos-1'});}
  else expect(result).toMatchObject({protected:false,quantity:0,providerStatus:'CANCELLED_UNFILLED'});
 });

 it('enforces $2 at 1:2 on a GOLDUSDC SELL with approximately $4 net reward, not a $0.44 scalp',async()=>{
  const saved=new Map<string,string>();let placed=false,order:any;
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
   if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
   if(url.endsWith('/markets'))return Response.json({data:[{symbol:'GOLDUSDC',lotStep:0.0001,maxLeverage:5,priceStep:0.0001}],fees:{taker:0.00005}});
   if(url.endsWith('/risk'))return Response.json({equity:50000,roomUsd:1500,breached:false});
   if(url.endsWith('/positions'))return Response.json({data:placed?[{id:'pos-gold',symbol:'GOLDUSDC',side:'SELL',qty:order.qty,slPrice:order.sl,tpPrice:order.tp}]:[]});
   if(url.endsWith('/orders')&&init.method==='POST'){order=JSON.parse(String(init.body));placed=true;return Response.json({status:'FILLED'});}
   if(url.endsWith('/orders'))return Response.json({data:[]});
   return Response.json({},{status:404});
  });
  const account=new PropDAOAccounts({read:async k=>saved.get(k)??null,write:async(k,v)=>{saved.set(k,v)},remove:async k=>{saved.delete(k)}},fetcher as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));
  await account.connect('alice','pd_live_abcdefghijklmnopqrstuv');
  const result=await account.executeOrder('alice','prop-1',{symbol:'GOLDUSDC',side:'SELL',price:4098.0978,stop:4105,target:4084.2934,leverage:1,riskUsd:2,riskReward:2,intentId:'intent-1234567890',quoteTime:Date.now()});
  expect(result.plannedLoss).toBeGreaterThanOrEqual(1.8);
  expect(result.plannedLoss).toBeLessThanOrEqual(2);
  expect(result.projectedNetProfit).toBeGreaterThanOrEqual(result.plannedLoss*2-0.000001);
  expect(result.projectedNetProfit).toBeGreaterThan(3.6);
  expect(order.tp).toBeLessThan(4095.471428571428);
  expect(result.target).toBe(order.tp);
 });
 it('rejects an undersized $2 risk instead of submitting a small winner',async()=>{
  const saved=new Map<string,string>();let posted=0;
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
   if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
   if(url.endsWith('/markets'))return Response.json({data:[{symbol:'GOLDUSDC',lotStep:0.1,maxLeverage:5}],fees:{taker:0.00005}});
   if(url.endsWith('/risk'))return Response.json({equity:50000,roomUsd:1500,breached:false});
   if(url.endsWith('/positions')||url.endsWith('/orders')){if(init.method==='POST')posted++;return Response.json({data:[]})}
   return Response.json({},{status:404});
  });
  const account=new PropDAOAccounts({read:async k=>saved.get(k)??null,write:async(k,v)=>{saved.set(k,v)},remove:async k=>{saved.delete(k)}},fetcher as typeof fetch,()=>Buffer.alloc(32,4).toString('base64'));
  await account.connect('alice','pd_live_abcdefghijklmnopqrstuv');
  await expect(account.executeOrder('alice','prop-1',{symbol:'GOLDUSDC',side:'SELL',price:4098,stop:4108,target:4078,leverage:1,riskUsd:2,riskReward:2,intentId:'intent-1234567890',quoteTime:Date.now()})).rejects.toMatchObject({notSubmitted:true});
  expect(posted).toBe(0);
 });
});
