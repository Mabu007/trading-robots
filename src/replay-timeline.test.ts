import {describe,it,expect} from 'vitest';
import {beginReplay,DEFAULT_REPLAY_COSTS,replayEnter,replayClose,type ReplayBar} from './market-replay-engine';
import {newReplayTimeline,recordReplayDecision,replayTo} from './replay-timeline';
const base=Date.parse('2026-11-13T08:00:00Z')/1000;
const bars:ReplayBar[]=Array.from({length:8},(_,i)=>({time:base+i*60,open:100,high:101,low:99,close:100}));
const costs={...DEFAULT_REPLAY_COSTS,spread:0,slippage:0,feePerOunce:0};
describe('replay decision history',()=>{
 it('rewinds fills and restores the original branch until a new decision is made',()=>{
  const initial=beginReplay(bars,0),open=replayEnter(initial,bars,'BUY',1,10,10,costs);
  let timeline=recordReplayDecision(newReplayTimeline(initial),open);
  const advanced=replayTo(timeline,2,bars,costs),closed=replayClose(advanced,bars,costs);
  timeline=recordReplayDecision(timeline,closed);
  expect(replayTo(timeline,1,bars,costs).position?.side).toBe('BUY');
  expect(replayTo(timeline,2,bars,costs).trades).toHaveLength(1);
  const other=replayClose(replayTo(timeline,1,bars,costs),bars,costs);
  const branched=recordReplayDecision(timeline,other);
  expect(replayTo(branched,2,bars,costs).trades[0].exitIndex).toBe(1);
  expect(()=>replayTo(branched,-1,bars,costs)).toThrow();
 });
});
