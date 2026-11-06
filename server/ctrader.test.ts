import {describe,it,expect} from 'vitest';
import {normalizeCTraderTrendbars,normalizeCTraderTicks} from './ctrader';

describe('cTrader broker trendbar normalization',()=>{
 it('converts deltas and minute timestamps to deterministic OHLCV',()=>{
  const rows=[
   {utcTimestampInMinutes:28443521,low:100000,deltaOpen:500,deltaHigh:700,deltaClose:600,volume:12},
   {utcTimestampInMinutes:28443520,low:99000,deltaOpen:400,deltaHigh:1000,deltaClose:800,volume:10},
  ];
  const out=normalizeCTraderTrendbars(rows,5);
  expect(out).toEqual([
   {time:28443520*60,open:0.994,high:1,low:0.99,close:0.998,volume:10},
   {time:28443521*60,open:1.005,high:1.007,low:1,close:1.006,volume:12}
  ]);
 });
 it('deduplicates identical bars and rejects conflicting duplicates',()=>{
  const bar={utcTimestampInMinutes:28443520,low:100000,deltaOpen:100,deltaHigh:200,deltaClose:100,volume:0};
  expect(normalizeCTraderTrendbars([bar,bar]).length).toBe(1);
  expect(()=>normalizeCTraderTrendbars([bar,{...bar,deltaClose:150}])).toThrow('Conflicting');
 });
 it('rejects corrupted range extremes',()=>{
  expect(()=>normalizeCTraderTrendbars([{utcTimestampInMinutes:28443520,low:100000,deltaOpen:200,deltaHigh:100,deltaClose:200}])).toThrow('malformed');
 });
});

describe('cTrader tick delta decoding',()=>{
 it('converts newest-first absolute plus backward time differences to ordered prices',()=>{
  const end=1700000100000;
  const out=normalizeCTraderTicks([{timestamp:end,tick:300220000},{timestamp:100,tick:300210000},
   {timestamp:200,tick:300190000}],end-1000,end+1000,2);
  expect(out).toEqual([{timeMs:end-300,price:3001.9},{timeMs:end-100,price:3002.1},{timeMs:end,price:3002.2}]);
 });
 it('rejects invalid chronology rather than fabricating prices',()=>{
  const end=1700000100000;
  expect(()=>normalizeCTraderTicks([{timestamp:end,tick:300200000},{timestamp:-1,tick:300250000}],end-1000,end+1000)).toThrow();
 });
});
