// Local integration fixture only: never imports exchange credentials or sends orders.
import {DurableObject} from 'cloudflare:workers';
import {ValrLiveCoordinator} from './valr-live-coordinator';
const NOW=1_700_000_000_000;
const config={pair:'ETHZAR',limits:{allocation:'1000',riskBps:100,dailyLossBps:300,maxSpreadBps:20,slippageBps:0,feeBps:0,maxPriceAgeMs:5000}};
const signal={id:'candle-123',candleClose:NOW,stopLoss:'90',takeProfit:'120'};
export class LiveFixture extends DurableObject<any> {
 private coordinator:ValrLiveCoordinator;
 constructor(ctx:DurableObjectState,env:unknown){super(ctx,env);const store={get:<T>(key:string)=>ctx.storage.get<T>(key),put:(key:string,value:unknown)=>ctx.storage.put(key,value)};
  const bump=async(key:string)=>{const n=await ctx.storage.get<number>(key)||0;await ctx.storage.put(key,n+1)};
  const provider={snapshot:async()=>({baseCurrency:'ETH',quoteCurrency:'ZAR',takerFeeBps:0,protectiveSlippageBps:0,spec:{minBaseAmount:'0.001',maxBaseAmount:'100',minQuoteAmount:'10',maxQuoteAmount:'100000',tickSize:'0.1',baseDecimalPlaces:3,orderTypes:['LIMIT','STOP_LOSS_LIMIT','TAKE_PROFIT_LIMIT']},account:{availableQuote:'1000',bid:'99.9',ask:'100',quoteTime:NOW,dayStartEquity:'1000',dailyLoss:'0',openOrders:0,openPositions:0,reconciled:true}}),submitEntry:async()=>{await bump('entry-count');throw Error('ack lost')},entrySummary:async(o:any)=>({orderId:'entry-id',customerOrderId:o.entryId,currencyPair:o.pair,orderSide:'buy',orderType:'limit',timeInForce:'FOK',averagePrice:'100',orderStatusType:'Filled',totalExecutedQuantity:'1',totalFee:'0',feeCurrency:'ETH'}),submitProtection:async()=>{await bump('protection-count');throw Error('ack lost')},protectionStatus:async(o:any)=>({orderId:'protection-id',currencyPair:o.pair,customerOrderId:o.protectionId,triggerOrderSide:'sell',orderStatusType:'Placed',conditionalType:'OCO',triggerType:'LAST_TRADED',quantity:o.protectableQuantity,stopLossTriggerPrice:o.stopLoss,takeProfitTriggerPrice:o.takeProfit,stopLossPlacePrice:'-1',takeProfitPlacePrice:'-1'})};
  this.coordinator=new ValrLiveCoordinator(store,provider,()=>NOW);
 }
 async fetch(req:Request){try{const action=new URL(req.url).pathname.slice(1);let state;if(action==='start')state=await this.coordinator.start('bot1',config,true);else if(action==='submit')state=await this.coordinator.submit('bot1',signal);else if(action==='reconcile')state=await this.coordinator.reconcile();else if(action==='stop')state=await this.coordinator.stop('bot1');else state=await this.coordinator.status();return Response.json({state,entries:await this.ctx.storage.get('entry-count')||0,protections:await this.ctx.storage.get('protection-count')||0})}catch(e){return Response.json({error:e instanceof Error?e.message:'fixture failed'},{status:400})}}
}
export default {fetch(req:Request,env:{FIXTURE:DurableObjectNamespace}){return env.FIXTURE.get(env.FIXTURE.idFromName('test-account')).fetch(req)}} satisfies ExportedHandler<{FIXTURE:DurableObjectNamespace}>;
