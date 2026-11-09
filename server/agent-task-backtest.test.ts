import {describe,it,expect,vi} from 'vitest';
import {starterCode} from '../src/strategy';
import {evaluateAgentDraft} from './agent-task-backtest';
const now=Date.parse('2026-11-09T12:00:00Z');
describe('isolated durable task backtests',()=>{
 it('executes a complete strategy only against contiguous, verified source candles',async()=>{
  const periods=240,period=60_000;
  const bars=Array.from({length:periods},(_,i)=>{
   const open=100+Math.sin(i/10)*2+i*.015,close=open+Math.cos(i/7)*.08;
   return {time:(now-(periods-i)*period)/1000,open,close,high:Math.max(open,close)+.2,low:Math.min(open,close)-.2,volume:10+i%7};
  });
  const market={hyperliquidCandles:vi.fn(async()=>({source:'Hyperliquid',asset:'xyz:GOLD',timeframe:'m1',candles:bars,missingCandles:0,observedGaps:0}))};
  const result=await evaluateAgentDraft({source:starterCode,coin:'xyz:GOLD',lookbackCandles:periods,market:market as any,now});
  expect(result).toMatchObject({quality:'reference',venue:'hyperliquid-reference',coin:'xyz:GOLD'});
  expect(result.coverage[0]).toMatchObject({timeframe:'m1',count:240});
  expect(result.codeHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.limitations).toContain('no actual PropDAO broker');
  expect(market.hyperliquidCandles).toHaveBeenCalledWith(expect.objectContaining({asset:'xyz:GOLD',timeframe:'m1'}));
 });
 it('rejects candle gaps instead of inventing zero-volume bars',async()=>{
  const market={hyperliquidCandles:vi.fn(async()=>({source:'Hyperliquid',asset:'xyz:GOLD',timeframe:'m1',candles:[],missingCandles:20,observedGaps:1}))};
  await expect(evaluateAgentDraft({source:starterCode,coin:'xyz:GOLD',lookbackCandles:120,market:market as any,now})).rejects.toThrow('Missing or mismatched');
 });
});
