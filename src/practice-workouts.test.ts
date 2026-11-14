import {describe,it,expect} from 'vitest';
import {findWorkoutMoments,WORKOUTS} from './practice-workouts';
import type {ReplayBar} from './market-replay-engine';
const base=(start:number):ReplayBar[]=>Array.from({length:30},(_,i)=>({time:start+i*60,open:10,high:11,low:9,close:10}));
describe('historical workout detection',()=>{
 it('offers five distinct defined workouts',()=>{expect(new Set(WORKOUTS.map(w=>w.id)).size).toBe(5)});
 it('detects sweep and close outside the range using only completed history',()=>{
  const bars=base(1_700_000_040);bars[20]={...bars[20],high:12,close:10};bars[22]={...bars[22],high:13,close:12.5};
  expect(findWorkoutMoments(bars,'sweep')).toContain(20);
  expect(findWorkoutMoments(bars,'breakout')).toContain(22);
  expect(findWorkoutMoments(bars.slice(0,22),'sweep')).toContain(20);
 });
 it('detects rejection and expansion without treating missing candles as continuous',()=>{
  const bars=base(1_700_000_040);bars[20]={...bars[20],high:15,low:9,open:10,close:10.5};
  expect(findWorkoutMoments(bars,'rejection')).toContain(20);
  expect(findWorkoutMoments(bars,'volatility')).toContain(20);
  bars.splice(10,1);expect(findWorkoutMoments(bars,'volatility')).not.toContain(19);
 });
 it('finds the London open using daylight saving time in summer and winter',()=>{
  for(const date of ['2026-01-15T07:40:00Z','2026-07-15T06:40:00Z']){
   const bars=base(Date.parse(date)/1000);expect(findWorkoutMoments(bars,'london')).toEqual([20]);
  }
 });
});
