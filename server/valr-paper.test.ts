import { expect, it } from 'vitest';
import { processPaperCandle, validatePaperReset, type PaperState } from '../workers/valr-paper';

const risk = { allocation:1000, riskPercent:1, dailyLossPercent:3, timeframeSeconds:60 };
const spec = { baseDecimalPlaces:3, minBaseAmount:0.01, maxBaseAmount:100, minQuoteAmount:10, maxQuoteAmount:10000 };
const init = ():PaperState => ({ running:true,balance:1000,lastCandle:null,day:'',dayStartBalance:1000,pending:null,position:null,lastResult:'' });
const candle = (time:number, open=100, high=101, low=99, close=100) => ({ time,open,high,low,close,volume:1 });
const buy = { action:'BUY' as const,stopLoss:90,takeProfit:120 };
const wait = { action:'WAIT' as const };

it('queues signals for the next candle and sizes a spot paper order within allocation and risk', () => {
  const queued=processPaperCandle(init(),candle(60),buy,spec,risk);
  expect(queued.position).toBeNull();
  expect(queued.pending).toEqual({stopLoss:90,takeProfit:120});
  expect(queued.lastSignal).toMatchObject({action:'BUY',candleTime:60});
  const filled=processPaperCandle(queued,candle(120),wait,spec,risk);
  expect(filled.position?.quantity).toBe(1);
  expect(filled.balance).toBe(900);
  expect(processPaperCandle(filled,candle(120),buy,spec,risk)).toBe(filled);
  const exited=processPaperCandle(filled,candle(180,100,121,89,100),wait,spec,risk);
  expect(exited.balance).toBe(990);
  expect(exited.position).toBeNull();
  expect(exited.lastResult).toContain('stop');
});

it('cancels pending signals when stopped, continues monitoring open positions, and rejects missing candles', () => {
  const queued=processPaperCandle(init(),candle(60),buy,spec,risk);
  const stopped=processPaperCandle({...queued,running:false},candle(120),buy,spec,risk);
  expect(stopped.position).toBeNull();expect(stopped.pending).toBeNull();
  const filled=processPaperCandle(queued,candle(120),wait,spec,risk);
  const exit=processPaperCandle({...filled,running:false},candle(180,100,121,99,120),buy,spec,risk);
  expect(exit.balance).toBe(1020);expect(exit.pending).toBeNull();
  expect(()=>processPaperCandle(filled,candle(240),wait,spec,risk)).toThrow('missing candles');
});

it('rejects shorts and entries below market minimum without inventing a fill', () => {
  const short=processPaperCandle(init(),candle(60),{action:'SELL',stopLoss:110,takeProfit:80},spec,risk);
  expect(short.lastResult).toContain('unsupported');
  const queued=processPaperCandle(init(),candle(60),buy,{...spec,minQuoteAmount:200},risk);
  const skipped=processPaperCandle(queued,candle(120),wait,{...spec,minQuoteAmount:200},risk);
  expect(skipped.position).toBeNull();expect(skipped.lastResult).toContain('minimum');
});

it('limits a queued trade to the remaining daily loss budget and blocks at the limit',()=>{
  const queued=processPaperCandle(init(),candle(60),buy,spec,risk);
  const nearlyExhausted=processPaperCandle({...queued,balance:971},candle(120),wait,spec,risk);
  expect(nearlyExhausted.position?.quantity).toBe(0.1);
  const exhausted=processPaperCandle({...queued,balance:970},candle(120),wait,spec,risk);
  expect(exhausted.position).toBeNull();expect(exhausted.lastResult).toContain('Daily paper loss limit');
});

it('requires a stopped robot and explicit acknowledgement of an open simulated position before reset',()=>{
  const state=init();expect(()=>validatePaperReset(state,true)).toThrow('Stop');
  const open={...state,running:false,position:{quantity:1,entry:100,stopLoss:90,takeProfit:120}};
  expect(()=>validatePaperReset(open,false)).toThrow('Acknowledge');
  expect(()=>validatePaperReset(open,true)).not.toThrow();
});
