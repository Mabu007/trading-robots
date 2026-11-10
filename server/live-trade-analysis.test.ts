import {expect,it} from 'vitest';
import {analyzeLiveTradeLosses} from './live-trade-analysis';
const trades=[
 {id:'trade-001',symbol:'GOLDUSDC',side:'SELL',qty:0.2,entry:4100,exit:4105,pnl:-1.1,openedAt:1762780000,closedAt:1762780090,fee:.04,reason:'SL'},
 {id:'trade-002',symbol:'GOLDUSDC',side:'BUY',qty:0.2,entry:4100,exit:4090,pnl:-2,openedAt:1762780100,closedAt:1762780210,fee:.04,reason:'SL'},
 {id:'trade-003',symbol:'GOLDUSDC',side:'BUY',qty:0.2,entry:4100,exit:4120,pnl:4,openedAt:1762780300,closedAt:1762780360,fee:.04,reason:'TP'}
];
it('builds honest broker loss report and keeps unrelated account losses unattributed',()=>{
 const r=analyzeLiveTradeLosses({accountId:'prop-test',botId:'ai2',trades,now:1762781000000});
 expect(r).toMatchObject({sampleSize:3,wins:1,losses:2,reportedTotalPnl:.9,matchedRobotTradeCount:0,unmatchedAccountTrades:3,averageLoss:-1.55,brokerFees:.12});
 expect(r.recentLosingTrades[0]).toMatchObject({id:'trade-002',robotAttribution:'unattributed-account-trade'});
});
it('does not claim broker P/L is net of fees or invent losses from unread history',()=>{
 const r=analyzeLiveTradeLosses({accountId:'prop-test',botId:'ai2',trades:[]});
 expect(r).toMatchObject({sampleSize:0,reportedTotalPnl:0,losses:0,winRatePercent:null});
 expect(r.pnlMeaning).toMatch(/not verified/);
});
it('attributes a broker trade only with matching account, bot and provider position identity',()=>{
 const now=Date.now();
 const events=[{id:'exec-event-12345',time:now,accountId:'prop-test',botId:'ai2',grantId:'grant-ai2',symbol:'GOLDUSDC',
   stage:'PROTECTED_FILL',side:'SELL',positionId:'pos-1234567',intentId:'intent-1234567'}];
 const linked={...trades[0],positionId:'pos-1234567'};
 const r=analyzeLiveTradeLosses({accountId:'prop-test',botId:'ai2',trades:[linked,trades[1]],executionEvents:events,now});
 expect(r).toMatchObject({matchedRobotTradeCount:1,attributableLosses:1,unmatchedAccountTrades:1});
 const notSameBot=analyzeLiveTradeLosses({accountId:'prop-test',botId:'different',trades:[linked],executionEvents:events,now});
 expect(notSameBot.matchedRobotTradeCount).toBe(0);
});
