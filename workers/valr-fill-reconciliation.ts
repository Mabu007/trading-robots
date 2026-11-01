// Pure verification for an eventual live coordinator. Never makes network calls.
// Values are fixed-decimal strings to avoid rounding the protected quantity up.
const SCALE=10n**18n;
function decimal(value:unknown):bigint {
 if(typeof value!=='string'||value.length>40||!/^\d+(?:\.\d{1,18})?$/.test(value))throw Error('Invalid VALR decimal');
 const [whole,fraction='']=value.split('.');return BigInt(whole)*SCALE+BigInt(fraction.padEnd(18,'0'));
}
function format(value:bigint){const whole=value/SCALE,part=(value%SCALE).toString().padStart(18,'0').replace(/0+$/,'');return part?`${whole}.${part}`:String(whole)}
type Identity={pair:string;customerOrderId:string;baseCurrency:string;quoteCurrency:string;baseDecimalPlaces:number;minBaseAmount:string;minQuoteAmount:string;maxBaseAmount:string;limitPrice:string;stopLoss:string;slippageBps:number};
export function reconcileSpotBuy(summary:Record<string,unknown>,expected:Identity){
 if(summary.customerOrderId!==expected.customerOrderId||summary.currencyPair!==expected.pair||typeof summary.orderId!=='string'||!summary.orderId||String(summary.orderSide).toLowerCase()!=='buy')throw Error('VALR returned a mismatched order summary');
 if(!['Filled','Cancelled','Failed'].includes(String(summary.orderStatusType)))throw Error('Order is not terminal');
 if(!Number.isInteger(expected.baseDecimalPlaces)||expected.baseDecimalPlaces<0||expected.baseDecimalPlaces>18||!Number.isInteger(expected.slippageBps)||expected.slippageBps<0||expected.slippageBps>500||!expected.baseCurrency||!expected.quoteCurrency||expected.baseCurrency===expected.quoteCurrency)throw Error('Invalid market specification');
 const executed=decimal(summary.totalExecutedQuantity),fee=decimal(summary.totalFee),minBase=decimal(expected.minBaseAmount),minQuote=decimal(expected.minQuoteAmount),stop=decimal(expected.stopLoss);
 const approvedQuantity=decimal(expected.maxBaseAmount),approvedPrice=decimal(expected.limitPrice);
 if(minBase<=0n||minQuote<=0n||stop<=0n)throw Error('Invalid market minimums');
 if(approvedQuantity<=0n||approvedPrice<=0n||executed>approvedQuantity||summary.timeInForce!=='FOK'||String(summary.orderType).toLowerCase()!=='limit')throw Error('Fill differs from the approved limit order');
 if(executed===0n){if(fee!==0n||summary.orderStatusType==='Filled')throw Error('Invalid terminal order without a fill');return {filled:false,protectableQuantity:'0',dust:'0',exchangeOrderId:summary.orderId}}
 const averagePrice=decimal(summary.averagePrice);if(averagePrice<=0n||averagePrice>approvedPrice)throw Error('Fill price exceeds the approved limit');
 if(summary.feeCurrency!==expected.baseCurrency&&summary.feeCurrency!==expected.quoteCurrency)throw Error('Unknown fee currency; reconcile manually');
 const net=summary.feeCurrency===expected.baseCurrency?executed-fee:executed;
 if(net<0n)throw Error('Fee exceeds executed quantity');
 const step=10n**BigInt(18-expected.baseDecimalPlaces),quantity=net/step*step;
 const conservativeExit=stop*(10000n-BigInt(expected.slippageBps))/10000n;
 if(quantity<minBase||quantity<=0n||quantity*conservativeExit/SCALE<minQuote)throw Error('Filled quantity is below the protection minimum; manual action required');
 return {filled:true,protectableQuantity:format(quantity),dust:format(net-quantity),exchangeOrderId:summary.orderId};
}
export function verifySpotProtection(value:Record<string,unknown>,expected:{pair:string;customerOrderId:string;quantity:string;stopLoss:string;takeProfit:string}){
 if(value.currencyPair!==expected.pair||value.customerOrderId!==expected.customerOrderId||typeof value.orderId!=='string'||!value.orderId||String(value.triggerOrderSide).toLowerCase()!=='sell'||value.orderStatusType!=='Placed'||!['OCO','OT_OCO'].includes(String(value.conditionalType))||value.triggerType!=='LAST_TRADED')throw Error('Protection is not confirmed active');
 if(decimal(value.quantity)!==decimal(expected.quantity)||decimal(value.stopLossTriggerPrice)!==decimal(expected.stopLoss)||decimal(value.takeProfitTriggerPrice)!==decimal(expected.takeProfit))throw Error('Protection does not match the filled position');
 if(value.stopLossPlacePrice!=='-1'||value.takeProfitPlacePrice!=='-1')throw Error('Protection order settings differ from the approved order');
 return {orderId:value.orderId};
}
