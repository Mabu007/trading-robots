import {describe,it,expect} from 'vitest';
import {evaluateCandidateWindows,type CandidateWindow} from './agent-candidate-evaluation.ts';
const sha='a'.repeat(64);
const make=(from:string,toExclusive:string,id:string,overrides:Partial<CandidateWindow>={}):CandidateWindow=>({
 codeHash:sha,coin:'xyz:GOLD',venue:'propdao',reportId:'backtest_'+id.repeat(32).slice(0,32),
 from,toExclusive,tradeCount:15,worstLossR:-1.1,
 metrics:{trades:15,netReturn:4,profitFactor:1.6,maxDrawdown:3,winRate:.55},
 assumptions:{spread:.2,slippage:.15,commissionR:.03},quality:'reference',dataGaps:0,source:'Hyperliquid public candleSnapshot',
 ...overrides
});
const one=make('2026-10-30T00:00:00Z','2026-10-31T00:00:00Z','a'),two=make('2026-11-01T00:00:00Z','2026-11-02T00:00:00Z','b');
describe('independent candidate research gate',()=>{
 it('permits only research review for disjoint verified reference windows',()=>{
  const result=evaluateCandidateWindows([one,two],.25);
  expect(result.acceptedForResearchReview).toBe(true);
  expect(result.deployable).toBe(false);
  expect(result.codeHash).toBe(sha);
 });
 it('rejects matching source missing and overlap instead of trusting model claims',()=>{
  const result=evaluateCandidateWindows([one,{...two,from:'2026-10-30T12:00:00Z',quality:'reference',codeHash:'b'.repeat(64)}],.25);
  expect(result.acceptedForResearchReview).toBe(false);
  expect(result.rejectionReasons.join(' ')).toMatch(/overlap|different/);
 });
 it('rejects zero-cost fits, oversized stop loss, low sample, loss and large drawdown',()=>{
  const run=make('2026-11-01T00:00:00Z','2026-11-02T00:00:00Z','b',{
   tradeCount:2,worstLossR:-9.15,assumptions:{spread:0,slippage:0,commissionR:0},
   metrics:{trades:2,netReturn:-9,profitFactor:.4,maxDrawdown:14,winRate:.1}
  });
  const result=evaluateCandidateWindows([one,run],.5);
  expect(result.acceptedForResearchReview).toBe(false);
  expect(result.rejectionReasons.join(' ')).toMatch(/cost|Oversized|drawdown|Holdout/);
 });
 it('never certifies challenge deployment even when everything is green',()=>{
  expect(evaluateCandidateWindows([one,two],.25).deployable).toBe(false);
 });
});
