import type {Snapshot,Specification} from '../shared/valr-risk.ts';
// Parse authenticated exchange responses. The account-level ledger is added
// by the coordinator, never taken from the caller or the strategy.
function decimal(value:unknown):bigint{if(typeof value!=='string'||value.length>40||!/^\d+(?:\.\d{1,18})?$/.test(value))throw Error('Invalid VALR decimal');const [whole,fraction='']=value.split('.');return BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'))}
function percentBps(value:unknown):number{const n=decimal(value);const bps=(n*100n+10n**18n-1n)/10n**18n;if(bps>1000n)throw Error('Exchange fee or slippage is too high');return Number(bps)}
function one<T>(list:unknown,predicate:(v:any)=>boolean):T{if(!Array.isArray(list))throw Error('Invalid VALR response');const matches=list.filter(predicate);if(matches.length!==1)throw Error('VALR market or balance is missing or ambiguous');return matches[0] as T}
export function parseValrSnapshot(input:{pair:string;pairs:unknown;balances:unknown;orders:unknown;conditionals:unknown;orderTypes:unknown;fees:unknown;slippage:unknown;orderbook:unknown}){
 if(!/^[A-Z0-9]{3,30}$/.test(input.pair))throw Error('Invalid market');
 const pair=one<any>(input.pairs,v=>v?.symbol===input.pair&&v.active===true&&v.currencyPairType==='SPOT');
 if(typeof pair.baseCurrency!=='string'||typeof pair.quoteCurrency!=='string'||pair.baseCurrency===pair.quoteCurrency)throw Error('Invalid spot market');
 const base=one<any>(input.balances,v=>v?.currency===pair.baseCurrency),quote=one<any>(input.balances,v=>v?.currency===pair.quoteCurrency);
 const baseTotal=decimal(base.total),baseAvailable=decimal(base.available),quoteTotal=decimal(quote.total),quoteAvailable=decimal(quote.available);
 if(baseAvailable>baseTotal||quoteAvailable>quoteTotal)throw Error('Invalid account balance');
 for(const item of [base,quote])if(item.borrowedAmount!==undefined&&decimal(item.borrowedAmount)>0n)throw Error('Borrowed balances are not supported');
 if(!Array.isArray(input.orders)||!Array.isArray(input.conditionals)||!Array.isArray(input.orderTypes)||!input.orderTypes.every(v=>typeof v==='string'))throw Error('Invalid VALR account state');
 const fee=one<any>(input.fees,v=>v?.currencyPair===input.pair),slippage=one<any>(input.slippage,v=>v?.currencyPair===input.pair&&v.currencyPairType==='SPOT');
 const takerFeeBps=percentBps(fee.takerPercentage),protectiveSlippageBps=Math.max(percentBps(slippage.marketSlippagePercent),percentBps(slippage.limitSlippagePercent));
 const book=input.orderbook as any;if(!book||!Array.isArray(book.Bids)||!Array.isArray(book.Asks)||!book.Bids.length||!book.Asks.length)throw Error('VALR order book is unavailable');
 if(book.Bids.length>1000||book.Asks.length>1000)throw Error('Invalid VALR order book');
 const bid=book.Bids[0]?.price,ask=book.Asks[0]?.price,bestBid=decimal(bid),bestAsk=decimal(ask);
 if(bestBid<=0n||bestAsk<bestBid||book.Bids.some((v:any)=>decimal(v?.price)>bestBid)||book.Asks.some((v:any)=>decimal(v?.price)<bestAsk))throw Error('VALR order book is invalid or unsorted');
 const quoteTime=typeof book.LastChange==='number'?book.LastChange:Date.parse(book.LastChange);if(!Number.isSafeInteger(quoteTime))throw Error('VALR order book timestamp is unavailable');
 const spec:Specification={minBaseAmount:pair.minBaseAmount,maxBaseAmount:pair.maxBaseAmount,minQuoteAmount:pair.minQuoteAmount,maxQuoteAmount:pair.maxQuoteAmount,tickSize:pair.tickSize,baseDecimalPlaces:Number(pair.baseDecimalPlaces),orderTypes:input.orderTypes as string[]};
 const account:Omit<Snapshot,'dayStartEquity'|'dailyLoss'>={availableQuote:quote.available,bid,ask,quoteTime,openOrders:input.orders.length+input.conditionals.length,openPositions:baseTotal>0n?1:0,reconciled:true};
 return {baseCurrency:pair.baseCurrency as string,quoteCurrency:pair.quoteCurrency as string,spec,account,takerFeeBps,protectiveSlippageBps};
}
