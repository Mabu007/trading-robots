import { expect, it } from 'vitest';
import { getQuickJSWASMModule } from '@cf-wasm/quickjs/node';
import { evaluateStrategyInSandbox } from '../workers/strategy-sandbox';
import { STRATEGY_RUNTIME_SOURCE } from '../src/strategy-runtime';

const config={timeframes:['m1','m5'],executionTimeframe:'m1',riskPercent:1,riskReward:2};
const m1=Array.from({length:10},(_,i)=>({time:60*(i+1),open:100,high:101,low:99,close:100,volume:1}));
const datasets={m1,m5:[{...m1[0],time:0},{...m1[0],time:300}]};
const source=`export const config = {timeframes:['m1','m5'],executionTimeframe:'m1',riskPercent:1,riskReward:2};let calls=0;export function onCandle(ctx){calls++;return {action:'WAIT',reason:[calls,ctx.timeframes.m5.length,Date.now(),Math.random()].join(':')}}`;

it('matches the canonical strategy evaluator for completed candles and deterministic globals',async()=>{
 const quick=await getQuickJSWASMModule();
 const result=evaluateStrategyInSandbox(quick,source,datasets,config);
 const canonical=await import(`data:text/javascript;base64,${Buffer.from(STRATEGY_RUNTIME_SOURCE).toString('base64')}`);
 const oldDate=globalThis.Date,oldMath=globalThis.Math,performanceDescriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');
 try{
  const baseline=await canonical.evaluate(()=>import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`),source,structuredClone(datasets),config);
  expect(result).toEqual(baseline);
 }finally{globalThis.Date=oldDate;globalThis.Math=oldMath;if(performanceDescriptor)Object.defineProperty(globalThis,'performance',performanceDescriptor)}
});
it('has no network or host environment and interrupts a looping strategy',async()=>{
 const quick=await getQuickJSWASMModule();
 const safe=`export const config={};export function onCandle(){return {action:'WAIT',reason:typeof fetch+':'+typeof process}}`;
 const result=evaluateStrategyInSandbox(quick,safe,datasets,config) as {reason:string}[];
 expect(result[0].reason).toBe('undefined:undefined');
 const loop=`export const config={};export function onCandle(){while(true){}}`;
 expect(()=>evaluateStrategyInSandbox(quick,loop,datasets,config)).toThrow('sandbox limits');
});
