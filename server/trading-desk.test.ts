import {describe,it,expect,vi} from 'vitest';
import {sastDay,attributeTrade,summarizeDay,TradingDesk} from './trading-desk';
import type {RecordStore} from './firestore-store';
const now=Date.parse('2026-11-10T15:00:00Z');
const trade=(id:string,pnl:number,closedAt=now)=>({id,symbol:'GOLDUSDC',side:'SELL' as const,
 qty:0.5,entry:4100,exit:4105,pnl,openedAt:closedAt/1000-120,closedAt:closedAt/1000,
 reason:pnl<0?'SL':'TP',fee:0.04,positionId:null,intentId:null});
it('uses SAST midnight and not UTC midnight for trading-day questions',()=>{
 expect(sastDay(Date.parse('2026-11-09T22:01:00Z'))).toBe('2026-11-10');
 expect(sastDay(Date.parse('2026-11-10T21:59:59Z'))).toBe('2026-11-10');
 expect(sastDay(Date.parse('2026-11-10T22:00:00Z'))).toBe('2026-11-11');
});
it('never guesses robot attribution from a matching price, time, symbol or side',()=>{
 const event:any={id:'event-abc12345',time:now,accountId:'prop-1',botId:'bot-1',grantId:'grant-1',stage:'PROTECTED_FILL',
  symbol:'GOLDUSDC',side:'SELL',positionId:'position-1234'};
 expect(attributeTrade(trade('id1',-2),[event])).toMatchObject({botId:null,attribution:'unattributed'});
 expect(attributeTrade({...trade('id1',-2),positionId:'position-1234'},[event])).toMatchObject({botId:'bot-1',grantId:'grant-1'});
});
it('reads all owned accounts, stores broker records once and summarizes genuine daily losses',async()=>{
 const records=new Map<string,any>();
 const store={create:vi.fn(async(path:string,v:any)=>{if(records.has(path))return false;records.set(path,v);return true}),
  query:vi.fn(async()=>[...records.entries()].map(([path,value])=>({id:path.split('/').at(-1),...value}))),
  get:vi.fn(async(path:string)=>records.get(path)||null),put:vi.fn(async(path:string,v:any)=>{records.set(path,v)})} as unknown as RecordStore;
 const broker={list:async()=>({connected:true,accounts:[{accountId:'prop-1',status:'active'},{accountId:'prop-2',status:'active'}]}),
  recentTrades:async(_uid:string,accountId:string)=>accountId==='prop-1'?[trade('t1',-2),trade('t2',-1)]:
   [trade('t3',3),trade('old',-20,Date.parse('2026-11-09T18:00:00Z'))]};
 const desk=new TradingDesk(store,broker);
 const first=await desk.today('alice',now),second=await desk.today('alice',now);
 expect(first).toMatchObject({available:true,day:'2026-11-10',closedTradesToday:3,losses:2,wins:1,reportedPnl:0,unattributedTrades:3});
 expect((first as any).ledger.tradeWrites).toBe(4);expect((second as any).ledger.tradeWrites).toBe(0);
 expect(records.size).toBe(4);
 expect([...records.values()].every(t=>t.providerTradeId&&t.id===undefined)).toBe(true);
});
it('persists separate structured Worker events and filter-check snapshots',async()=>{
 const docs=new Map<string,any>();
 const store={create:vi.fn(async(path:string,v:any)=>{if(docs.has(path))return false;docs.set(path,v);return true}),
  query:vi.fn(async()=>[]),get:vi.fn(),put:vi.fn()} as unknown as RecordStore;
 const journal:any={id:'event-abc12345',time:now,accountId:'prop-1',botId:'bot-1',grantId:'grant-1',
  stage:'PROTECTED_FILL',symbol:'GOLDUSDC',side:'SELL',positionId:'position-1234'};
 const desk=new TradingDesk(store,{list:async()=>({connected:true,accounts:[{accountId:'prop-1',status:'active'}]}),
  recentTrades:async()=>[{...trade('t1',-2),positionId:'position-1234'}]},async()=>({available:true,
   events:[journal],decisionSnapshots:[{accountId:'prop-1',botId:'bot-1',grantId:'grant-1',codeHash:'code-sha',
    candleClose:1762780000,time:now,action:'WAIT',reason:'ATR below minimum',
    checks:[{name:'ATR',passed:false,actual:.6,threshold:.8,operator:'>='}]}]}));
 const r=await desk.today('alice',now),again=await desk.today('alice',now);
 expect(r).toMatchObject({matchedRobotTrades:1,unattributedTrades:0});
 expect((r as any).ledger).toMatchObject({tradeWrites:1,eventWrites:1,decisionWrites:1});
 expect((again as any).ledger.tradeWrites).toBe(0);
 expect([...docs.keys()].some(x=>x.includes('/liveRobotDecisions/'))).toBe(true);
 expect([...docs.values()].some(x=>x.codeHash==='code-sha')).toBe(true);
});
it('failed broker data is partial, never reported as a verified zero-loss day',async()=>{
 const desk=new TradingDesk(null,{list:async()=>({connected:true,accounts:[{accountId:'prop-1',status:'active'}]}),
  recentTrades:async()=>{throw Error('Provider temporarily unavailable')}});
 const r=await desk.today('alice',now);
 expect(r).toMatchObject({partial:true,closedTradesToday:0});
 expect((r as any).failedAccounts).toHaveLength(1);
});
it('disconnected accounts do not cause any broker trades call',async()=>{
 const read=vi.fn();
 const desk=new TradingDesk(null,{list:async()=>({connected:false,accounts:[]}),recentTrades:read});
 expect(await desk.today('alice',now)).toMatchObject({available:false});
 expect(read).not.toHaveBeenCalled();
});

it('accepts signed, owner-scope-checked SQL archival batches and ACKs only persisted Firestore records',async()=>{
 const {TradingDesk}=await import('./trading-desk');
 const docs=new Map<string,Record<string,unknown>>();
 const store={
  create:vi.fn(async(path:string,value:Record<string,unknown>)=>{if(docs.has(path))return false;docs.set(path,value);return true}),
  get:vi.fn(async(path:string)=>docs.get(path)||null),put:vi.fn(),query:vi.fn(async()=>[])
 } as unknown as RecordStore;
 const desk=new TradingDesk(store,{list:vi.fn(),recentTrades:vi.fn()});
 const now=Date.now(),tradeId='broker-trade-1001';
 const rows:any[]=[
  {kind:'trade',key:'prop-1:'+tradeId,grantId:'grant-old',accountId:'prop-1',botId:'bot-1',time:now,
   payload:{id:tradeId,symbol:'GOLDUSDC',side:'SELL',qty:1,entry:4000,exit:4010,pnl:-2,
    openedAt:Math.floor(now/1000)-120,closedAt:Math.floor(now/1000),reason:'SL',fee:.03}},
  {kind:'event',key:'grant-old:event_12345678',grantId:'grant-old',accountId:'prop-1',botId:'bot-1',time:now,
   payload:{id:'event_12345678',time:now,accountId:'prop-1',botId:'bot-1',grantId:'grant-old',
    symbol:'GOLDUSDC',stage:'PROTECTED_FILL',side:'SELL',positionId:'pos_12345678'}},
  {kind:'decision',key:'grant-old:1762780000',grantId:'grant-old',accountId:'prop-1',botId:'bot-1',time:now,
   payload:{accountId:'prop-1',botId:'bot-1',grantId:'grant-old',codeHash:'hash123',
    action:'WAIT',candleClose:1762780000,reason:'ATR too low',checks:[{name:'ATR',passed:false}]}}
 ];
 const first=await desk.ingestWorkerArchive('alice','bot-1','prop-1','grant-old',rows);
 const second=await desk.ingestWorkerArchive('alice','bot-1','prop-1','grant-old',rows);
 expect(first.acknowledged).toHaveLength(3);
 expect(second.acknowledged).toEqual(first.acknowledged);
 expect(docs.size).toBe(3);
 expect([...docs.keys()].every(x=>x.startsWith('users/alice/'))).toBe(true);
 expect([...docs.values()].find(v=>v.providerTradeId===tradeId)?.botId).toBeNull();
 expect([...docs.values()].find(v=>v.codeHash==='hash123')?.reason).toBe('ATR too low');
});
it('refuses corrupted cross-account archival rows before acknowledging',async()=>{
 const {TradingDesk}=await import('./trading-desk');
 const store={create:vi.fn(),get:vi.fn(),put:vi.fn(),query:vi.fn()} as unknown as RecordStore;
 const desk=new TradingDesk(store,{list:vi.fn(),recentTrades:vi.fn()});
 await expect(desk.ingestWorkerArchive('alice','bot-1','prop-1','grant-old',
  [{kind:'trade',key:'x',grantId:'grant-old',accountId:'prop-OTHER',botId:'bot-1',time:Date.now(),payload:{id:'trade-1'}}]))
  .rejects.toThrow(/cross-account/i);
 expect(store.create).not.toHaveBeenCalled();
});

it('uses SQL Durable Object broker evidence while a robot is running and defers Firestore archival',async()=>{
 const store={create:vi.fn(async()=>true),get:vi.fn(),put:vi.fn(),query:vi.fn(async()=>[])} as unknown as RecordStore;
 const broker={list:async()=>({connected:true,accounts:[{accountId:'prop-1',status:'active'}]}),
  recentTrades:async()=>{throw Error('Direct broker history temporarily unavailable')}};
 const journal=async()=>({available:true,events:[],decisionSnapshots:[],sqlLiveAvailable:true,
  sqlCoverage:[{botId:'bot-1',running:true,brokerSync:{time:now,capped:false}}],
  liveTrades:[trade('broker-01',-2)]});
 const desk=new TradingDesk(store,broker,journal);
 const response=await desk.today('alice',now);
 expect(response).toMatchObject({available:true,partial:true,closedTradesToday:1,losses:1,
  reportedPnl:-2,liveDurableObject:{activeAccounts:1,retainedBrokerTrades:1}});
 expect((response as any).ledger.tradeWrites).toBe(0);
 expect(store.create).not.toHaveBeenCalled();
});

describe('read-only broker trade inspection and historical attribution',()=>{
 it('inspects an exact live broker fill and its preserved M1 stop evidence',async()=>{
  const broker={list:async()=>({connected:true,accounts:[{accountId:'prop-1',status:'active'}]}),
   recentTrades:async()=>[{...trade('trade-exact',-2),positionId:'pos-1'}]};
  const when=now;
  const event={id:'event_111111111',time:when-120_000,accountId:'prop-1',
   botId:'bot-1',grantId:'grant-1',stage:'PROTECTED_FILL',symbol:'GOLDUSDC',
   side:'SELL',positionId:'pos-1',quantity:0.5,entryPrice:4100,stopPrice:4104,
   riskBudgetUsd:2,decisionCandleClose:(when-120_000)/1000,codeHash:'a'.repeat(64)};
  const decision={accountId:'prop-1',botId:'bot-1',grantId:'grant-1',
   candleClose:(when-120_000)/1000,codeHash:'a'.repeat(64),time:when-120_000,
   action:'SELL',reason:'Breakout',checks:[{name:'ATR',passed:true}],
   recentCandles:Array.from({length:20},(_,i)=>({time:when/1000-i*60,
    open:4100,high:4102,low:4098,close:4100})),
   executionTimeframe:'m1',marketSource:'Hyperliquid'};
  const desk=new TradingDesk(null,broker,async()=>({
   available:true,events:[event],decisionSnapshots:[decision]} as any));
  const result:any=await desk.inspect('alice','prop-1','trade-exact');
  expect(result).toMatchObject({available:true,attribution:{botId:'bot-1',
   attribution:'exact-provider-identity',confidence:'verified'},
   diagnostic:{stopDistance:4,atr14:4,stopDistanceAtr:1,
    realizedR:-1,signalReason:'Breakout',exactStrategyCodeHash:'a'.repeat(64)}});
 });
 it('refuses unauthorized accounts before reading trades or historical data',async()=>{
  const read=vi.fn();
  const desk=new TradingDesk(null,{list:async()=>({connected:true,
   accounts:[{accountId:'prop-my',status:'active'}]}),recentTrades:read});
  expect(await desk.inspect('alice','prop-notmine','trade-1'))
   .toMatchObject({available:false,reason:'Cannot verify ownership of this broker account'});
  expect(read).not.toHaveBeenCalled();
 });
 it('recovers an archived broker record after the provider read fails without fabricating live freshness',async()=>{
  const docs=new Map<string,any>();
  const key=(await import('node:crypto')).createHash('sha256')
   .update(JSON.stringify(['propdao','prop-1','trade-old'])).digest('hex').slice(0,40);
  docs.set('users/alice/liveTrades/'+key,{...trade('trade-old',-3),
   providerTradeId:'trade-old',accountId:'prop-1',id:undefined,source:'archive'});
  const store={get:vi.fn(async(path:string)=>docs.get(path)||null),put:vi.fn(),
   create:vi.fn(),query:vi.fn(async()=>[])} as unknown as RecordStore;
  const desk=new TradingDesk(store,{list:async()=>({connected:true,
   accounts:[{accountId:'prop-1',status:'active'}]}),
   recentTrades:async()=>{throw Error('upstream down')}});
  const result:any=await desk.inspect('alice','prop-1','trade-old');
  expect(result).toMatchObject({available:true,brokerFresh:false,partial:true,
   attribution:{confidence:'unknown',botId:null},
   diagnostic:{atr14:null,stopDistance:null}});
  expect(result.evidenceIssues.join(' ')).toContain('Live broker');
 });
});

it('includes older intraday broker losses from bounded pagination beyond the first 50',async()=>{
 const recent=vi.fn(async()=>[]);
 const paged=vi.fn(async()=>({trades:Array.from({length:75},(_,i)=>
  trade('older-'+i,-1)),complete:true,capped:false,pages:2,providerTotal:75}));
 const desk=new TradingDesk(null,{list:async()=>({connected:true,
  accounts:[{accountId:'prop-1',status:'active'}]}),
  recentTrades:recent,tradesSince:paged});
 const r:any=await desk.today('alice',now);
 expect(r).toMatchObject({closedTradesToday:75,losses:75,reportedPnl:-75});
 expect(paged).toHaveBeenCalledTimes(1);
 expect(recent).not.toHaveBeenCalled();
});
it('marks broker history partial when pagination is capped',async()=>{
 const desk=new TradingDesk(null,{list:async()=>({connected:true,
  accounts:[{accountId:'prop-1',status:'active'}]}),
  recentTrades:async()=>[],
  tradesSince:async()=>({trades:[trade('hist-1',-3)],complete:false,capped:true,pages:5,providerTotal:1000})});
 const r:any=await desk.today('alice',now);
 expect(r.partial).toBe(true);
 expect(r.historyCapped.join(' ')).toContain('pagination');
});
it('searches paginated history for a named old trade instead of inventing a robot match',async()=>{
 const paged=vi.fn(async()=>({trades:[trade('hist-old',-4)],
  complete:false,capped:true,pages:5,providerTotal:2000}));
 const desk=new TradingDesk(null,{list:async()=>({connected:true,
  accounts:[{accountId:'prop-1',status:'active'}]}),
  recentTrades:async()=>[],tradesSince:paged});
 const r:any=await desk.inspect('alice','prop-1','hist-old');
 expect(r).toMatchObject({available:true,brokerFresh:true,
  attribution:{botId:null,confidence:'unknown'}});
 expect(r.evidenceIssues.join(' ')).toContain('capped');
 expect(paged).toHaveBeenCalledWith('alice','prop-1',0,500);
});
it('recognizes the documented PropDAO Stop Loss reason without inventing stop tightness',()=>{
 const r:any=summarizeDay([{...trade('hist-stop',-4),reason:'Stop Loss',accountId:'prop-1',
  botId:null,attribution:'unattributed'}],'2026-11-10',
  {accountsChecked:1,failures:[],capped:[],journalWarnings:[],
   ledgerAvailable:true,writeFailures:0});
 expect(r.stopLossCount).toBe(1);
});
