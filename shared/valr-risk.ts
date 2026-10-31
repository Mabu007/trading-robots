// Exact-decimal sizing for a future spot-only live adapter. This module is not
// an execution authorization boundary by itself; account snapshots must be
// independently verified and account-level order submission serialized.
const SCALE=10n**18n;
function decimal(value:string):bigint{
 if(typeof value!=='string'||value.length>40||!/^\d+(?:\.\d{1,18})?$/.test(value))throw Error('Invalid decimal value');
 const [whole,fraction='']=value.split('.');return BigInt(whole)*SCALE+BigInt(fraction.padEnd(18,'0'));
}
function format(value:bigint){const whole=value/SCALE,fraction=(value%SCALE).toString().padStart(18,'0').replace(/0+$/,'');return fraction?`${whole}.${fraction}`:String(whole)}
const ceilDiv=(a:bigint,b:bigint)=>(a+b-1n)/b;
const min=(...v:bigint[])=>v.reduce((a,b)=>a<b?a:b);
export type Snapshot={availableQuote:string;bid:string;ask:string;quoteTime:number;dayStartEquity:string;dailyLoss:string;openOrders:number;openPositions:number;reconciled:boolean};
export type Specification={minBaseAmount:string;maxBaseAmount:string;minQuoteAmount:string;maxQuoteAmount:string;tickSize:string;baseDecimalPlaces:number;orderTypes:string[]};
export type Limits={allocation:string;riskBps:number;dailyLossBps:number;maxSpreadBps:number;slippageBps:number;stopSlippageBps?:number;feeBps:number;maxPriceAgeMs:number;authorized:boolean};

export function sizeValrSpotBuy(signal:{stopLoss:string;takeProfit:string},account:Snapshot,spec:Specification,limits:Limits,now=Date.now()){
 if(!limits.authorized||!account.reconciled)throw Error('Live trading or account reconciliation is not authorized');
 if(!Number.isSafeInteger(account.openOrders)||!Number.isSafeInteger(account.openPositions)||account.openOrders!==0||account.openPositions!==0)throw Error('Existing orders or positions require reconciliation');
 if(!Number.isSafeInteger(account.quoteTime)||!Number.isSafeInteger(now)||!Number.isInteger(limits.maxPriceAgeMs)||limits.maxPriceAgeMs<500||limits.maxPriceAgeMs>10000||now-account.quoteTime>limits.maxPriceAgeMs||account.quoteTime>now+1000)throw Error('Market quote is stale');
 const stopSlippage=limits.stopSlippageBps??limits.slippageBps;
 for(const [v,minValue,maxValue] of [[limits.riskBps,1,200],[limits.dailyLossBps,10,1000],[limits.maxSpreadBps,1,1000],[limits.slippageBps,0,500],[stopSlippage,0,500],[limits.feeBps,0,1000]] as const)if(!Number.isInteger(v)||v<minValue||v>maxValue)throw Error('Invalid risk limit');
 if(!Array.isArray(spec.orderTypes)||!['LIMIT','STOP_LOSS_LIMIT','TAKE_PROFIT_LIMIT'].every(x=>spec.orderTypes.includes(x)))throw Error('Required exchange order types are unavailable');
 if(!Number.isInteger(spec.baseDecimalPlaces)||spec.baseDecimalPlaces<0||spec.baseDecimalPlaces>18)throw Error('Invalid base precision');
 const bid=decimal(account.bid),ask=decimal(account.ask),balance=decimal(account.availableQuote),allocation=decimal(limits.allocation),start=decimal(account.dayStartEquity),loss=decimal(account.dailyLoss),tick=decimal(spec.tickSize);
 const minBase=decimal(spec.minBaseAmount),maxBase=decimal(spec.maxBaseAmount),minQuote=decimal(spec.minQuoteAmount),maxQuote=decimal(spec.maxQuoteAmount);
 if(bid<=0n||ask<bid||balance<=0n||allocation<=0n||start<=0n||tick<=0n||minBase<=0n||maxBase<minBase||minQuote<=0n||maxQuote<minQuote)throw Error('Invalid exchange snapshot');
 if(ceilDiv((ask-bid)*10000n,ask)>BigInt(limits.maxSpreadBps))throw Error('Spread exceeds the approved limit');
 const stop=decimal(signal.stopLoss)/tick*tick,target=decimal(signal.takeProfit)/tick*tick;
 const entry=ceilDiv(ask*(10000n+BigInt(limits.slippageBps)),10000n*tick)*tick,stopExit=stop*(10000n-BigInt(stopSlippage))/10000n;
 if(stop<=0n||!(stop<ask&&ask<target&&stopExit<entry&&entry<target))throw Error('Invalid protective levels after exchange precision and slippage');
 const dailyLimit=start*BigInt(limits.dailyLossBps)/10000n;if(loss>=dailyLimit)throw Error('Daily loss limit reached');
 const capital=min(balance,allocation),tradeBudget=capital*BigInt(limits.riskBps)/10000n,budget=min(tradeBudget,dailyLimit-loss);
 const feePerUnit=ceilDiv((entry+stopExit)*BigInt(limits.feeBps),10000n),riskPerUnit=entry-stopExit+feePerUnit;
 const quotePerUnit=entry+ceilDiv(entry*BigInt(limits.feeBps),10000n);
 if(riskPerUnit<=0n||quotePerUnit<=0n||budget<=0n)throw Error('Risk budget is insufficient');
 const raw=min(budget*SCALE/riskPerUnit,capital*SCALE/quotePerUnit,maxBase,maxQuote*SCALE/entry);
 const step=10n**BigInt(18-spec.baseDecimalPlaces),quantity=raw/step*step;
 const notional=quantity*entry/SCALE,risk=ceilDiv(quantity*riskPerUnit,SCALE),cost=ceilDiv(quantity*quotePerUnit,SCALE);
 if(quantity<minBase||notional<minQuote||quantity>maxBase||notional>maxQuote||risk>budget||cost>capital)throw Error('Approved allocation or risk is below market minimums');
 return {baseAmount:format(quantity),entryEstimate:format(entry),stopLoss:format(stop),takeProfit:format(target),estimatedRisk:format(risk),maxQuoteCost:format(cost)};
}
