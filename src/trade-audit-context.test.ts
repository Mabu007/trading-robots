import {describe,it,expect} from 'vitest';
import {createBacktestTradeAudit} from './trade-audit-context';
import type {StrategyRun} from './strategy-workbench';

const make=():StrategyRun=>{
 const candles=Array.from({length:260},(_,i)=>({time:1720000000+i*60,open:4000,high:4001,low:3999,close:4000,volume:3}));
 const trade={id:1,side:'LONG' as const,entryTime:candles[40].time,exitTime:candles[55].time,entry:4000,exit:4001,stop:3999,target:4002,pnl:1,reason:'signal' as const};
 return {venue:'propdao',asset:'GOLDUSDC',strategyCode:'export function onCandle(ctx) {}',from:'2024-07-03',to:'2024-07-03',
   logs:[],savedAt:'2024-07-03',riskPercent:1,sparseSignals:[],result:{candles,trades:[trade],equity:[],logs:[],timeframe:'m1',source:'R2 reference',
   metrics:{trades:1,wins:1,losses:0,winRate:1,netReturn:1,profitFactor:3,maxDrawdown:0,endingBalance:1}}};
};
describe('AI trade audit uses exact saved robot and historical price context',()=>{
 it('includes strategy source, entry/exit and bounded before/during/after candles',()=>{
  const run=make(),audit=createBacktestTradeAudit(run,1);
  expect(audit).toMatchObject({source:'Saved robot backtest and exact saved strategy source',strategy:run.strategyCode,asset:'GOLDUSDC',timeframe:'m1',chartAvailable:true});
  expect(audit.contextCandles.beforeEntry).toHaveLength(30);
  expect(audit.contextCandles.duringTrade).toHaveLength(16);
  expect(audit.contextCandles.afterExit).toHaveLength(20);
  expect(audit.contextLimit).toContain('not actual broker fills');
  expect(audit.contextLimit).toContain('OHLC candles');
 });
 it('refuses nonexistent or replaced saved trades, never invents an audit',()=>{
  expect(()=>createBacktestTradeAudit(make(),8)).toThrow(/not found/);
  const run=make();run.result.candles=[];
  const audit=createBacktestTradeAudit(run,1);
  expect(audit.chartAvailable).toBe(false);
  expect(audit.contextLimit).toContain('unavailable');
 });
 it('bounds large in-trade context and explicitly says it was truncated',()=>{
  const run=make();run.result.trades[0].exitTime=run.result.candles[259].time;
  const audit=createBacktestTradeAudit(run,1);
  expect(audit.contextCandles.duringTrade.length).toBeLessThanOrEqual(181);
  expect(audit.contextLimit).toContain('Only the first 180');
 });
});

it('uses the saved candles and complete strategy source for an 18K+ strategy without fetching external history',()=>{
 const run=make();run.strategyCode='export function onCandle(ctx) {\n'+(' const volume = ctx.candle.volume;\n'.repeat(750))+' return {action:"WAIT"}; }';
 const evidence=createBacktestTradeAudit(run,1);
 expect(evidence.strategy).toBe(run.strategyCode);
 expect(evidence.strategySourceComplete).toBe(true);
 expect(evidence.evidence).toMatchObject({kind:'saved-client-simulation',savedCandles:260,attachedDuring:16,inTradeContextComplete:true,
  entryStopDistance:1,targetRAtFill:2,reportedPnlR:1});
 expect(evidence.historySource).toContain('R2');
 expect(evidence.contextLimit).not.toContain('18,000');
});

it('does not turn a long source or insufficient saved OHLC into invented independent proof',()=>{
 const run=make();run.strategyCode='x'.repeat(201000);
 run.result.candles=[];
 const evidence=createBacktestTradeAudit(run,1);
 expect(evidence.strategySourceComplete).toBe(false);
 expect(evidence.evidence.savedCandles).toBe(0);
 expect(evidence.evidence.touchSequence).toBe('not-evaluable');
 expect(evidence.contextLimit).toContain('NOT attached');
});

it('fully includes a 200,000-character source and explicitly warns at 200,001',()=>{
 const run=make();run.strategyCode='x'.repeat(200000);
 let data=createBacktestTradeAudit(run,1);
 expect(data.strategy.length).toBe(200000);
 expect(data.strategySourceComplete).toBe(true);
 run.strategyCode+='y';
 data=createBacktestTradeAudit(run,1);
 expect(data.strategy.length).toBe(200000);
 expect(data.strategySourceComplete).toBe(false);
 expect(data.codeLength).toBe(200001);
 expect(data.contextLimit).toContain('200,000');
});
