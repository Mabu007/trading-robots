import {afterEach,describe,expect,it,vi} from 'vitest';
import {hiddenReplayTradeIds,hideArchivedTrade,visibleArchivedTrades,patchSavedReplayReview} from './replay-journal';
import type {PracticeRecord} from './practice-history';
import type {ReplayTrade} from './market-replay-engine';
afterEach(()=>vi.unstubAllGlobals());
const storage=()=>{
 const records=new Map<string,string>();
 return {records,getItem:(k:string)=>records.get(k)||null,setItem:(k:string,v:string)=>{records.set(k,v)},removeItem:(k:string)=>records.delete(k)};
};
describe('replay journal retention',()=>{
 it('does not republish an archived trade review after deletion',()=>{
  const store=storage();vi.stubGlobal('localStorage',store);
  const trades=[{id:'a'},{id:'b'}] as ReplayTrade[];
  hideArchivedTrade('user','record','a');
  expect(hiddenReplayTradeIds('user','record')).toEqual(['a']);
  expect(visibleArchivedTrades('user','record',trades).map(t=>t.id)).toEqual(['b']);
  hideArchivedTrade('user','record','a');
  expect(hiddenReplayTradeIds('user','record')).toEqual(['a']);
 });
 it('mirrors progress-note edits only into the matching local replay',()=>{
  const store=storage();vi.stubGlobal('localStorage',store);
  const record={id:'attempt',asset:'XAUUSD',day:'2026-11-13'} as PracticeRecord;
  const key='trading-vibes:replay:zar:v4:user:XAUUSD:2026-11-13';
  store.setItem(key,JSON.stringify({version:4,attemptId:'attempt',annotations:{a:'old'}}));
  patchSavedReplayReview('user',record,'a','updated review');
  expect(JSON.parse(store.getItem(key)!).annotations.a).toBe('updated review');
  store.setItem(key,JSON.stringify({version:4,attemptId:'different',annotations:{a:'other'}}));
  patchSavedReplayReview('user',record,'a','should not apply');
  expect(JSON.parse(store.getItem(key)!).annotations.a).toBe('other');
 });
});
