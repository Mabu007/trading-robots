import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {selectChatCard} from './chat-card-routing.ts';
import {robotCardEvidence} from './robot-context-card.ts';
import {RobotContextCard} from './components/RobotContextCard.tsx';
import {MarketContextCard} from './components/MarketContextCard.tsx';
import {TradingDeskCard} from './components/TradingDeskCard.tsx';
import type {ToolTrace} from './tool-trace.ts';
const trace=(name:string,output:unknown={}):ToolTrace=>({
 id:'tool_'+name,name,state:'completed',output});
const desk=trace('getTradingDeskToday',{available:true,closedTradesToday:2,reportedPnl:-3.42,
 matchedRobotTrades:0,probableRobotTrades:0,unattributedTrades:2});
const env=trace('discoverRunningPropDAORobots',{available:true,kind:'resolved',
 selection:{robotId:'bot-1',accountId:'prop-1',instrument:'GOLDUSDC',
 executionTimeframe:'m1',strategyCodeHash:'a'.repeat(64)},
 worker:{running:true,brokerExposureVerified:true,brokerExposure:'flat',
 lastEvaluation:{action:'WAIT',reason:'EMA mismatch',time:Date.parse('2026-11-11T10:30:00Z')}}});
describe('question-intent evidence cards',()=>{
 it('uses a robot status/attribution card even if the desk tool was also called',()=>{
  expect(selectChatCard('Why is my running robot losing?',[
   desk,env,trace('getRobotContextCard')])).toBe('robot');
  expect(selectChatCard('ai 2 robot losses and stop-out investigation',[desk,env])).toBe('robot');
 });
 it('uses the desk only for a portfolio/account-wide question',()=>{
  expect(selectChatCard('Why are we losing trades today across my accounts?',[desk])).toBe('desk');
  expect(selectChatCard('Show the entire account trading desk',[desk])).toBe('desk');
 });
 it('routes reference-market questions to market data rather than account P/L',()=>{
  expect(selectChatCard('What are the gold market conditions?',[
   trace('getCurrentMarketConditions',{available:true,close:4050})
  ])).toBe('market');
 });
 it('does not render a false technical card for public research snapshots',()=>{
  expect(selectChatCard('Latest gold macro headlines',[
   trace('getPublicMarketEvidence',{available:true,quote:{coin:'xyz:GOLD',price:4045}})
  ])).toBe('none');
 });
 it('leaves chat source reviews to the existing approval card',()=>{
  expect(selectChatCard('Fix its SL and let me review',[
   desk,env,trace('proposeStrategySourceEdit',{reviewRequired:true})
  ])).toBe('none');
 });
 it('does not invent a card from a tool request that has not completed',()=>{
  expect(selectChatCard('My robot loses',[
   {id:'pending',name:'getRobotContextCard',state:'requested'}
  ])).toBe('none');
 });
});
describe('robot cards cannot turn unknown account trades into robot performance',()=>{
 it('shows broker-linked counts separately from account unknown losses',()=>{
  const report=robotCardEvidence(env.output,{
   available:true,partial:true,byRobot:[{botId:'bot-1',verified:1,probable:2,pnl:-1.4}],
   recentLosses:[{accountId:'prop-1',tradeId:'t1',botId:null}]});
  expect(report).toMatchObject({robotId:'bot-1',running:'running',
   today:{verifiedTrades:1,probableTrades:2,accountRecentLossesWithoutRobotProof:1}});
  const html=renderToStaticMarkup(createElement(RobotContextCard,{report,name:'ai 2'}));
  expect(html).toContain('Robot · ai 2');
  expect(html).toContain('Verified fills linked today');
  expect(html).toContain('Probable links');
  expect(html).toContain('not verified robot losses');
  expect(html).not.toContain('Trading desk');
 });
 it('does not present missing Worker evidence as a running robot',()=>{
  const report=robotCardEvidence({kind:'unverified',
   selection:{robotId:'bot-1',accountId:'prop-1'},worker:{brokerExposureVerified:false}},null);
  expect(report).toMatchObject({running:'unverified',brokerExposure:'unknown'});
  const html=renderToStaticMarkup(createElement(RobotContextCard,{report}));
  expect(html).toContain('Runtime unverified');
  expect(html).toContain('Unknown');
 });
 it('uses distinct cards for independent market and portfolio broker reports',()=>{
  const market=renderToStaticMarkup(createElement(MarketContextCard,{
   report:{available:true,symbol:'GOLDUSDC',timeframe:'m1',close:4060,atr14:4.5}
  }));
  const broker=renderToStaticMarkup(createElement(TradingDeskCard,{
   report:{available:true,accountsChecked:2,day:'2026-11-11',matchedRobotTrades:0,
    probableRobotTrades:1,unattributedTrades:1}
  }));
  expect(market).toContain('Market · GOLDUSDC');
  expect(market).not.toContain('PropDAO trading desk');
  expect(broker).toContain('PropDAO trading desk');
  expect(broker).toContain('1 probable');
 });
});
