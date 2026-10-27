import { BrokerTokenStore } from '../server/broker-tokens.ts';
import { TF_SECONDS,validateMargin,sizeOrder,riskLimits,type Signal,type RiskLimits,type AccountSnapshot,type OrderIntent } from '../shared/trading.ts';
import { CTraderConnection } from './protocol.ts';
const PERIOD:Record<string,number>={m1:1,m5:5,m15:7,m30:8,h1:9,h4:10,d1:12};
const same=(value:any,name:string,id:number)=>value===name||value===id;
function id(value:any){if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('Unsafe broker identifier');const v=String(value);if(!/^\d{1,19}$/.test(v))throw Error('Invalid broker identifier');return v;}
function monetary(value:any,digits:any){if(!Number.isInteger(Number(digits))||Number(digits)<0||Number(digits)>8||!Number.isFinite(Number(value)))throw Error('Invalid broker monetary units');return Number(value)/10**Number(digits);}
function localParts(now:number,zone:string){const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);return Object.fromEntries(p.map(v=>[v.type,v.value]));}
export function marketOpen(symbol:any,now=Date.now()){
  if(!symbol.scheduleTimeZone||!symbol.schedule?.length)return false;
  const p=localParts(now,symbol.scheduleTimeZone),day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday),seconds=day*86400+Number(p.hour)*3600+Number(p.minute)*60+Number(p.second);
  if(!symbol.schedule.some((s:any)=>s.startSecond<s.endSecond?seconds>=s.startSecond&&seconds<s.endSecond:seconds>=s.startSecond||seconds<s.endSecond))return false;
  for(const holiday of symbol.holiday||[]){const hp=localParts(now,holiday.scheduleTimeZone),date=new Date(Number(holiday.holidayDate)*86400000).toISOString().slice(0,10),today=`${hp.year}-${hp.month}-${hp.day}`;if((holiday.isRecurring?date.slice(5)===today.slice(5):date===today)){const second=Number(hp.hour)*3600+Number(hp.minute)*60+Number(hp.second);if(second>=Number(holiday.startSecond||0)&&second<Number(holiday.endSecond??86400))return false;}}
  return true;
}
export class BrokerGateway {
  private daily=new Map<string,{at:number;day:number;balance:number;deals:any;flows:any}>();
  private symbolCache=new Map<string,{at:number;value:any}>();
  private generation=new Map<string,number>();
  private listing=new Map<string,{at:number;value:any}>();
  readonly demo:CTraderConnection;readonly live:CTraderConnection;
  constructor(private tokens:BrokerTokenStore,pool?:{demo:CTraderConnection;live:CTraderConnection},private audit?:{intent:(id:string,data:any)=>Promise<void>;event:(environment:string,payload:any)=>Promise<void>}){this.demo=pool?.demo||new CTraderConnection('demo',process.env.CTRADER_CLIENT_ID||'',process.env.CTRADER_CLIENT_SECRET||process.env.CTRADER_SECRET_KEY||'');this.live=pool?.live||new CTraderConnection('live',process.env.CTRADER_CLIENT_ID||'',process.env.CTRADER_CLIENT_SECRET||process.env.CTRADER_SECRET_KEY||'');for(const connection of [this.demo,this.live])connection.onEvent((type,payload)=>{if(type===2120)this.symbolCache.clear();if(type===2126){const key=String(payload.ctidTraderAccountId);this.daily.delete(key);this.generation.set(key,(this.generation.get(key)||0)+1);return this.audit?.event(connection.environment,payload)}});}
  async authorizeTokens(uid:string,tokens:any){if(typeof tokens?.accessToken!=='string'||typeof tokens?.refreshToken!=='string'||!Number.isFinite(tokens.expiresAt)||tokens.scope!=='trading')throw Error('Invalid broker authorization');await this.tokens.save(uid,tokens);this.listing.delete(uid);return {authorized:true};}
  async accounts(uid:string){const token=await this.tokens.valid(uid);const cached=this.listing.get(uid);if(cached&&Date.now()-cached.at<5000)return cached.value;const response=await this.demo.request(2149,{accessToken:token.accessToken});const value={scope:response.permissionScope,accounts:(response.ctidTraderAccount||[]).map((a:any)=>({accountId:id(a.ctidTraderAccountId),environment:a.isLive?'live':'demo',login:String(a.traderLogin||''),broker:String(a.brokerTitleShort||'cTrader broker')}))};if(this.listing.size>10000)this.listing.clear();this.listing.set(uid,{at:Date.now(),value});return value;}
  private async account(uid:string,accountId:string){const listing=await this.accounts(uid),account=listing.accounts.find((a:any)=>a.accountId===id(accountId));if(!account)throw Error('This broker account is not authorized for this customer.');const token=await this.tokens.valid(uid),connection=account.environment==='live'?this.live:this.demo;await connection.authorize(account.accountId,token.accessToken);return {connection,account,token,scope:listing.scope};}
  async symbols(uid:string,accountId:string){const {connection}=await this.account(uid,accountId);const cacheKey=accountId+':symbols',cached=this.symbolCache.get(cacheKey);if(cached&&Date.now()-cached.at<60000)return cached.value;const data=await connection.request(2114,{ctidTraderAccountId:accountId,includeArchivedSymbols:false});const value=(data.symbol||[]).map((s:any)=>({symbolId:id(s.symbolId),name:String(s.symbolName||''),baseAssetId:String(s.baseAssetId||''),quoteAssetId:String(s.quoteAssetId||''),enabled:s.enabled!==false}));if(this.symbolCache.size>20000)this.symbolCache.clear();this.symbolCache.set(cacheKey,{at:Date.now(),value});return value;}
  async specification(uid:string,accountId:string,symbolId:string){const {connection}=await this.account(uid,accountId);const result=await connection.request(2116,{ctidTraderAccountId:accountId,symbolId:[id(symbolId)]});const spec=result.symbol?.find((s:any)=>id(s.symbolId)===symbolId);if(!spec)throw Error('Symbol specifications are unavailable');return spec;}
  async inspect(uid:string,accountId:string,includeHistory=true){
    const {connection,account}=await this.account(uid,accountId),a={ctidTraderAccountId:accountId};
    const [trader,reconcile,pnl,history]=await Promise.all([connection.request(2121,a),connection.request(2124,a),connection.request(2187,a),includeHistory?connection.request(2133,{...a,fromTimestamp:Date.now()-7*86400000,toTimestamp:Date.now(),maxRows:1000},{historical:true}):Promise.resolve({deal:[],hasMore:false})]);
    const positions=reconcile.position||[],unrealized=pnl.positionUnrealizedPnL||[],balance=monetary(trader.trader.balance,trader.trader.moneyDigits),netPnl=unrealized.reduce((n:number,p:any)=>n+monetary(p.netUnrealizedPnL,pnl.moneyDigits),0),margin=positions.reduce((n:number,p:any)=>n+monetary(p.usedMargin,p.moneyDigits??trader.trader.moneyDigits),0);
    return {account,trader:trader.trader,positions,orders:reconcile.order||[],unrealized,moneyDigits:pnl.moneyDigits,summary:{balance,equity:balance+netPnl,usedMargin:margin,freeMargin:balance+netPnl-margin,netUnrealizedPnl:netPnl},history:history.deal||[],historyIncomplete:Boolean(history.hasMore),observedAt:Date.now()};
  }
  private async conversion(connection:CTraderConnection,accountId:string,from:string,to:string){
    if(from===to)return 1;
    const chain=await connection.request(2118,{ctidTraderAccountId:accountId,firstAssetId:from,lastAssetId:to});let currency=from,rate=1;
    for(const symbol of chain.symbol||[]){const q=await connection.spot(accountId,id(symbol.symbolId));if(String(symbol.baseAssetId)===currency){rate*=q.ask;currency=String(symbol.quoteAssetId);}else if(String(symbol.quoteAssetId)===currency){rate/=q.bid;currency=String(symbol.baseAssetId);}else throw Error('Broker currency conversion chain is incomplete');}
    if(currency!==to||!Number.isFinite(rate)||rate<=0)throw Error('No broker currency conversion is available');return rate;
  }
  async snapshot(uid:string,accountId:string,symbolId:string):Promise<AccountSnapshot>{
    const {connection,account,scope}=await this.account(uid,accountId),a={ctidTraderAccountId:accountId};
    const [state,listed,specs]=await Promise.all([this.inspect(uid,accountId,false),this.symbols(uid,accountId),connection.request(2116,{...a,symbolId:[id(symbolId)]})]);
    const symbol=listed.find((s:any)=>s.symbolId===symbolId),spec=specs.symbol?.find((s:any)=>id(s.symbolId)===symbolId);if(!symbol||!spec)throw Error('Symbol is not available on this broker account.');
    const trader=state.trader;if(!trader||!Number.isInteger(Number(trader.moneyDigits)))throw Error('Broker account details are incomplete');
    if(same(trader.accountType,'SPREAD_BETTING',2))throw Error('Spread-betting sizing is not verified. Select a hedged demo account.');
    if(same(trader.accountType,'NETTED',1))throw Error('Netted accounts require additional allocation verification; select a hedged demo account.');
    const q=await connection.spot(accountId,symbolId),conversion=await this.conversion(connection,accountId,symbol.quoteAssetId,String(trader.depositAssetId));
    const netPnl=state.unrealized.reduce((sum:number,p:any)=>sum+monetary(p.netUnrealizedPnL,state.moneyDigits),0),balance=monetary(trader.balance,trader.moneyDigits),equity=balance+netPnl;
    const used=state.positions.reduce((sum:number,p:any)=>sum+monetary(p.usedMargin,p.moneyDigits??trader.moneyDigits),0);
    let exposure=0;
    for(const p of [...state.positions,...state.orders]){
      const info=listed.find((s:any)=>s.symbolId===id(p.tradeData.symbolId));if(!info||!p.stopLoss)throw Error('Unprotected or unknown-symbol exposure blocks new orders.');
      const entry=Number(p.price??p.limitPrice??p.stopPrice),loss=Math.abs(entry-Number(p.stopLoss));if(!Number.isFinite(loss))throw Error('Cannot calculate account exposure');
      exposure+=loss*Number(p.tradeData.volume)/100*await this.conversion(connection,accountId,info.quoteAssetId,String(trader.depositAssetId));
    }
    const now=Date.now(),day=Date.parse(new Date(now).toISOString().slice(0,10)+'T00:00:00Z');
    let deals:any,flows:any;const cached=this.daily.get(accountId),generation=this.generation.get(accountId)||0;
    if(cached&&cached.day===day&&cached.balance===balance&&now-cached.at<5000){deals=cached.deals;flows=cached.flows}else{
      [deals,flows]=await Promise.all([connection.request(2133,{...a,fromTimestamp:day,toTimestamp:now,maxRows:1000},{historical:true}),connection.request(2143,{...a,fromTimestamp:day,toTimestamp:now},{historical:true})]);
      if((this.generation.get(accountId)||0)!==generation)throw Error('Broker executions changed during risk validation. Wait for a new signal.');
      if(this.daily.size>10000)this.daily.clear();this.daily.set(accountId,{at:Date.now(),day,balance,deals,flows});
    }
    if(deals.hasMore)throw Error('Daily deal history is incomplete; new orders are paused.');
    let closedNet=0,closedLoss=0;for(const d of deals.deal||[]){const p=d.closePositionDetail;const net=p?monetary(p.grossProfit,p.moneyDigits??trader.moneyDigits)+monetary(p.swap,p.moneyDigits??trader.moneyDigits)-Math.abs(monetary(p.commission,p.moneyDigits??trader.moneyDigits))-Math.abs(monetary(p.pnlConversionFee||0,p.moneyDigits??trader.moneyDigits)):-Math.abs(monetary(d.commission||0,d.moneyDigits??trader.moneyDigits));closedNet+=net;closedLoss+=Math.max(0,-net);}
    const cash=(flows.depositWithdraw||[]).reduce((sum:number,f:any)=>sum+monetary(f.delta,f.moneyDigits??trader.moneyDigits),0),baseline=balance-closedNet-cash;if(baseline<=0||equity<=0)throw Error('Invalid account equity or daily risk baseline.');
    const fresh=await connection.spot(accountId,symbolId);
    const distance=(n:number)=>same(spec.distanceSetIn,'SYMBOL_DISTANCE_IN_PERCENTAGE',2)?q.ask*n/100: n/10**Number(spec.digits);
    return {accountId,environment:account.environment,permission:(same(trader.accessRights??0,'FULL_ACCESS',0)&&same(scope,'SCOPE_TRADE',1))?'FULL_ACCESS':'NO_TRADING',balance,equity,freeMargin:equity-used,dailyLossPercent:(closedLoss+Math.max(0,-netPnl))/baseline*100,exposurePercent:exposure/equity*100,positions:state.positions.length,pendingOrders:state.orders.length,reconciled:true,symbolId,symbol:symbol.name,bid:fresh.bid,ask:fresh.ask,quoteTime:fresh.time,marketOpen:marketOpen(spec),enabled:symbol.enabled&&same(spec.tradingMode??0,'ENABLED',0),minVolume:Number(spec.minVolume),maxVolume:Number(spec.maxVolume),stepVolume:Number(spec.stepVolume),quoteToDeposit:conversion,digits:Number(spec.digits),minStopDistance:Math.max(distance(Number(spec.slDistance||0)),distance(Number(spec.tpDistance||0))),maxLeverage:Number(trader.leverageInCents)/100,guaranteedStopsRequired:Boolean(trader.isLimitedRisk)};
  }
  async candles(uid:string,accountId:string,symbolId:string,timeframe:string,from:number,to:number){
    const period=PERIOD[timeframe];if(!period||!Number.isFinite(from)||!Number.isFinite(to)||to<=from)throw Error('Invalid historical candle request');const {connection}=await this.account(uid,accountId);
    const rows:any[]=[],seen=new Set<number>();let end=to;
    for(let page=0;page<60;page++){
      const data=await connection.request(2137,{ctidTraderAccountId:accountId,symbolId:id(symbolId),period,fromTimestamp:from,toTimestamp:end,count:1000},{historical:true});const bars=data.trendbar||[];if(!bars.length)break;
      let oldest=Infinity;for(const b of bars){const time=Number(b.utcTimestampInMinutes)*60;oldest=Math.min(oldest,time*1000);if(time*1000<from||time*1000+TF_SECONDS[timeframe]*1000>to||seen.has(time))continue;seen.add(time);const low=Number(b.low)/100000;rows.push({time,open:low+Number(b.deltaOpen)/100000,close:low+Number(b.deltaClose)/100000,high:low+Number(b.deltaHigh)/100000,low,volume:Number(b.volume)});}
      if(rows.length>50000)throw Error('Historical replay limit reached');if(oldest<=from||bars.length<1000)break;if(!Number.isFinite(oldest)||oldest>=end)throw Error('Broker history pagination made no progress');end=oldest-1;
      if(page===59)throw Error('Broker historical request is too large');
    }
    return rows.sort((a,b)=>a.time-b.time);
  }
  async margin(uid:string,accountId:string,order:OrderIntent){const {connection}=await this.account(uid,accountId);const response=await connection.request(2139,{ctidTraderAccountId:accountId,symbolId:order.symbolId,volume:[order.volume]});const entry=response.margin?.find((m:any)=>Number(m.volume)===order.volume);if(!entry)throw Error('Broker did not return expected margin.');return monetary(order.action==='BUY'?entry.buyMargin:entry.sellMargin,response.moneyDigits);}
  async reconcile(uid:string,accountId:string,clientOrderId:string,since:number){const {connection}=await this.account(uid,accountId);const orders=await connection.request(2175,{ctidTraderAccountId:accountId,fromTimestamp:since-60000,toTimestamp:Date.now()},{historical:true});if(orders.hasMore)throw Error('Order reconciliation is incomplete');const match=(orders.order||[]).find((o:any)=>o.clientOrderId===clientOrderId);return match?{state:same(match.orderStatus,'ORDER_STATUS_REJECTED',3)?'rejected':'acknowledged',order:match}:{state:'unknown',reason:'No definitive acknowledgement. Do not resubmit this intent.'};}
  async submit(uid:string,accountId:string,order:OrderIntent,signal:Signal,risk:RiskLimits){
    if(process.env.DEMO_TRADING_ENABLED!=='true')throw Error('Demo execution has not been enabled by the operator.');
    const {connection,account,token}=await this.account(uid,accountId);if(account.environment!=='demo'||token.scope!=='trading')throw Error('Only authorized demo trading is enabled.');
    const snapshot=await this.snapshot(uid,accountId,order.symbolId);if(snapshot.permission!=='FULL_ACCESS'||!snapshot.marketOpen||!snapshot.enabled||!snapshot.reconciled||Date.now()-snapshot.quoteTime>5000)throw Error('Broker state no longer permits the order');
    const approved=sizeOrder(signal,snapshot,riskLimits(risk),order.clientOrderId);if(order.volume>approved.volume||order.signalId!==signal.id||order.action!==signal.action||order.stopLoss!==signal.stopLoss||order.takeProfit!==signal.takeProfit)throw Error('Fresh account risk validation rejected this intent');
    if(!/^[A-Za-z0-9_-]{1,50}$/.test(order.clientOrderId)||!Number.isSafeInteger(order.volume)||order.volume<snapshot.minVolume||order.volume>snapshot.maxVolume||order.volume%snapshot.stepVolume!==0||!['MARKET','LIMIT','STOP'].includes(order.type))throw Error('Broker order constraints failed');
    const entry=order.type==='MARKET'?(order.action==='BUY'?snapshot.ask:snapshot.bid):order.entryPrice;
    if(!(order.action==='BUY'?order.stopLoss<entry&&entry<order.takeProfit:order.takeProfit<entry&&entry<order.stopLoss)||snapshot.guaranteedStopsRequired)throw Error('Invalid protective levels');
    if(order.type==='LIMIT'&&!(order.action==='BUY'?entry<snapshot.ask:entry>snapshot.bid)||order.type==='STOP'&&!(order.action==='BUY'?entry>snapshot.ask:entry<snapshot.bid))throw Error('Pending order price is on the wrong side of the quote');
    const budget=snapshot.equity*Math.min(risk.riskPercent,risk.maxExposurePercent-snapshot.exposurePercent)/100;
    if(Math.abs(entry-order.stopLoss)*order.volume/100*snapshot.quoteToDeposit>budget+1e-8||order.volume/100*entry*snapshot.quoteToDeposit/snapshot.equity>Math.min(risk.maxLeverage,snapshot.maxLeverage))throw Error('Pending entry exceeds risk or leverage limits');
    if(Math.min(Math.abs(entry-order.stopLoss),Math.abs(entry-order.takeProfit))<snapshot.minStopDistance)throw Error('Protective distance is below broker requirements');
    if([entry,order.stopLoss,order.takeProfit].some(v=>Math.abs(v*10**snapshot.digits-Math.round(v*10**snapshot.digits))>1e-6))throw Error('Order price precision exceeds broker digits');
    validateMargin(await this.margin(uid,accountId,order),snapshot.freeMargin);
    if(Date.now()-snapshot.quoteTime>risk.maxPriceAgeMs)throw Error('Price expired during margin validation. Wait for a new signal.');
    const protection=order.type==='MARKET'?{relativeStopLoss:Math.round(Math.abs(entry-order.stopLoss)*100000),relativeTakeProfit:Math.round(Math.abs(entry-order.takeProfit)*100000)}:{stopLoss:order.stopLoss,takeProfit:order.takeProfit,...(order.type==='LIMIT'?{limitPrice:entry}:{stopPrice:entry})};
    await this.audit?.intent(order.clientOrderId,{uid,accountId,signalId:signal.id,botId:signal.botId,createdAt:Date.now()});
    return connection.request(2106,{ctidTraderAccountId:accountId,symbolId:order.symbolId,orderType:{MARKET:1,LIMIT:2,STOP:3}[order.type],tradeSide:order.action==='BUY'?1:2,volume:order.volume,clientOrderId:order.clientOrderId,label:order.clientOrderId,...protection},{mutation:true});
  }
  async manage(uid:string,accountId:string,body:any){const {connection,account}=await this.account(uid,accountId);if(account.environment!=='demo'||process.env.DEMO_TRADING_ENABLED!=='true')throw Error('Only demo position management is enabled');const state=await this.inspect(uid,accountId,false),a={ctidTraderAccountId:accountId};if(!same(state.trader.accessRights??0,'FULL_ACCESS',0)&&!(body.action!=='protection'&&same(state.trader.accessRights,'CLOSE_ONLY',1)))throw Error('Account permissions do not allow this operation');if(body.action==='cancel'){if(!state.orders.some((o:any)=>id(o.orderId)===String(body.orderId)))throw Error('Order is not on your account');return connection.request(2108,{...a,orderId:id(body.orderId)},{mutation:true});}const position=state.positions.find((p:any)=>id(p.positionId)===String(body.positionId));if(!position)throw Error('Position is not on your account');if(body.action==='close')return connection.request(2111,{...a,positionId:id(body.positionId),volume:Number(position.tradeData.volume)},{mutation:true});if(body.action==='protection'){if(![body.stopLoss,body.takeProfit].every(n=>Number.isFinite(n)&&n>0))throw Error('Both protective levels are required');const spec=await this.specification(uid,accountId,id(position.tradeData.symbolId)),q=await connection.spot(accountId,id(position.tradeData.symbolId));const long=same(position.tradeData.tradeSide,'BUY',1),reference=long?q.bid:q.ask;if(!(long?body.stopLoss<reference&&reference<body.takeProfit:body.takeProfit<reference&&reference<body.stopLoss)||[body.stopLoss,body.takeProfit].some(p=>Math.abs(p*10**spec.digits-Math.round(p*10**spec.digits))>1e-6))throw Error('Protective prices violate side or precision rules');return connection.request(2110,{...a,positionId:id(body.positionId),stopLoss:body.stopLoss,takeProfit:body.takeProfit},{mutation:true});}throw Error('Unsupported position action');}
}
