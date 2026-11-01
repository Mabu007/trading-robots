import { expect, it, vi } from 'vitest';
import { ValrPaperRuntime } from '../workers/valr-paper-runtime';
import type { PaperState } from '../workers/valr-paper';

class Memory {
 data=new Map<string,unknown>();alarm:number|null=null;
 async get<T>(key:string){return structuredClone(this.data.get(key)) as T|undefined}
 async put(key:string,value:unknown){this.data.set(key,structuredClone(value))}
 async setAlarm(value:number){this.alarm=value}
 async deleteAlarm(){this.alarm=null}
}
const spec={baseDecimalPlaces:3,minBaseAmount:.01,maxBaseAmount:100,minQuoteAmount:10,maxQuoteAmount:10000};
const risk={allocation:1000,riskPercent:1,dailyLossPercent:3,timeframeSeconds:60};
const state:PaperState={running:false,balance:1000,lastCandle:null,day:'',dayStartBalance:1000,pending:null,position:null,lastResult:''};
const candle=(time:number)=>({time,open:100,high:101,low:99,close:100,volume:1});

it('survives recreation, does not duplicate repeated candles, and cancels pending orders on stop',async()=>{
 const storage=new Memory();const next=vi.fn(async()=>({candle:candle(60),decision:{action:'BUY' as const,stopLoss:90,takeProfit:120}}));
 const deps={now:()=>100000,next};const runtime=new ValrPaperRuntime(storage,deps);
 await runtime.deploy(state,spec,risk);await runtime.start();await runtime.alarm();
 expect((await runtime.status()).state.pending).not.toBeNull();
 const restored=new ValrPaperRuntime(storage,deps);await restored.alarm();
 expect((await restored.status()).state.pending).not.toBeNull();
 expect((await restored.status()).state.position).toBeNull();
 await restored.stop();await restored.alarm();expect((await restored.status()).state.pending).toBeNull();
 expect(storage.alarm).toBeNull();expect(next).toHaveBeenCalledTimes(2);
});

it('persists errors and retries without advancing a candle',async()=>{
 const storage=new Memory(),next=vi.fn(async()=>{throw Error('market unavailable')});const runtime=new ValrPaperRuntime(storage,{now:()=>100000,next});
 await runtime.deploy(state,spec,risk);await runtime.start();await runtime.alarm();
 const status=await runtime.status();expect(status.lastError).toBe('market unavailable');expect(status.attempts).toBe(1);expect(status.state.lastCandle).toBeNull();expect(storage.alarm).toBe(105000);
});
it('does not replay stopped-period entries when restarted',async()=>{
 const storage=new Memory();let nextTime=60;
 const runtime=new ValrPaperRuntime(storage,{now:()=>100000,next:async()=>({candle:candle(nextTime),decision:{action:'BUY',stopLoss:90,takeProfit:120}})});
 await runtime.deploy(state,spec,risk);await runtime.start();await runtime.alarm();await runtime.stop();
 nextTime=600;await runtime.start();await runtime.alarm();const resumed=await runtime.status();
 expect(resumed.state.lastCandle).toBe(600);expect(resumed.state.position).toBeNull();expect(resumed.state.pending).not.toBeNull();
});
it('discards stale pending entries when catching up after an outage',async()=>{
 const storage=new Memory();let count=0;
 const runtime=new ValrPaperRuntime(storage,{now:()=>100000,next:async()=>++count===1?{candle:candle(60),decision:{action:'BUY',stopLoss:90,takeProfit:120}}:{candle:candle(120),decision:{action:'WAIT'},discardPending:true}});
 await runtime.deploy(state,spec,risk);await runtime.start();await runtime.alarm();await runtime.alarm();const result=await runtime.status();
 expect(result.state.position).toBeNull();expect(result.state.pending).toBeNull();expect(result.state.balance).toBe(1000);
});
