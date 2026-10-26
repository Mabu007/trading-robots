import { describe,it,expect } from 'vitest';
import { simulate } from './engine';
import { isBarComplete } from './backtest';
import { parseStrategyConfig,validateCandles } from './strategy';
import { demoBots } from './demos';
const c=(time:number,open:number,high:number,low:number,close:number)=>({time,open,high,low,close,volume:1});
const cfg=`export const config = { timeframes: ["h1", "m15"], executionTimeframe: "m15", riskPercent: 1, riskReward: 2 };\nexport function onCandle(ctx) { return { action: "WAIT" }; }`;
describe('strategy contract',()=>{
 it('parses static timeframes and rejects unsupported ones',()=>{expect(parseStrategyConfig(cfg).timeframes).toEqual(['h1','m15']);expect(()=>parseStrategyConfig(cfg.replace('"m15"','"m2"'))).toThrow(/Unsupported timeframe/)});
 it('rejects executable config expressions',()=>expect(()=>parseStrategyConfig(cfg.replace('riskPercent: 1','riskPercent: getRisk()'))).toThrow(/static JSON/));
 it('sorts candles and removes duplicate timestamps and invalid OHLC',()=>{const rows=validateCandles([c(2,2,3,1,2),c(1,1,2,0,1),c(2,7,8,6,7),c(3,4,2,1,3)]);expect(rows.map(x=>x.time)).toEqual([1,2])});
 it('reveals a higher-timeframe candle only once its close is no later than the execution close',()=>{expect(isBarComplete(3600,'h1',5400,'m15')).toBe(false);expect(isBarComplete(3600,'h1',6300,'m15')).toBe(true)});
 it('keeps serialized completion checks self-contained inside the strategy iframe',()=>{const sandboxCheck=new Function(`return (${isBarComplete.toString()})`)() as typeof isBarComplete;expect(sandboxCheck(3600,'h1',6300,'m15')).toBe(true)});
 it('validates both shipped demo strategies and their execution timeframes',()=>{expect(demoBots).toHaveLength(2);expect(parseStrategyConfig(demoBots[0].code).executionTimeframe).toBe('m15');expect(parseStrategyConfig(demoBots[1].code).executionTimeframe).toBe('m1')});
});
describe('deterministic R simulation',()=>{
 it('executes a signal at the next candle open',()=>{const out=simulate([c(1,100,101,99,100),c(2,105,106,104,105),c(3,106,107,105,106)],[{action:'BUY',stopLoss:98,takeProfit:110},{action:'WAIT'}]);expect(out.trades[0].entry).toBe(105);expect(out.trades[0].entryTime).toBe(2)});
 it('opens short positions and calculates outcomes in R',()=>{const out=simulate([c(1,100,101,99,100),c(2,100,101,99,100),c(3,100,101,95,97)],[{action:'SELL',stopLoss:102,takeProfit:96},{action:'WAIT'},{action:'WAIT'}]);expect(out.trades[0].side).toBe('SHORT');expect(out.trades[0].pnl).toBe(2)});
 it('uses the stop when stop and target both trade inside a candle',()=>{const out=simulate([c(1,100,101,99,100),c(2,100,101,99,100),c(3,100,112,97,105)],[{action:'BUY',stopLoss:98,takeProfit:110},{action:'WAIT'},{action:'WAIT'}]);expect(out.trades).toHaveLength(1);expect(out.trades[0].reason).toBe('stop');expect(out.trades[0].pnl).toBe(-1)});
 it('calculates target outcome, zero-trade stats, and repeatable metrics',()=>{const candles=[c(1,100,101,99,100),c(2,100,101,99,100),c(3,100,111,99,108)];const decisions=[{action:'BUY',stopLoss:98,takeProfit:106},{action:'WAIT'},{action:'WAIT'}];const a=simulate(candles,decisions),b=simulate(candles,decisions);expect(a.trades[0].pnl).toBe(3);expect(a.metrics).toEqual(b.metrics);expect(simulate(candles,[{action:'WAIT'}]).metrics.trades).toBe(0)});
});
