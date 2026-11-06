import {describe,it,expect,vi} from 'vitest';
import {createAgentBacktestTool,agentBacktestInputSchema} from './agent-backtest-tools.ts';

const now=Date.parse('2026-11-06T15:30:00.000Z');
const source=`export const config = { timeframes: ["m1"], executionTimeframe: "m1", riskPercent: 1, riskReward: 2 }; export function onCandle(ctx) { return {action:"WAIT"}; }`;
const call=(tool:any,botId='bot-1',lookbackCandles=120)=>tool.execute({botId,lookbackCandles},{toolCallId:'bt',messages:[],abortSignal:new AbortController().signal});
function deps(venue='hyperliquid',owner='alice'){
 const market=vi.fn(async({asset,timeframe,from,to}:any)=>{
  const start=Date.parse(from)/1000,end=Date.parse(to)/1000,rows=Array.from({length:(end-start)/60},(_,i)=>({time:start+i*60,open:100,high:101,low:99,close:100,volume:20}));
  return {source:'Hyperliquid',asset,timeframe,candles:rows,missingCandles:0,observedGaps:0};
 });
 return {readObject:vi.fn(async()=>JSON.stringify({userId:owner,botId:'bot-1',venue,code:source})),getOwnedBot:vi.fn(async()=>({id:'bot-1',userId:owner,asset:'BTC',venue})),market:{hyperliquidCandles:market},now:()=>now};
}
describe('isolated agent backtest tool',()=>{
 it('validates strict bounded inputs',()=>{
  expect(agentBacktestInputSchema.safeParse({botId:'bot-1',lookbackCandles:120}).success).toBe(true);
  expect(agentBacktestInputSchema.safeParse({botId:'../other',lookbackCandles:900}).success).toBe(false);
 });
 it('runs owner-matched Hyperliquid code in QuickJS on completed candles only',async()=>{
  const d=deps();
  const result:any=await call(createAgentBacktestTool('alice',d));
  expect(result.available).toBe(true);
  expect(result.kind).toBe('simulation');
  expect(result.tradeCount).toBe(0);
  expect(result.coverage[0].count).toBe(120);
  expect(result.metrics.netReturnUnit).toBe('R');
  expect(result).not.toHaveProperty('apiKey');
  expect(d.market.hyperliquidCandles).toHaveBeenCalledTimes(1);
 });
 it('refuses cross-user stored code',async()=>{
  const d=deps('hyperliquid','bob');
  const result:any=await call(createAgentBacktestTool('alice',d));
  expect(result.available).toBe(false);
  expect(d.market.hyperliquidCandles).not.toHaveBeenCalled();
 });
 it('refuses a PropDAO proxy market without a broker-accurate source',async()=>{
  const d=deps('propdao');
  const result:any=await call(createAgentBacktestTool('alice',d));
  expect(result.available).toBe(false);
  expect(result.reason).toContain('exact Hyperliquid');
  expect(d.market.hyperliquidCandles).not.toHaveBeenCalled();
 });
 it('refuses gaps and does not synthesize OHLC bars',async()=>{
  const d=deps();
  d.market.hyperliquidCandles=vi.fn(async({asset,timeframe,from,to}:any)=>({source:'Hyperliquid',asset,timeframe,candles:[],missingCandles:120,observedGaps:0}));
  const result:any=await call(createAgentBacktestTool('alice',d));
  expect(result.available).toBe(false);
  expect(result.reason).toContain('Incomplete');
 });
});
