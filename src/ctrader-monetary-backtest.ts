import {simulateMoney,type MonetaryAssumptions,type MonetaryResult} from './monetary-backtest';
import type {Candle} from './types';
/** Broker-specific candle replay; cTrader deposit currency, not assumed ZAR.
 * Historical bid/ask and historical conversion are not available from trendbars alone.
 * The cost snapshot is deliberately recorded as assumptions, never called tick-accurate.
 */
export type CTraderSpecification={
 accountId:string;asset:string;symbolId:string;depositCurrency:string;
 quoteToDeposit:number;conversionType:string;conversionTime:number;
 bid:number;ask:number;lotSize:number;minVolume:number;maxVolume:number;stepVolume:number;
 roundTripCommissionPerUnit:number;leverageInCents:number;balance:number;
};
export function brokerBacktestAssumptions(spec:CTraderSpecification,slippage:number):MonetaryAssumptions{
 const fields=[spec.quoteToDeposit,spec.bid,spec.ask,spec.lotSize,spec.minVolume,
  spec.maxVolume,spec.stepVolume,spec.roundTripCommissionPerUnit,slippage];
 if(fields.some(x=>!Number.isFinite(x))||spec.quoteToDeposit<=0||spec.ask<spec.bid||spec.bid<=0||
   spec.lotSize<=0||spec.minVolume<=0||spec.maxVolume<spec.minVolume||spec.stepVolume<=0||
   spec.roundTripCommissionPerUnit<0||slippage<0||!/^\w{3}$/.test(spec.depositCurrency))throw Error('Broker specifications are incomplete');
 return {
  contractSize:spec.lotSize/100,
  minVolume:spec.minVolume/spec.lotSize,
  volumeStep:spec.stepVolume/spec.lotSize,
  quoteToZar:spec.quoteToDeposit,
  spread:spec.ask-spec.bid,
  slippage,
  commissionPerLotZar:spec.roundTripCommissionPerUnit*spec.lotSize/100,
  ...(Number.isFinite(spec.leverageInCents)&&spec.leverageInCents>0?{leverage:spec.leverageInCents/100}:{})
 };
}
export function simulateCTraderMoney(candles:Candle[],decisions:any[],balance:number,riskPercent:number,spec:CTraderSpecification,slippage=0):MonetaryResult{
 const assumptions=brokerBacktestAssumptions(spec,slippage);
 const result=simulateMoney(candles,decisions,balance,riskPercent,assumptions);
 const maxLots=spec.maxVolume/spec.lotSize;
 if(result.trades.some(t=>t.volume>maxLots+1e-8))throw Error('Broker maximum order volume exceeded; split sizing is not supported by this simulator');
 return {...result,currency:spec.depositCurrency,source:'broker-metadata-candle-replay'};
}
