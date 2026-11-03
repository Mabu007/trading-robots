/** cTrader risk math. Prices are in the instrument quote currency; volumes in 0.01 base units. */
export type CTraderRiskInput={
  balance:number; equity:number; freeMargin:number; quoteToDeposit:number;
  side:'BUY'|'SELL'; bid:number; ask:number; stop:number; target:number;
  riskPercent:number; maxDailyLossPercent:number; dailyStartEquity:number;
  maxDrawdownPercent:number; peakEquity:number; maxSpreadPercent:number;
  minVolume:number; maxVolume:number; stepVolume:number;
  maxSlippagePrice:number; roundTripCommissionPerUnit:number;
  openPositions:number; pendingOrders:number; maxPositions:number;
};
export type CTraderRiskResult={ok:true;volume:number;units:number;riskDeposit:number;referenceEntry:number;lossPerUnit:number}|{ok:false;reason:string};
export function computeCTraderRisk(x:CTraderRiskInput):CTraderRiskResult{
 const numbers=[x.balance,x.equity,x.freeMargin,x.quoteToDeposit,x.bid,x.ask,x.stop,x.target,x.riskPercent,
  x.maxDailyLossPercent,x.dailyStartEquity,x.maxDrawdownPercent,x.peakEquity,x.maxSpreadPercent,
  x.minVolume,x.maxVolume,x.stepVolume,x.maxSlippagePrice,x.roundTripCommissionPerUnit,x.openPositions,x.pendingOrders,x.maxPositions];
 if(numbers.some(n=>!Number.isFinite(n)))return {ok:false,reason:'Broker risk input is non-finite'};
 if(!(x.balance>0&&x.equity>0&&x.freeMargin>0&&x.quoteToDeposit>0&&x.bid>0&&x.ask>=x.bid))return {ok:false,reason:'Invalid account balance or current bid/ask'};
 if(!(x.minVolume>0&&x.stepVolume>0&&x.maxVolume>=x.minVolume&&Number.isInteger(x.minVolume)&&Number.isInteger(x.stepVolume)))return {ok:false,reason:'Broker volume rules are unavailable'};
 if(x.riskPercent<=0||x.riskPercent>1||x.maxDailyLossPercent<=0||x.maxDailyLossPercent>10||x.maxDrawdownPercent<=0||x.maxDrawdownPercent>20)return {ok:false,reason:'Risk limits are out of supported bounds'};
 if(x.openPositions<0||x.pendingOrders<0||x.openPositions+x.pendingOrders>=x.maxPositions||x.maxPositions<1)return {ok:false,reason:'Account has reached its shared position/order limit'};
 const spread=x.ask-x.bid,mid=(x.ask+x.bid)/2;
 if(spread/mid*100>x.maxSpreadPercent)return {ok:false,reason:'Current broker spread exceeds limit'};
 if(x.maxSlippagePrice<0||x.roundTripCommissionPerUnit<0)return {ok:false,reason:'Invalid cost bounds'};
 const entry=x.side==='BUY'?x.ask:x.bid,sign=x.side==='BUY'?1:-1;
 if(!(x.stop>0&&x.target>0&&sign*(entry-x.stop)>0&&sign*(x.target-entry)>0))return {ok:false,reason:'Stop or take-profit is on the wrong side of the executable quote'};
 const lossPerUnit=(Math.abs(entry-x.stop)+x.maxSlippagePrice)*x.quoteToDeposit+x.roundTripCommissionPerUnit;
 if(!(lossPerUnit>0))return {ok:false,reason:'Risk per unit cannot be established'};
 const tradeBudget=x.equity*x.riskPercent/100;
 const dailyRoom=x.dailyStartEquity*x.maxDailyLossPercent/100-(x.dailyStartEquity-x.equity);
 const drawdownRoom=x.peakEquity*x.maxDrawdownPercent/100-(x.peakEquity-x.equity);
 const riskBudget=Math.min(tradeBudget,dailyRoom,drawdownRoom);
 if(!(riskBudget>0))return {ok:false,reason:'Daily loss or maximum drawdown limit reached'};
 const maxUnits=riskBudget/lossPerUnit;
 const unitsCents=Math.floor((maxUnits*100+1e-7)/x.stepVolume)*x.stepVolume;
 const volume=Math.min(x.maxVolume,unitsCents);
 if(volume<x.minVolume)return {ok:false,reason:'Minimum broker order volume exceeds available risk allowance'};
 return {ok:true,volume,units:volume/100,riskDeposit:volume/100*lossPerUnit,referenceEntry:entry,lossPerUnit};
}
export function cTraderProtectionValid(p:any,expected:{side:'BUY'|'SELL';stop:number;target:number;digits:number;volume:number;symbolId:string}):boolean{
 if(!p||String(p.tradeData?.symbolId)!==expected.symbolId||!(Number(p.tradeData?.volume)>0)||Number(p.tradeData?.volume)>expected.volume||Number(p.tradeData?.tradeSide)!==(expected.side==='BUY'?1:2)||!(Number(p.price)>0))return false;
 const tick=10**(-Math.max(0,Math.min(10,expected.digits)));
 return Number.isFinite(Number(p.stopLoss))&&Number.isFinite(Number(p.takeProfit))&&
 Math.abs(Number(p.stopLoss)-expected.stop)<=tick*1.01&&
 Math.abs(Number(p.takeProfit)-expected.target)<=tick*1.01&&
 (expected.side==='BUY'?Number(p.stopLoss)<Number(p.price)&&Number(p.takeProfit)>Number(p.price):Number(p.stopLoss)>Number(p.price)&&Number(p.takeProfit)<Number(p.price));
}
