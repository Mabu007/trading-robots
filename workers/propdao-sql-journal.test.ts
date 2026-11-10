import {DatabaseSync} from 'node:sqlite';
import {describe,it,expect} from 'vitest';
import {PropDAOSqlJournal,reconciliationAlarm,type SqlHandle} from './propdao-sql-journal';

function fixture(){
 const db=new DatabaseSync(':memory:');
 const sql:SqlHandle={exec:(query,...bindings)=>{
  const stmt=db.prepare(query);
  if(/^\s*SELECT/i.test(query))return {toArray:()=>stmt.all(...bindings) as Record<string,unknown>[]};
  stmt.run(...bindings);return {toArray:()=>[]};
 }};
 return {db,sql,journal:new PropDAOSqlJournal(sql)};
}
const base={grantId:'grant-001',accountId:'prop-001',botId:'bot-001',time:Date.UTC(2026,10,10)};
describe('Cloudflare SQLite-backed trading journal',()=>{
 it('keeps unique broker rows after a restart of the journal instance',()=>{
  const {sql,journal,db}=fixture();
  const row={...base,kind:'trade' as const,key:'prop-001:trade-1',payload:{id:'trade-1',pnl:-2,reason:'SL'}};
  journal.put(row);journal.put(row);
  const restart=new PropDAOSqlJournal(sql);
  expect(restart.read('trade')).toHaveLength(1);
  expect(restart.pendingCount()).toBe(1);
  db.close();
 });
 it('marks only acknowledged archive rows, preserving pending rows after partial failures',()=>{
  const {journal,db}=fixture();
  journal.put({...base,kind:'event',key:'grant-001:event-1',payload:{stage:'PROTECTED_FILL'}});
  journal.put({...base,kind:'decision',key:'grant-001:decision-1',payload:{action:'WAIT'}});
  expect(journal.pending(60)).toHaveLength(2);
  journal.acknowledge([{kind:'event',key:'grant-001:event-1'}]);
  expect(journal.pendingCount()).toBe(1);
  expect(journal.read('event')[0].archived).toBe(true);
  expect(journal.read('decision')[0].archived).toBe(false);
  db.close();
 });
 it('limits outgoing transfer size and does not accept arbitrary SQL table names',()=>{
  const {journal,db}=fixture();
  for(let i=0;i<130;i++)journal.put({...base,kind:'trade',key:'t'+i,payload:{id:'t'+i,pnl:-i}});
  expect(journal.pending(60)).toHaveLength(60);
  expect(journal.pendingCount()).toBe(130);
  expect(()=>journal.put({...base,kind:'drop table tv_broker_trades' as never,key:'bad',payload:{}})).toThrow();
  db.close();
 });
});

describe('robot stop lifecycle / offline reconciliation schedule',()=>{
 it('does not schedule entries but keeps a stopped robot awake while archival is pending',()=>{
  expect(reconciliationAlarm({running:false,paused:false,pendingArchive:4,flatVerified:true,unresolvedIntent:false,now:1000})).toBe(301000);
 });
 it('continues following an open broker position after stop even if Firebase acknowledged all rows',()=>{
  expect(reconciliationAlarm({running:false,paused:false,pendingArchive:0,flatVerified:false,unresolvedIntent:false,now:1000})).toBe(301000);
 });
 it('stops polling only with flat verified exposure, no pending archive and no unresolved intent',()=>{
  expect(reconciliationAlarm({running:false,paused:false,pendingArchive:0,flatVerified:true,unresolvedIntent:false,now:1000})).toBeNull();
  expect(reconciliationAlarm({running:false,paused:false,pendingArchive:0,flatVerified:true,unresolvedIntent:true,now:1000})).not.toBeNull();
 });
 it('keeps paused robots observing and preserves regular candle alarm for running bots',()=>{
  expect(reconciliationAlarm({running:false,paused:true,pendingArchive:0,flatVerified:true,unresolvedIntent:false,now:1000})).toBe(301000);
  expect(reconciliationAlarm({running:true,paused:false,pendingArchive:0,flatVerified:false,unresolvedIntent:false,now:1000,nextTradingCandle:8000})).toBe(8000);
 });
});
