import {describe,it,expect} from 'vitest';
import {averageTrueRange,diagnoseBrokerTrade,summarizeDeterministicPerformance} from './trade-diagnostics';
import type {BrokerTradeEvidence,TradeLink} from './trade-attribution';
import type {ExecutionEvent} from '../shared/propdao-execution-journal';
const base=Date.UTC(2026,10,10);
const candles=Array.from({length:20},(_,i)=>({time:base+i*60_000,open:4045,
 high:4047,low:4043,close:4045}));
const trade:BrokerTradeEvidence={id:'trade-1',accountId:'prop-1',symbol:'GOLDUSDC',side:'SELL',
 qty:0.5,entry:4045,exit:4050,pnl:-2.5,openedAt:base/1000,closedAt:(base+360000)/1000,
 reason:'SL',fee:0.25};
const link:TradeLink={botId:'bot-1',grantId:'grant-1',attribution:'exact-provider-identity',
 confidence:'verified',evidence:['provider position'],eventId:'event-1',
 strategyCodeHash:'a'.repeat(64),decisionCandleClose:base/1000};
const event:ExecutionEvent={id:'event-1',time:base,accountId:'prop-1',botId:'bot-1',
 grantId:'grant-1',symbol:'GOLDUSDC',side:'SELL',stage:'PROTECTED_FILL',
 entryPrice:4045,stopPrice:4048,riskBudgetUsd:2,quantity:0.5,filledAt:base};
const decision={accountId:'prop-1',botId:'bot-1',grantId:'grant-1',codeHash:'a'.repeat(64),
 candleClose:base/1000,time:base,action:'SELL',reason:'Filtered breakout',checks:[{name:'ATR',passed:true}],
 executionTimeframe:'m1',marketSource:'Hyperliquid',recentCandles:candles};
describe('deterministic historical trade diagnostics',()=>{
 it('calculates true-range ATR using prior close and no future data',()=>{
  expect(averageTrueRange(candles)).toBe(4);
  expect(averageTrueRange(candles.slice(0,10))).toBeNull();
 });
 it('calculates ATR-relative stop, structure and risk without inventing cause',()=>{
  const d=diagnoseBrokerTrade(trade,link,event,decision);
  expect(d).toMatchObject({stopDistance:3,atr14:4,stopDistanceAtr:.75,
   stopPrice:4048,stopBeyondStructure:true,intendedRiskUsd:2,realizedR:-1.25,
   stopExecutionDifference:2,exactStrategyCodeHash:'a'.repeat(64)});
  expect(d.observations.join(' ')).toContain('does not establish why');
 });
 it('marks ratios unavailable with only broker-close observations',()=>{
  const d=diagnoseBrokerTrade(trade,{...link,botId:null,confidence:'unknown',
   attribution:'unattributed'},null,null);
  expect(d).toMatchObject({atr14:null,stopDistance:null,realizedR:null,
   marketEvidenceSource:null,evidenceCoverage:{entryEvent:false,atrAvailable:false}});
  expect(d.hypothesis).toContain('Insufficient');
 });
 it('never double subtracts broker fees or asserts net-profit semantics',()=>{
  const d=diagnoseBrokerTrade(trade,link,event,decision);
  expect(d.reportedPnl).toBe(-2.5);
  expect(d.brokerFee).toBe(.25);
  expect(d.brokerFeeTreatment).toContain('unverified');
 });
 it('calculates closed-trade metrics and loss streak from chronological broker P/L',()=>{
  const results=[-2,4,-3,-1,6].map((pnl,i)=>({...trade,id:'t'+i,
   pnl,closedAt:(base+i*60_000)/1000}));
  expect(summarizeDeterministicPerformance(results))
   .toMatchObject({count:5,wins:2,losses:3,profitFactor:1.666667,
    winRatePercent:40,expectancyReportedCurrencyPerTrade:.8,
    maxClosedTradeDrawdownReportedCurrency:4,maxConsecutiveLosses:2});
 });
 it('states no results honestly when there is no sampled trade',()=>{
  expect(summarizeDeterministicPerformance([])).toMatchObject({
   count:0,profitFactor:null,winRatePercent:null,expectancyReportedCurrencyPerTrade:null});
 });
});
