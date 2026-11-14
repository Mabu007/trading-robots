import {describe,it,expect} from 'vitest';
import {beginReplay,replayEnter,replayClose,DEFAULT_REPLAY_COSTS,type ReplayBar} from './market-replay-engine';
import {rebaseDaySession} from './replay-history-migration';
const bars:ReplayBar[]=Array.from({length:6},(_,i)=>({time:1700000040+i*60,open:100,high:101,low:99,close:100}));
describe('extending saved replay history',()=>{
 it('moves saved cursor and trade indices while preserving their timestamps',()=>{
  let session=replayEnter(beginReplay(bars,2),bars,'BUY',1,5,10,DEFAULT_REPLAY_COSTS);
  session=replayClose(session,bars,DEFAULT_REPLAY_COSTS);
  const result=rebaseDaySession(session,bars,90)!;
  expect(result.index).toBe(92);expect(result.trades[0].entryIndex).toBe(92);expect(result.trades[0].exitIndex).toBe(92);expect(result.trades[0].entryTime).toBe(bars[2].time);
 });
 it('refuses migration if the stored trade no longer matches historical timestamps',()=>{
  let session=replayEnter(beginReplay(bars,2),bars,'BUY',1,5,10,DEFAULT_REPLAY_COSTS);
  session=replayClose(session,bars,DEFAULT_REPLAY_COSTS);
  expect(rebaseDaySession(session,bars.filter((_,i)=>i!==1),90)).toBeNull();
 });
});
