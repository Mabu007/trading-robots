export const TF_SECONDS: Record<string, number> = { m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400,d1:86400 };
export type Environment = 'demo' | 'live';
export type RiskLimits = { riskPercent:number; maxDailyLossPercent:number; maxExposurePercent:number; maxPositions:number; maxSpreadBps:number; maxLeverage:number; maxPriceAgeMs:number; enabled:boolean; realMoneyApproved:false };
export const DEFAULT_RISK: RiskLimits = { riskPercent:0.5,maxDailyLossPercent:3,maxExposurePercent:3,maxPositions:3,maxSpreadBps:30,maxLeverage:10,maxPriceAgeMs:5000,enabled:false,realMoneyApproved:false };
export function riskLimits(input: unknown): RiskLimits {
  const v = { ...DEFAULT_RISK, ...(input as Partial<RiskLimits>) };
  for (const [key,min,max] of [['riskPercent',0.01,2],['maxDailyLossPercent',0.1,10],['maxExposurePercent',0.1,10],['maxPositions',1,20],['maxSpreadBps',0.1,100],['maxLeverage',1,100],['maxPriceAgeMs',500,10000]] as const) {
    if (!Number.isFinite(v[key]) || v[key]<min || v[key]>max) throw Error(`Invalid ${key}`);
  }
  if (!Number.isInteger(v.maxPositions) || typeof v.enabled!=='boolean' || v.realMoneyApproved!==false) throw Error('Only explicit demo trading is available.');
  return v;
}
export type Signal = { id:string; botId:string; version:string; action:'BUY'|'SELL'; symbol:string; timeframe:string; candleClose:number; createdAt:number; expiresAt:number; stopLoss:number; takeProfit:number; reason:string };
export function validateSignal(signal:Signal, reference:number, now:number) {
  if (![signal.candleClose,signal.createdAt,signal.expiresAt].every(Number.isSafeInteger)||signal.candleClose<0||signal.candleClose>signal.createdAt||signal.expiresAt<=signal.createdAt||typeof signal.version!=='string'||!signal.version)throw Error('Signal timestamps or version are invalid');
  if (!['BUY','SELL'].includes(signal.action) || !signal.id || !signal.botId || !TF_SECONDS[signal.timeframe] || signal.candleClose>now || signal.expiresAt<now || signal.createdAt>now+1000) throw Error('Signal is stale or invalid');
  if (![reference,signal.stopLoss,signal.takeProfit].every(n=>Number.isFinite(n)&&n>0) || !(signal.action==='BUY'?signal.stopLoss<reference&&reference<signal.takeProfit:signal.takeProfit<reference&&reference<signal.stopLoss)) throw Error('Signal has invalid protective levels');
}
export type AccountSnapshot = { accountId:string; environment:Environment; permission:'FULL_ACCESS'|'CLOSE_ONLY'|'NO_TRADING'; balance:number; equity:number; freeMargin:number; dailyLossPercent:number; exposurePercent:number; positions:number; pendingOrders:number; reconciled:boolean; symbolId:string; symbol:string; bid:number; ask:number; quoteTime:number; marketOpen:boolean; enabled:boolean; minVolume:number; maxVolume:number; stepVolume:number; quoteToDeposit:number; digits:number; minStopDistance:number; maxLeverage:number; guaranteedStopsRequired?:boolean };
export type OrderIntent = { clientOrderId:string; symbolId:string; action:'BUY'|'SELL'; type:'MARKET'|'LIMIT'|'STOP'; volume:number; stopLoss:number; takeProfit:number; entryPrice:number; signalId:string };
export function sizeOrder(signal:Signal, account:AccountSnapshot, risk:RiskLimits, clientOrderId:string, now=Date.now()):OrderIntent {
  risk=riskLimits(risk);
  if(![account.bid,account.ask,account.quoteTime,account.maxLeverage,account.minStopDistance].every(Number.isFinite)||account.maxLeverage<=0||account.minStopDistance<0||!Number.isInteger(account.digits)||account.digits<0||account.digits>10||![account.positions,account.pendingOrders].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Broker quote or constraints are incomplete');
  if (!risk.enabled || account.environment!=='demo' || risk.realMoneyApproved || account.permission!=='FULL_ACCESS') throw Error('Demo trading has not been authorized');
  if (!account.reconciled || !account.enabled || !account.marketOpen || account.guaranteedStopsRequired) throw Error('Broker state, session, or symbol does not permit trading');
  if (now-account.quoteTime>risk.maxPriceAgeMs || account.quoteTime>now+1000 || account.ask<account.bid || account.bid<=0) throw Error('Price is stale or invalid');
  const entry=signal.action==='BUY'?account.ask:account.bid; validateSignal(signal,entry,now);
  if (!Number.isFinite(account.dailyLossPercent) || account.dailyLossPercent>=risk.maxDailyLossPercent || !Number.isFinite(account.exposurePercent) || account.exposurePercent>=risk.maxExposurePercent) throw Error('Account loss or exposure limit reached');
  if (account.positions+account.pendingOrders>=risk.maxPositions) throw Error('Maximum simultaneous positions reached');
  if ((account.ask-account.bid)/entry*10000>risk.maxSpreadBps) throw Error('Spread exceeds your limit');
  if (Math.abs(entry-signal.stopLoss)<account.minStopDistance || Math.abs(entry-signal.takeProfit)<account.minStopDistance) throw Error('Protective levels violate broker minimum distances');
  if (![account.equity,account.freeMargin,account.quoteToDeposit,account.minVolume,account.maxVolume,account.stepVolume].every(n=>Number.isFinite(n)&&n>0)) throw Error('Broker sizing information is incomplete');
  const riskPercent=Math.min(risk.riskPercent,risk.maxExposurePercent-account.exposurePercent);
  const budget=account.equity*riskPercent/100;
  // cTrader volume is in hundredths of a unit, not lots.
  const raw=budget/(Math.abs(entry-signal.stopLoss)*account.quoteToDeposit)*100;
  const volume=Math.floor(Math.min(raw,account.maxVolume)/account.stepVolume)*account.stepVolume;
  if (!Number.isSafeInteger(volume) || volume<account.minVolume) throw Error('Risk budget is below the broker minimum volume');
  const notional=volume/100*entry*account.quoteToDeposit;
  if (notional/account.equity>Math.min(risk.maxLeverage,account.maxLeverage)) throw Error('Leverage limit exceeded');
  return {clientOrderId,symbolId:account.symbolId,action:signal.action,type:'MARKET',volume,stopLoss:signal.stopLoss,takeProfit:signal.takeProfit,entryPrice:entry,signalId:signal.id};
}
export function validateMargin(margin:number, freeMargin:number) { if (!Number.isFinite(margin)||margin<=0||margin>freeMargin*.8) throw Error('Insufficient available margin with safety reserve'); }
export type Payment = { id:string;botId:string;creatorId:string;customerId:string;grossMinor:number;feeMinor:number;creatorMinor:number;currency:string;provider:'yoco';status:'pending'|'successful'|'refunded'|'disputed'|'failed';payoutStatus:'pending'|'completed'|'not_due';createdAt:number;verifiedAt?:number;providerEventId?:string };
export function verifiedRevenue(payments:Payment[]) {
  const result={grossMinor:0,feeMinor:0,creatorMinor:0,paidSales:0,pendingPayoutMinor:0,completedPayoutMinor:0}; const seen=new Set<string>();
  for(const p of payments){
    if(p.status!=='successful'||!p.verifiedAt||!p.providerEventId||p.provider!=='yoco'||seen.has(p.providerEventId))continue;
    if(![p.grossMinor,p.feeMinor,p.creatorMinor].every(n=>Number.isSafeInteger(n)&&n>=0)||p.feeMinor+p.creatorMinor!==p.grossMinor)throw Error('Invalid verified ledger amount');
    seen.add(p.providerEventId);result.grossMinor+=p.grossMinor;result.feeMinor+=p.feeMinor;result.creatorMinor+=p.creatorMinor;result.paidSales++;
    if(![result.grossMinor,result.feeMinor,result.creatorMinor].every(Number.isSafeInteger))throw Error('Verified ledger totals exceed safe integer limits');
    if(p.payoutStatus==='completed')result.completedPayoutMinor+=p.creatorMinor;else if(p.payoutStatus==='pending')result.pendingPayoutMinor+=p.creatorMinor;
  }
  return result;
}
