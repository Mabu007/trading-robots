// Pure exchange-fill verification for the live coordinator. Never makes network calls.
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

// Settlement requires exchange summaries linked by the server's unique client IDs.
// A triggered conditional alone is never treated as a fill. All entry cost is
// charged to the closed quantity (including any unsellable entry dust).
export function reconcileSpotExit(entry:Record<string,unknown>,exit:Record<string,unknown>,expected:{pair:string;entryId:string;entryOrderId:string;protectionId:string;quantity:string;baseCurrency:string;quoteCurrency:string;now:number}){
 if(entry.orderId!==expected.entryOrderId||entry.customerOrderId!==expected.entryId||entry.currencyPair!==expected.pair||String(entry.orderSide).toLowerCase()!=='buy')throw Error('Entry accounting identity mismatch');
 if(exit.customerOrderId!==expected.protectionId||exit.currencyPair!==expected.pair||String(exit.orderSide).toLowerCase()!=='sell'||typeof exit.orderId!=='string'||!exit.orderId||exit.orderId===entry.orderId)throw Error('Exit is not linked to the protective client order ID');
 if(exit.orderStatusType!=='Filled'||decimal(exit.remainingQuantity)!==0n||decimal(exit.totalExecutedQuantity)!==decimal(expected.quantity))throw Error('Protective exit is not fully filled');
 if(!['Filled','Cancelled','Failed'].includes(String(entry.orderStatusType)))throw Error('Entry accounting is not terminal');
 for(const record of [entry,exit])if(record.feeCurrency!==expected.baseCurrency&&record.feeCurrency!==expected.quoteCurrency)throw Error('Unknown settlement fee currency');
 const entryFee=decimal(entry.totalFee),exitFee=decimal(exit.totalFee),entryQuantity=decimal(entry.totalExecutedQuantity),exitQuantity=decimal(exit.totalExecutedQuantity);
 const owned=entryQuantity-(entry.feeCurrency===expected.baseCurrency?entryFee:0n);
 if(owned<=0n||exitQuantity+(exit.feeCurrency===expected.baseCurrency?exitFee:0n)>owned)throw Error('Exit exceeds the acquired base balance');
 const spent=decimal(entry.total)+(entry.feeCurrency===expected.quoteCurrency?entryFee:0n),received=decimal(exit.total)-(exit.feeCurrency===expected.quoteCurrency?exitFee:0n);
 if(spent<=0n||decimal(exit.total)<=0n||received<0n)throw Error('Invalid exchange settlement totals');
 const closedAt=typeof exit.orderUpdatedAt==='string'?Date.parse(exit.orderUpdatedAt):NaN;
 const openedAt=Date.parse(String(entry.orderCreatedAt));
 if(!Number.isSafeInteger(openedAt)||!Number.isSafeInteger(closedAt)||closedAt>expected.now+1000||closedAt<openedAt)throw Error('Invalid exchange settlement time');
 return {eventId:exit.orderId,closedAt,utcDay:new Date(closedAt).toISOString().slice(0,10),loss:format(spent>received?spent-received:0n),cost:format(spent),proceeds:format(received)};
}
