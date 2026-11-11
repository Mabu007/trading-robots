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
 expect(attributeTrade(trade('id1',-2),[event],'prop-1')).toMatchObject({botId:null,attribution:'unattributed'});
 expect(attributeTrade({...trade('id1',-2),positionId:'position-1234'},[event],'prop-1')).toMatchObject({botId:'bot-1',grantId:'grant-1'});
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

it('reconciles an archived protected fill after Worker stops, without pretending it was a live robot trade',async()=>{
 const archive:any={id:'event_12345678',accountId:'prop-1',time:now-120000,
  stage:'PROTECTED_FILL',botId:'bot-1',grantId:'grant-1',symbol:'GOLDUSDC',
  side:'SELL',quantity:.5,entryPrice:4100,filledAt:now-120000,positionId:'position-1234'};
 const store:RecordStore={
  get:async()=>null,put:async()=>{},create:async()=>true,
  query:async(path:string)=>path.endsWith('liveExecutionEvents')?[archive]:[]
 };
 const broker={list:async()=>({connected:true,accounts:[{accountId:'prop-1',status:'active'}]}),
  recentTrades:async()=>[{...trade('t1',-2),positionId:'position-1234'}]};
 const desk=new TradingDesk(store,broker);
 const report:any=await desk.today('alice',now);
 expect(report.matchedRobotTrades).toBe(1);
 expect(report.byRobot[0]).toMatchObject({botId:'bot-1',verified:1,probable:0});
 expect(report.recentLosses[0]).toMatchObject({botId:'bot-1',confidence:'verified'});
});
it('separates unique probable links from exact broker identity attribution',async()=>{
 const store:RecordStore={
  get:async()=>null,put:async()=>{},create:async()=>true,
  query:async(path:string)=>path.endsWith('liveExecutionEvents')?[{
    id:'event_12345678',time:now-120000,accountId:'prop-1',stage:'PROTECTED_FILL',
    botId:'bot-1',grantId:'grant-1',symbol:'GOLDUSDC',side:'SELL',
    quantity:.5,entryPrice:4100,filledAt:now-120000
   }]:[]
 };
 const broker={list:async()=>({connected:true,accounts:[{accountId:'prop-1',status:'active'}]}),
  recentTrades:async()=>[trade('t1',-2)]};
 const report:any=await new TradingDesk(store,broker).today('alice',now);
 expect(report.matchedRobotTrades).toBe(0);
 expect(report.probableRobotTrades).toBe(1);
 expect(report.recentLosses[0]).toMatchObject({botId:'bot-1',confidence:'probable'});
});

it('retroactively upgrades an archived broker trade when protected-fill evidence arrives later',async()=>{
 const archived={...trade('old-broker',-2),id:undefined,providerTradeId:'old-broker',
  accountId:'prop-1',localDay:'2026-11-10',botId:null,attribution:'unattributed',confidence:'unknown',
  positionId:'position-1234'};
 const recorded:Record<string,any>={};
 const store:RecordStore={
  get:async p=>p.endsWith('liveTrades')?null:archived as any,
  put:async(path,value)=>{recorded[path]=value},
  create:async()=>true,
  query:async path=>path.endsWith('liveExecutionEvents')?[{
   id:'event_12345678',time:now-120000,accountId:'prop-1',stage:'PROTECTED_FILL',
   botId:'bot-1',grantId:'grant-1',symbol:'GOLDUSDC',side:'SELL',positionId:'position-1234'
  }]:path.endsWith('liveTrades')?[archived as any]:[]
 };
 const broker={list:async()=>({connected:true,accounts:[{accountId:'prop-1',status:'active'}]}),
  recentTrades:async()=>{throw Error('Broker offline')}};
 const r:any=await new TradingDesk(store,broker).today('alice',now);
 expect(r).toMatchObject({matchedRobotTrades:1,unattributedTrades:0,partial:true});
 expect(r.recentLosses[0]).toMatchObject({botId:'bot-1',confidence:'verified'});
 expect(Object.values(recorded)).toContainEqual(expect.objectContaining({
  attribution:'exact-provider-identity',botId:'bot-1'
 }));
});
