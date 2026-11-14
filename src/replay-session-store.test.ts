import {afterEach,describe,expect,it,vi} from 'vitest';
import {beginReplay,type ReplayBar} from './market-replay-engine';
import {archiveKey,formatReplayDuration,importLegacyReplayArchives,listLocalReplayArchives,mergeReplaySummaries,readLocalReplayArchive,removeLocalReplayArchive,saveLocalReplayArchive,type ReplayArchive} from './replay-session-store';

const candles:ReplayBar[]=Array.from({length:6},(_,i)=>({time:Date.parse('2026-11-13T08:00:00Z')/1000+i*60,open:4000,high:4001,low:3999,close:4000}));
const storage=()=>{
 const entries=new Map<string,string>();
 return {entries,get length(){return entries.size},key(i:number){return [...entries.keys()][i]||null},
  getItem:(k:string)=>entries.get(k)||null,setItem:(k:string,v:string)=>{entries.set(k,v)},removeItem:(k:string)=>{entries.delete(k)}};
};
afterEach(()=>vi.unstubAllGlobals());
describe('named market replay archives',()=>{
 it('saves independent sessions on the same date and restores their exact cursor',()=>{
  vi.stubGlobal('localStorage',storage());
  const initial=beginReplay(candles,2,10000),now='2026-11-14T18:00:00.000Z';
  const sample:ReplayArchive={version:5,id:'session-a',name:'London open',asset:'XAUUSD',day:'2026-11-13',startClock:'08:00',startingBalance:10000,
   firstTimestamp:candles[0].time,lastTimestamp:candles.at(-1)!.time,firstIndex:2,session:initial,timeline:null,
   costs:{currency:'ZAR',spread:0,slippage:0,feePerOunce:0,leverage:1},
   notes:'',annotations:{},activeSeconds:3725,createdAt:now,updatedAt:now};
  saveLocalReplayArchive('user-a',sample);
  saveLocalReplayArchive('user-a',{...sample,id:'session-b',name:'NY open',session:{...initial,index:4},updatedAt:'2026-11-14T19:00:00.000Z'});
  const saved=listLocalReplayArchives('user-a');
  expect(saved.map(s=>s.name)).toEqual(['NY open','London open']);
  expect(readLocalReplayArchive('user-a','session-a')?.session.index).toBe(2);
  expect(readLocalReplayArchive('user-b','session-a')).toBeNull();
  expect(archiveKey('user-a','session-a')).not.toBe(archiveKey('user-b','session-a'));
  removeLocalReplayArchive('user-a','session-a');
  expect(listLocalReplayArchives('user-a')).toHaveLength(1);
  expect(mergeReplaySummaries(saved,[saved[0]])).toHaveLength(2);
 });
 it('migrates legacy date-only sessions without erasing or duplicating saves',()=>{
  const store=storage();vi.stubGlobal('localStorage',store);
  const legacyKey='trading-vibes:replay:zar:v4:alice:XAUUSD:2026-11-13';
  store.setItem(legacyKey,JSON.stringify({version:4,attemptId:'legacy-1',day:'2026-11-13',asset:'XAUUSD',
   firstTimestamp:candles[0].time,lastTimestamp:candles.at(-1)!.time,firstIndex:1,
   session:beginReplay(candles,1),notes:'old notes',
   costs:{currency:'ZAR',spread:0,slippage:0,feePerOunce:0,leverage:1}}));
  expect(importLegacyReplayArchives('alice')).toBe(1);
  expect(importLegacyReplayArchives('alice')).toBe(0);
  expect(readLocalReplayArchive('alice','legacy-1')?.notes).toBe('old notes');
  expect(store.getItem(legacyKey)).not.toBeNull();
 });
 it('formats real practice time, without a maximum session length',()=>{
  expect(formatReplayDuration(0)).toBe('0s');
  expect(formatReplayDuration(65)).toBe('1m 05s');
  expect(formatReplayDuration(3725)).toBe('1h 02m');
  expect(formatReplayDuration(240*3600)).toBe('240h 00m');
 });
});
