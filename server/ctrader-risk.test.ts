import {describe,it,expect} from 'vitest';
import {computeCTraderRisk,cTraderProtectionValid} from './ctrader-risk';
const good={balance:1000,equity:1000,freeMargin:900,quoteToDeposit:1,side:'BUY' as const,bid:3000,ask:3000.1,stop:2999,target:3004,riskPercent:0.25,maxDailyLossPercent:2,dailyStartEquity:1000,maxDrawdownPercent:5,peakEquity:1000,maxSpreadPercent:0.1,minVolume:100,maxVolume:5000,stepVolume:100,maxSlippagePrice:0.1,roundTripCommissionPerUnit:0,openPositions:0,pendingOrders:0,maxPositions:1};
describe('cTrader risk and protective checks',()=>{
 it('sizes from ask and floors to broker step',()=>{const r=computeCTraderRisk(good);expect(r.ok).toBe(true);if(r.ok){expect(r.volume).toBe(200);expect(r.riskDeposit).toBeCloseTo(2.4)}});
 it('blocks accounts which already have exposure',()=>expect(computeCTraderRisk({...good,openPositions:1}).ok).toBe(false));
 it('blocks daily-loss breach',()=>expect(computeCTraderRisk({...good,equity:975}).ok).toBe(false));
 it('blocks too-wide spread',()=>expect(computeCTraderRisk({...good,ask:3020}).ok).toBe(false));
 it('does not force minimum lot when risk too small',()=>expect(computeCTraderRisk({...good,equity:150,freeMargin:150,balance:150,dailyStartEquity:150,peakEquity:150}).ok).toBe(false));
 it('requires broker-side SL and TP',()=>{const pos={tradeData:{symbolId:'123',volume:100},price:3000,stopLoss:2999,takeProfit:3004};
  expect(cTraderProtectionValid(pos,{side:'BUY',stop:2999,target:3004,digits:2,volume:100,symbolId:'123'})).toBe(true);
  expect(cTraderProtectionValid({...pos,stopLoss:null},{side:'BUY',stop:2999,target:3004,digits:2,volume:100,symbolId:'123'})).toBe(false);
 });
});
