import {it,expect} from 'vitest';
import {AlertHistory} from './alert-history';
it('validates and caches daily Dukascopy data; aggregates only complete higher-timeframe candles',async()=>{const data=new Map<string,string>();let downloads=0;const start=Date.parse('2026-11-01T00:00:00Z');const source=async()=>{downloads++;return Array.from({length:7},(_,i)=>({timestamp:start+i*60000,open:100,high:102,low:99,close:101}))};const service=new AlertHistory({read:async k=>data.get(k)||null,write:async(k,v)=>{data.set(k,v)}},source as any);const out=await service.day('2026-11-01','m5');expect(out.candles).toHaveLength(1);expect(out.missingIntervals).toBe(1433);expect((await service.day('2026-11-01','m1')).cached).toBe(true);expect(downloads).toBe(1);});
it('rejects invalid dates and never caches conflicting duplicate prices',async()=>{const start=Date.parse('2026-11-01T00:00:00Z');const service=new AlertHistory({read:async()=>null,write:async()=>{throw Error('must not write')}},async()=>[{timestamp:start,open:100,high:102,low:99,close:101},{timestamp:start,open:100,high:103,low:99,close:101}] as any);await expect(service.day('2026-02-30','m1')).rejects.toThrow();await expect(service.day('2026-11-01','m1')).rejects.toThrow(/Conflicting/);});

import {validateCandles} from '../src/strategy';
it('returns candles compatible with the existing strategy backtester without claiming real volume',async()=>{const start=Date.parse('2026-11-01T00:00:00Z');const service=new AlertHistory({read:async()=>null,write:async()=>{}},async()=>Array.from({length:5},(_,i)=>({timestamp:start+i*60000,open:100,high:102,low:99,close:101})) as any);const out=await service.day('2026-11-01','m5');expect(validateCandles(out.candles)).toHaveLength(1);expect(out.volumeAvailable).toBe(false);});

it('shares one Dukascopy minute download between concurrent replay and backtest users',async()=>{
 const store=new Map<string,string>(),start=Date.parse('2026-11-05T00:00:00Z');
 let downloads=0;
 const download=async()=>{downloads++;await new Promise(resolve=>setTimeout(resolve,20));return Array.from({length:20},(_,i)=>({timestamp:start+i*60000,open:100,high:101,low:99,close:100}))};
 const service=new AlertHistory({read:async key=>store.get(key)||null,write:async(key,value)=>{store.set(key,value)}},download as any);
 const [a,b,c]=await Promise.all([service.day('2026-11-05','m1'),service.day('2026-11-05','m5'),service.day('2026-11-05','m15')]);
 expect(downloads).toBe(1);expect(a.candles).toHaveLength(20);expect(b.candles).toHaveLength(4);expect(c.candles).toHaveLength(1);
 expect((await service.day('2026-11-05','m1')).cached).toBe(true);
 const globalKey=[...store.keys()][0];
 expect(globalKey).toMatch(/^market-alert-history\/v1\/dukascopy\/XAUUSD\/bid\/m1\/2026-11-05.json$/);
 expect(globalKey).not.toMatch(/users\//);
});
