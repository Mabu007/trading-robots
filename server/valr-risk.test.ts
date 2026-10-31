import { expect,it } from 'vitest';
import { sizeValrSpotBuy } from '../shared/valr-risk';

const now=1_700_000_000_000;
const account={availableQuote:'1000',bid:'99.9',ask:'100',quoteTime:now,dayStartEquity:'1000',dailyLoss:'0',openOrders:0,openPositions:0,reconciled:true};
const spec={minBaseAmount:'0.001',maxBaseAmount:'100',minQuoteAmount:'10',maxQuoteAmount:'100000',tickSize:'0.1',baseDecimalPlaces:3,orderTypes:['LIMIT','STOP_LOSS_LIMIT','TAKE_PROFIT_LIMIT']};
const limits={allocation:'1000',riskBps:100,dailyLossBps:300,maxSpreadBps:20,slippageBps:0,feeBps:0,maxPriceAgeMs:5000,authorized:true};
const signal={stopLoss:'90',takeProfit:'120'};
it('sizes precisely within approved risk and rounds to exchange precision',()=>{
 expect(sizeValrSpotBuy(signal,account,spec,limits,now)).toEqual({baseAmount:'1',entryEstimate:'100',stopLoss:'90',takeProfit:'120',estimatedRisk:'10',maxQuoteCost:'100'});
 const conservative=sizeValrSpotBuy({stopLoss:'90.09',takeProfit:'120.09'},account,spec,{...limits,feeBps:10,slippageBps:5},now);
 expect(conservative.stopLoss).toBe('90');expect(conservative.takeProfit).toBe('120');expect(Number(conservative.estimatedRisk)).toBeLessThanOrEqual(10);
 expect(conservative.entryEstimate).toBe('100.1');
});
it('rejects missing protection, stale quotes, small budgets and unreconciled accounts',()=>{
 expect(()=>sizeValrSpotBuy(signal,account,{...spec,orderTypes:['MARKET']},limits,now)).toThrow('order types');
 expect(()=>sizeValrSpotBuy(signal,{...account,quoteTime:now-6000},spec,limits,now)).toThrow('stale');
 expect(()=>sizeValrSpotBuy(signal,{...account,availableQuote:'70'},spec,{...limits,allocation:'70'},now)).toThrow('minimums');
 expect(()=>sizeValrSpotBuy(signal,{...account,reconciled:false},spec,limits,now)).toThrow('reconciliation');
 expect(()=>sizeValrSpotBuy({stopLoss:'100.01',takeProfit:'120'},account,spec,limits,now)).toThrow('protective');
});
it('enforces remaining daily loss and blocks existing open orders',()=>{
 expect(()=>sizeValrSpotBuy(signal,{...account,dailyLoss:'30'},spec,limits,now)).toThrow('Daily loss');
 expect(()=>sizeValrSpotBuy(signal,{...account,openOrders:1},spec,limits,now)).toThrow('Existing orders');
 const result=sizeValrSpotBuy(signal,{...account,dailyLoss:'29'},spec,limits,now);
 expect(result.estimatedRisk).toBe('1');expect(result.baseAmount).toBe('0.1');
});
