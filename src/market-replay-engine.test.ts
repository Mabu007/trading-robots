import {describe,it,expect} from 'vitest';
import {aggregateReplayBars,beginReplay,DEFAULT_REPLAY_COSTS,replayAdvance,replayClose,replayEMA,replayEnter,replayMetrics,replayModifyPosition,replayStep,replayVisibleBars,validateReplayBars,type ReplayBar} from './market-replay-engine';
const base=Date.parse('2026-11-06T08:00:00Z')/1000;
const bars:ReplayBar[]=Array.from({length:9},(_,i)=>({time:base+i*60,open:4000,high:4001,low:3999,close:4000}));
const costs={...DEFAULT_REPLAY_COSTS,spread:0,slippage:0,feePerOunce:0,leverage:20};
describe('market replay has no lookahead or broker execution',()=>{
 it('never exposes future candles or fills using a hidden bar',()=>{
  const start=beginReplay(bars,1,10000);
  expect(replayVisibleBars(bars,start).map(c=>c.time)).toEqual([base,base+60]);
  const entered=replayEnter(start,bars,'BUY',1,4,6,costs);
  expect(entered.position?.entry).toBe(4000);
  expect(entered.index).toBe(1);
  expect(entered.trades).toHaveLength(0);
  expect(replayVisibleBars(bars,entered)).toHaveLength(2);
 });
 it('requires sufficient margin, stops at a negative gap and charges fees for both sides',()=>{
  const input=[bars[0],bars[1],{time:base+120,open:3980,high:3981,low:3978,close:3979},...bars.slice(3)];
  const s=beginReplay(input,1,1000);
  expect(()=>replayEnter(s,input,'BUY',10,5,10,costs)).toThrow(/Insufficient/);
  const withFee={...costs,feePerOunce:0.3};
  const opened=replayEnter(s,input,'BUY',1,5,10,withFee);
  expect(opened.balance).toBeCloseTo(999.7);
  const closed=replayStep(opened,input,withFee);
  expect(closed.trades[0].reason).toBe('STOP');
  expect(closed.trades[0].exit).toBe(3980);
  expect(closed.trades[0].net).toBeCloseTo(-20.6);
  expect(closed.balance).toBeCloseTo(979.4);
 });
 it('assumes stop before target when both touched within one candle',()=>{
  const amb=[bars[0],bars[1],{time:base+120,open:4000,high:4020,low:3980,close:4000}];
  const s=beginReplay(amb,1,10000);
  for(const side of ['BUY','SELL'] as const){
   const out=replayStep(replayEnter(s,amb,side,1,5,10,costs),amb,costs);
   expect(out.trades).toHaveLength(1);
   expect(out.trades[0].reason).toBe('STOP');
   expect(out.trades[0].net).toBe(-5);
  }
 });
 it('honors BUY and SELL take-profit without hindsight at the current close',()=>{
  const up=[bars[0],bars[1],{time:base+120,open:4000,high:4012,low:3999,close:4010}];
  const out=replayAdvance(replayEnter(beginReplay(up,1),up,'BUY',1,5,10,costs),up,costs);
  expect(out.trades[0].reason).toBe('TARGET');expect(out.trades[0].net).toBe(10);
  const down=[bars[0],bars[1],{time:base+120,open:4000,high:4001,low:3988,close:3990}];
  const short=replayAdvance(replayEnter(beginReplay(down,1),down,'SELL',1,5,10,costs),down,costs);
  expect(short.trades[0].net).toBe(10);
 });
 it('computes correct metrics and clean manual close on last revealed candle',()=>{
  const before=beginReplay(bars,2,10000);
  const open=replayEnter(before,bars,'BUY',1,5,10,costs);
  const closed=replayClose(open,bars,costs);
  expect(closed.position).toBeNull();expect(closed.trades[0].net).toBe(0);
  const metrics=replayMetrics(closed,bars,costs);
  expect(metrics.trades).toBe(1);expect(metrics.winRate).toBe(0);expect(metrics.returnPercent).toBe(0);
 });
 it('uses Dukascopy bid as the chart price and charges spread when buying at estimated ask',()=>{
  const sample=[bars[0],bars[1],{time:base+120,open:4000,high:4001,low:3999,close:4000}];
  const spreadCosts={...costs,spread:0.6,slippage:0.1,feePerOunce:0.05};
  const long=replayEnter(beginReplay(sample,1),sample,'BUY',2,5,10,spreadCosts);
  expect(long.position?.entry).toBeCloseTo(4000.7);
  const completed=replayClose(long,sample,spreadCosts);
  expect(completed.trades[0].exit).toBeCloseTo(3999.9);
  expect(completed.trades[0].net).toBeCloseTo(-1.8);
  const short=replayEnter(beginReplay(sample,1),sample,'SELL',2,5,10,spreadCosts);
  expect(short.position?.entry).toBeCloseTo(3999.9);
  expect(replayClose(short,sample,spreadCosts).trades[0].exit).toBeCloseTo(4000.7);
 });

 it('only modifies protection using currently revealed prices, without retroactive fills',()=>{
  const nextBar={time:base+120,open:4000,high:4004,low:3998,close:4003};
  const input=[bars[0],bars[1],nextBar,bars[3]];
  const opened=replayEnter(beginReplay(input,1,10000),input,'BUY',1,8,12,costs);
  const revealed=replayStep(opened,input,costs);
  expect(revealed.position).not.toBeNull();
  const modified=replayModifyPosition(revealed,input,costs,4000,4012);
  expect(modified.position).toMatchObject({stop:4000,target:4012});
  expect(modified.trades).toHaveLength(0);
  expect(()=>replayModifyPosition(revealed,input,costs,4004,4012)).toThrow(/stop below/);
  expect(()=>replayModifyPosition(beginReplay(input,1),input,costs,4000,4010)).toThrow(/No open position/);
 });
 it('supports indicator overlays and aggregated chart data from visible candles only',()=>{
  const revealed=replayVisibleBars(bars,beginReplay(bars,6));
  const aggregated=aggregateReplayBars(revealed,5);
  expect(aggregated.length).toBeLessThan(revealed.length);
  expect(Math.max(...aggregated.map(x=>x.time))).toBeLessThanOrEqual(revealed.at(-1)!.time);
  expect(replayEMA(revealed,3)).toHaveLength(5);
 });
 it('rejects out-of-order and invalid raw history',()=>{
  expect(()=>validateReplayBars([...bars].reverse())).toThrow();
  expect(()=>beginReplay(bars,99)).toThrow();
 });
});
