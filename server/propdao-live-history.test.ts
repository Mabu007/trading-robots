import {describe,it,expect} from 'vitest';
import {propDAOLiveHistoryBars,propDAOLiveHistoryStats,propDAOLiveRetryAt} from '../workers/propdao-live-history';

describe('PropDAO live strategy history',()=>{
 it('provides wider M1 and M5 warmup than the original 210 bars',()=>{
  expect(propDAOLiveHistoryBars('m1')).toBeGreaterThan(210);
  expect(propDAOLiveHistoryBars('m5')).toBeGreaterThan(210);
  expect(propDAOLiveHistoryBars('h1')).toBeGreaterThanOrEqual(210);
  expect(()=>propDAOLiveHistoryBars('m2')).toThrow('Unsupported');
 });
 it('reports full closed-candle readiness without inventing missing bars',()=>{
  const candles=Array.from({length:48},(_,i)=>({time:60+i*60}));
  const good=propDAOLiveHistoryStats('m1',candles,60+48*60);
  expect(good).toMatchObject({received:48,recentGap:false,ready:true});
  expect(propDAOLiveHistoryStats('m1',candles,60+49*60).ready).toBe(false);
  const gap=[...candles.slice(0,-1),{time:60+48*60}];
  expect(propDAOLiveHistoryStats('m1',gap,60+49*60).recentGap).toBe(true);
 });
 it('retries transient missing candles within live entry deadline only',()=>{
  const close=1000000,now=close*1000+6000;
  expect(propDAOLiveRetryAt(now,close,true)).toBe(now+8000);
  expect(propDAOLiveRetryAt(close*1000+21000,close,true)).toBe(null);
  expect(propDAOLiveRetryAt(now,close,false)).toBe(null);
 });
});
