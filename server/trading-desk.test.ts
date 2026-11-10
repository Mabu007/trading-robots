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
