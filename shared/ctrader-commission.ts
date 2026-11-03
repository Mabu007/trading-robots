/** Conservative round-trip cTrader commission allowance in deposit currency, per instrument unit. */
export type CommissionInput={
 commissionType:number; preciseTradingCommissionRate:number; preciseMinCommission:number;
 minCommissionAsset:string;minCommissionType:number;
 lotSize:number;minVolume:number;executionPrice:number;quoteToDeposit:number;usdToDeposit:number;baseToUsd:number;
};
export function commissionPerUnitDeposit(x:CommissionInput):number{
 const fields=Object.values(x).filter(v=>typeof v==='number');
 if(fields.some(v=>!Number.isFinite(v)))throw Error('Invalid broker commission metadata');
 if(!(x.lotSize>0&&x.minVolume>0&&x.quoteToDeposit>0&&x.usdToDeposit>0&&x.baseToUsd>0&&x.executionPrice>0))throw Error('Broker conversion or lot size is unavailable');
 const rate=x.preciseTradingCommissionRate,oneLotUnits=x.lotSize/100,minUnits=x.minVolume/100;
 if(rate<0||x.preciseMinCommission<0)throw Error('Negative broker commission metadata');
 let singleSide=0;
 if(rate>0)switch(x.commissionType){
  case 1:singleSide=rate/1e8/1e6*x.baseToUsd*x.usdToDeposit;break;
  case 2:singleSide=rate/1e8/oneLotUnits*x.usdToDeposit;break;
  case 3:singleSide=rate/1e5/100*x.executionPrice*x.quoteToDeposit;break;
  case 4:singleSide=rate/1e8/oneLotUnits*x.quoteToDeposit;break;
  default:throw Error('Unsupported cTrader commission model');
 }
 let minimum=0;
 if(x.preciseMinCommission>0){
  const currency=x.minCommissionAsset.toUpperCase();
  const factor=currency==='USD'?x.usdToDeposit:x.minCommissionType===2?x.quoteToDeposit:NaN;
  if(!Number.isFinite(factor))throw Error('Unknown broker minimum-commission currency');
  minimum=x.preciseMinCommission/1e8*factor/minUnits;
 }
 const cost=2*Math.max(singleSide,minimum);
 if(!Number.isFinite(cost)||cost<0)throw Error('Invalid computed broker commission');
 return cost;
}
