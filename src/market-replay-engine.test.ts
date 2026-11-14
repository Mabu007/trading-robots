import {describe,it,expect} from 'vitest';
import {aggregateReplayBars,beginReplay,DEFAULT_REPLAY_COSTS,NEW_REPLAY_COSTS,replaySessionCosts,replayAdvance,replayClose,replayEMA,replayEnter,replayMetrics,replayModifyPosition,replayStep,replayVisibleBars,validateReplayBars,type ReplayBar} from './market-replay-engine';
const base=Date.parse('2026-11-06T08:00:00Z')/1000;
const bars:ReplayBar[]=Array.from({length:9},(_,i)=>({time:base+i*60,open:4000,high:4001,low:3999,close:4000}));
const costs={...DEFAULT_REPLAY_COSTS,spread:0,slippage:0,feePerOunce:0,leverage:20};
describe('ZAR account simulation',()=>{
 it('keeps saved USD sessions in USD but starts an unsaved new date in ZAR',()=>{
  const legacy={...DEFAULT_REPLAY_COSTS,leverage:20};
  const restored=replaySessionCosts(NEW_REPLAY_COSTS,legacy);
  expect(restored.currency).toBe('USD');
  expect(restored.leverage).toBe(20);
  expect(replaySessionCosts(restored)).toMatchObject({currency:'ZAR',usdZar:18,leverage:1});
  const configured={...NEW_REPLAY_COSTS,usdZar:17.5};
  expect(replaySessionCosts(configured)).toMatchObject({currency:'ZAR',usdZar:17.5,leverage:1});
 });

 const zar={...costs,currency:'ZAR' as const,usdZar:18,leverage:1};
 it('converts USD notional, profit and fees into the persisted account currency',()=>{
  const start=beginReplay(bars,0,10000);
  const opened=replayEnter(start,bars,'BUY',0.1,5,10,zar);
  expect(replayMetrics(opened,bars,zar).equity).toBeCloseTo(10000);
  expect(()=>replayEnter(start,bars,'BUY',0.2,5,10,zar)).toThrow(/Insufficient/);
  const moved=[...bars];moved[0]={...moved[0],close:4001};
  const closed=replayClose(opened,moved,zar);
  expect(closed.balance).toBeCloseTo(10001.8);
 });
 it('does not reinterpret legacy sessions when currency is absent',()=>{
  const usd={...costs,leverage:1};
  const opened=replayEnter(beginReplay(bars,0,10000),bars,'BUY',1,5,10,usd);
  expect(opened.balance).toBe(10000);
  expect(replayMetrics(opened,bars,usd).equity).toBe(10000);
 });
});
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

describe('pending replay orders',()=>{
 it('fills on a future candle, never fills from past bars and allows cancellation',async()=>{
  const {replayPlacePending,replayCancelPending}=await import('./market-replay-engine');
  const input=[bars[0],bars[1],{time:base+120,open:4000,high:4001,low:3997,close:3999},bars[3]];
  const pending=replayPlacePending(beginReplay(input,1),input,'BUY','limit',3998,1,5,10,costs);
  expect(pending.position).toBeNull();expect(pending.index).toBe(1);
  expect(replayCancelPending(pending).pending).toBeNull();
  const filled=replayStep(pending,input,costs);
  expect(filled.position?.entry).toBe(3998);expect(filled.position?.entryIndex).toBe(2);
  expect(filled.pending).toBeNull();
 });
 it('validates side and respects worst gap fills for stop orders',async()=>{
  const {replayPlacePending}=await import('./market-replay-engine');
  const input=[bars[0],bars[1],{time:base+120,open:4010,high:4012,low:4009,close:4011},bars[3]];
  const state=beginReplay(input,1);
  expect(()=>replayPlacePending(state,input,'BUY','stop',3999,1,20,30,costs)).toThrow(/above/);
  const next=replayStep(replayPlacePending(state,input,'BUY','stop',4005,1,20,30,costs),input,costs);
  expect(next.position?.entry).toBe(4010);
 });
 it('does not award a target on the candle where an order is filled',async()=>{
  const {replayPlacePending}=await import('./market-replay-engine');
  const input=[bars[0],bars[1],{time:base+120,open:4000,high:4010,low:3998,close:4001},bars[3]];
  const next=replayStep(replayPlacePending(beginReplay(input,1),input,'BUY','limit',3999,1,10,2,costs),input,costs);
  expect(next.position).not.toBeNull();expect(next.trades).toHaveLength(0);
 });
});

describe('multiple paper positions',()=>{
 it('tracks separate positions, margin and closes only the chosen trade',async()=>{
  const {replayPositions,replayMark}=await import('./market-replay-engine');
  let state=beginReplay(bars,1,10000);
  state=replayEnter(state,bars,'BUY',1,5,10,costs);const first=state.position!;
  state=replayEnter(state,bars,'SELL',2,5,10,costs);const positions=replayPositions(state);
  expect(positions).toHaveLength(2);expect(positions[0].id).not.toBe(positions[1].id);
  expect(replayMark(state,bars[1],costs).marginUsed).toBe(600);
  state=replayClose(state,bars,costs,'MANUAL',positions[1].id);
  expect(replayPositions(state).map(p=>p.id)).toEqual([first.id]);expect(state.trades[0].id).toBe(positions[1].id);
 });
 it('accounts for used margin before accepting another order',()=>{
  let state=beginReplay(bars,1,1000);state=replayEnter(state,bars,'BUY',4,5,10,costs);
  expect(()=>replayEnter(state,bars,'BUY',2,5,10,costs)).toThrow(/Insufficient/);
 });
 it('manages and stops only the selected position, preserving older saved sessions',async()=>{
  const {replayPositions}=await import('./market-replay-engine');
  let state=replayEnter(beginReplay(bars,1),bars,'BUY',1,10,20,costs);
  const legacy={...state,positions:undefined};state=replayEnter(legacy,bars,'BUY',1,5,15,costs);
  const [first,second]=replayPositions(state);
  state=replayModifyPosition(state,bars,costs,3998,4015,second.id);
  const falling=[bars[0],bars[1],{time:base+120,open:4000,high:4001,low:3997,close:3999},...bars.slice(3)];
  state=replayStep(state,falling,costs);
  expect(state.trades.map(t=>t.id)).toEqual([second.id]);expect(replayPositions(state).map(p=>p.id)).toEqual([first.id]);
 });
});

describe('multiple positions and pending order interaction',()=>{
 it('fills a pending order alongside an open position and closes both at session end',async()=>{
  const {replayPlacePending,replayPositions}=await import('./market-replay-engine');
  const input=[bars[0],bars[1],{time:base+120,open:4000,high:4001,low:3997,close:3999},bars[3]];
  let state=replayEnter(beginReplay(input,1),input,'SELL',1,20,30,costs);
  state=replayPlacePending(state,input,'BUY','limit',3998,1,20,30,costs);
  state=replayStep(state,input,costs);expect(replayPositions(state)).toHaveLength(2);
  state=replayStep(state,input,costs);expect(replayPositions(state)).toHaveLength(0);expect(state.trades).toHaveLength(2);expect(state.trades.map(t=>t.reason)).toEqual(['SESSION_END','SESSION_END']);
 });
});

describe('extended replay history',()=>{
 it('aggregates 4H and daily candles on UTC boundaries without including future prices',()=>{
  const midnight=Date.parse('2026-11-06T00:00:00Z')/1000;
  const candles=Array.from({length:1800},(_,i)=>({time:midnight+i*60,open:100,high:102,low:99,close:101}));
  candles[1500]={...candles[1500],high:900,close:899};
  const visible=replayVisibleBars(candles,beginReplay(candles,1450));
  for(const interval of [240,1440] as const){
   const aggregated=aggregateReplayBars(visible,interval);
   expect(aggregated.every(c=>c.time%(interval*60)===0)).toBe(true);
   expect(aggregated.at(-1)?.time).toBe(midnight+86400);
   expect(Math.max(...aggregated.map(c=>c.high))).toBe(102);
  }
 });
 it('retains earlier candles across timeframes while keeping later candles hidden',()=>{
  const history=Array.from({length:4000},(_,i)=>({time:base+i*60,open:100,high:102,low:99,close:101}));
  history[3100]={...history[3100],high:900,close:899};
  const state=beginReplay(history,3000);const seen=replayVisibleBars(history,state);
  expect(seen).toHaveLength(3001);
  for(const tf of [1,5,15,60] as const){
   const aggregated=aggregateReplayBars(seen,tf);
   expect(aggregated.length).toBeGreaterThan(40);
   expect(Math.max(...aggregated.map(bar=>bar.high))).toBe(102);
  }
 });
});
