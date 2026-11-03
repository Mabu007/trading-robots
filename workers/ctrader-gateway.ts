import {DurableObject} from 'cloudflare:workers';
import {computeCTraderRisk,cTraderProtectionValid,type CTraderRiskInput} from '../shared/ctrader-risk';
import {commissionPerUnitDeposit} from '../shared/ctrader-commission';
import {CTraderLiveBot} from './ctrader-live-object';
export {CTraderLiveBot};

// Spotware JSON WebSocket: port 5036, NOT the protobuf port 5035.
// One named Durable Object per environment keeps connections shared across users.
type Env={CTRADER_GATEWAY_SECRET:string;CTRADER_CLIENT_ID:string;CTRADER_SECRET_KEY:string;GATEWAYS:DurableObjectNamespace;BOTS:DurableObjectNamespace;CTRADER_CONTROL_URL:string;CTRADER_TRADING_ENABLED?:string;CTRADER_DEMO_TRADING_ENABLED?:string;CTRADER_LIVE_TRADING_ENABLED?:string};
type Reply={payloadType:number;payload?:Record<string,any>;clientMsgId?:string};
const READ_ONLY=new Set([2149,2114,2116,2121,2124,2133,2137,2139,2145,2112,2118,2187,2175,2179]);
const RESPONSES:Record<number,number>={2149:2150,2114:2115,2116:2117,2121:2122,2124:2125,2133:2134,2137:2138,2139:2140,2145:2146,2112:2113,2175:2176,2118:2119,2187:2188,2179:2180};
const encode=(v:unknown)=>JSON.stringify(v);
function internalAuth(header:string,secret:string){return secret.length>=32&&header.length<500&&header===`Bearer ${secret}`;}
export class CTraderGateway extends DurableObject<Env>{
 private ws:WebSocket|null=null;
 private connecting:Promise<void>|null=null;
 private authenticated=new Set<string>();
 private authenticating=new Map<string,Promise<void>>();
 private waiters=new Map<string,{resolve:(v:Reply)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private heartbeat:ReturnType<typeof setInterval>|null=null;
 private sequence=0;
 private nextHistoryAt=0;
 private subscriptions=new Set<string>();
 private spots=new Map<string,{bid:number;ask:number;receivedAt:number;timestamp:number}>();
 private tail:Promise<unknown>=Promise.resolve();
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const task=this.tail.then(fn,fn);this.tail=task.catch(()=>{});return task}
 private environment:'demo'|'live'='demo';
 private failPending(message:string){for(const [id,p] of this.waiters){clearTimeout(p.timer);p.reject(new Error(message));this.waiters.delete(id)}this.authenticated.clear();this.authenticating.clear();this.subscriptions.clear();this.spots.clear();}
 private close(message:string){if(this.heartbeat){clearInterval(this.heartbeat);this.heartbeat=null}this.failPending(message);this.ws=null;this.connecting=null;}
 private async connectBroker(environment:'demo'|'live'){
  if(this.ws?.readyState===WebSocket.OPEN)return;
  if(this.connecting)return this.connecting;
  this.environment=environment;
  this.connecting=(async()=>{
   const ws=new WebSocket(`wss://${environment}.ctraderapi.com:5036`);
   await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('cTrader WebSocket connection timed out')),12000);
    ws.addEventListener('open',()=>{clearTimeout(timeout);resolve()},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('cTrader WebSocket connection failed'))},{once:true});
   });
   this.ws=ws;
   ws.addEventListener('message',(event:MessageEvent)=>{
    let reply:Reply;try{reply=JSON.parse(String(event.data))}catch{return}
    if(reply.payloadType===2131&&reply.payload){
      const p=reply.payload,account=String(p.ctidTraderAccountId||''),symbol=String(p.symbolId||'');
      const k=account+':'+symbol,previous=this.spots.get(k);
      const bid=Number(p.bid)/100000||previous?.bid||0,ask=Number(p.ask)/100000||previous?.ask||0;
      const rawTime=Number(p.timestamp||Date.now());const when=rawTime<1e12?rawTime*1000:rawTime;
      if(bid>0&&ask>=bid&&Number.isFinite(when))this.spots.set(k,{bid,ask,receivedAt:Date.now(),timestamp:when});
      return;
    }
    if(reply.payloadType===2147||reply.payloadType===2164){const account=String(reply.payload?.ctidTraderAccountId||'');for(const name of [...this.authenticated])if(!account||name.startsWith(account+':'))this.authenticated.delete(name);this.subscriptions.clear();this.spots.clear();return}
    const id=String(reply.clientMsgId||'');
    const waiter=this.waiters.get(id);if(!waiter)return;
    clearTimeout(waiter.timer);this.waiters.delete(id);
    if(reply.payloadType===2142||reply.payloadType===50)waiter.reject(Error('cTrader: '+String(reply.payload?.errorCode||reply.payload?.description||'request rejected')));
    else waiter.resolve(reply);
   });
   ws.addEventListener('close',()=>{if(this.ws===ws)this.close('cTrader disconnected. Request state is uncertain; reconcile before submitting orders.')});
   ws.addEventListener('error',()=>{if(this.ws===ws)this.close('cTrader socket error. Request state is uncertain.')});
   this.heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN){try{ws.send(encode({payloadType:51,clientMsgId:'hb-'+Date.now(),payload:{}}))}catch{this.close('Heartbeat send failed')}}},10000);
   await this.send(2100,{clientId:this.env.CTRADER_CLIENT_ID,clientSecret:this.env.CTRADER_SECRET_KEY},2101);
  })();
  try{await this.connecting}catch(e){this.close('cTrader authentication failed');throw e}finally{this.connecting=null}
 }
 private async send(payloadType:number,payload:Record<string,any>,expected:number){
  if(!this.ws||this.ws.readyState!==WebSocket.OPEN)throw Error('cTrader connection is not active');
  const clientMsgId='tv-'+Date.now().toString(36)+'-'+(++this.sequence).toString(36);
  return new Promise<Reply>((resolve,reject)=>{
   const timer=setTimeout(()=>{this.waiters.delete(clientMsgId);reject(Error('cTrader response timeout'))},16000);
   this.waiters.set(clientMsgId,{resolve,reject,timer});
   try{this.ws!.send(encode({clientMsgId,payloadType,payload}))}catch(e){clearTimeout(timer);this.waiters.delete(clientMsgId);reject(Error('cTrader send failed'))}
  }).then(reply=>{if(reply.payloadType!==expected)throw Error('Unexpected cTrader response type '+reply.payloadType);return reply});
 }
 private async account(accountId:string,token:string){
  const fingerprint=accountId+':'+token;
  if(this.authenticated.has(fingerprint))return;
  const existing=this.authenticating.get(fingerprint);if(existing)return existing;
  const promise=this.send(2102,{ctidTraderAccountId:accountId,accessToken:token},2103).then(()=>{this.authenticated.add(fingerprint)});
  this.authenticating.set(fingerprint,promise);
  try{await promise}finally{this.authenticating.delete(fingerprint)}
 }

 private async quote(accountId:string,symbolId:string,token:string){
  await this.account(accountId,token);
  const key=accountId+':'+symbolId;
  if(!this.subscriptions.has(key)){
   await this.send(2127,{ctidTraderAccountId:accountId,symbolId:[symbolId],subscribeToSpotTimestamp:true},2128);
   this.subscriptions.add(key);
  }
  for(let i=0;i<12;i++){
   const q=this.spots.get(key);
   if(q&&Date.now()-q.receivedAt<=5000&&Date.now()-q.timestamp<=5000&&q.bid>0&&q.ask>=q.bid)return q;
   await new Promise<void>(resolve=>setTimeout(resolve,250));
  }
  throw Error('No fresh broker bid/ask received. Trading blocked');
 }
 private async brokerState(accountId:string,token:string){
  await this.account(accountId,token);
  const [traderRes,reconcileRes,pnlRes]=await Promise.all([
   this.send(2121,{ctidTraderAccountId:accountId},2122),
   this.send(2124,{ctidTraderAccountId:accountId,returnProtectionOrders:false},2125),
   this.send(2187,{ctidTraderAccountId:accountId},2188)
  ]);
  const trader=traderRes.payload?.trader,r=reconcileRes.payload,up=pnlRes.payload;
  if(!trader||String(trader.ctidTraderAccountId)!==accountId||!Array.isArray(r?.position)||!Array.isArray(r?.order))throw Error('Account reconciliation incomplete');
  const pnlRows=Array.isArray(up?.positionUnrealizedPnL)?up.positionUnrealizedPnL:r.position.length===0?[]:null;
  if(!pnlRows)throw Error('Open position P&L is unavailable');
  const digits=Number(trader.moneyDigits);
  if(!Number.isInteger(digits)||digits<0||digits>12)throw Error('Invalid broker moneyDigits');
  const divisor=10**digits;
  const balance=Number(trader.balance)/divisor;
  const unrealized=pnlRows.reduce((n:number,p:any)=>n+Number(p.netUnrealizedPnL)/10**Number(up.moneyDigits??digits),0);
  const margin=r.position.reduce((n:number,p:any)=>n+Number(p.usedMargin||0)/10**Number(p.moneyDigits??digits),0);
  if(![balance,unrealized,margin].every(Number.isFinite))throw Error('Broker balance, margin or unrealized P&L unavailable');
  return {trader,positions:r.position as any[],orders:r.order as any[],balance,equity:balance+unrealized,freeMargin:balance+unrealized-margin,margin};
 }
 private async currencyConversion(accountId:string,token:string,firstAssetId:string,lastAssetId:string):Promise<number>{
  if(firstAssetId===lastAssetId)return 1;
  const chain=await this.send(2118,{ctidTraderAccountId:accountId,firstAssetId,lastAssetId},2119);
  const symbols=chain.payload?.symbol;
  if(!Array.isArray(symbols)||symbols.length<1||symbols.length>6)throw Error('Broker conversion chain missing');
  const adjacency=new Map<string,{to:string,rate:number}[]>();
  const add=(a:string,b:string,rate:number)=>{const prev=adjacency.get(a)||[];prev.push({to:b,rate});adjacency.set(a,prev)};
  for(const sym of symbols){
   const a=String(sym.baseAssetId||''),b=String(sym.quoteAssetId||''),symbolId=String(sym.symbolId||'');
   if(!a||!b||!symbolId)throw Error('Incomplete broker conversion symbol');
   const q=await this.quote(accountId,symbolId,token);
   add(a,b,q.bid);add(b,a,1/q.ask);
  }
  const path=[{asset:firstAssetId,rate:1}],visited=new Set<string>();
  for(let i=0;i<path.length;i++){const current=path[i];if(current.asset===lastAssetId)return current.rate;if(visited.has(current.asset))continue;visited.add(current.asset);for(const edge of adjacency.get(current.asset)||[])if(!visited.has(edge.to))path.push({asset:edge.to,rate:current.rate*edge.rate})}
  throw Error('Broker currency conversion chain is not valid');
 }
 private async execute(body:any){
  const {accountId,accessToken,environment,plan}=body as {accountId:string;accessToken:string;environment:'demo'|'live';plan:any};
  if(environment==='demo'&&this.env.CTRADER_DEMO_TRADING_ENABLED!=='true'||environment==='live'&&this.env.CTRADER_LIVE_TRADING_ENABLED!=='true')throw Error('cTrader order execution is disabled');
  if(!plan||!/^tv-[A-Za-z0-9_-]{6,42}$/.test(String(plan.clientOrderId||''))||!['BUY','SELL'].includes(plan.side)||!/^[0-9]+$/.test(String(plan.symbolId))||!Number.isFinite(plan.stop)||!Number.isFinite(plan.target)||!Number.isFinite(plan.riskPercent)||!Number.isFinite(plan.maxSlippagePrice))throw Error('Invalid authorized order plan');
  const intentKey='intent:'+accountId,existing=await this.ctx.storage.get<any>(intentKey);
  if(existing)throw Error('Account has an unresolved/previous order intent. Reconciliation required before another entry');
  const state=await this.brokerState(accountId,accessToken);
  if(state.trader.accessRights!==0||state.trader.accountType===2||state.trader.isLimitedRisk===true)throw Error('Broker account has unsupported trading permissions or margin rules');
  if(state.positions.length||state.orders.length)throw Error('Existing account exposure or pending orders block new automated entries');
  const [symbols,details]=await Promise.all([
   this.send(2114,{ctidTraderAccountId:accountId,includeArchivedSymbols:false},2115),
   this.send(2116,{ctidTraderAccountId:accountId,symbolId:[plan.symbolId]},2117)
  ]);
  const light=(symbols.payload?.symbol as any[]|undefined)?.find(x=>String(x.symbolId)===plan.symbolId);
  const meta=(details.payload?.symbol as any[]|undefined)?.find(x=>String(x.symbolId)===plan.symbolId);
  if(!light||!meta||meta.tradingMode!==0&&meta.tradingMode!==undefined||plan.side==='SELL'&&meta.enableShortSelling===false)throw Error('Symbol is not available for opening trades');
  if(!Number.isInteger(Number(meta.minVolume))||!Number.isInteger(Number(meta.stepVolume))||!Number.isInteger(Number(meta.maxVolume)))throw Error('Incomplete symbol volume specifications');
  const q=await this.quote(accountId,plan.symbolId,accessToken);
  const currency=await this.currencyConversion(accountId,accessToken,String(light.quoteAssetId||''),String(state.trader.depositAssetId||''));
  const quoteAssetId=String(light.quoteAssetId||''),baseAssetId=String(light.baseAssetId||'');
  const assets=await this.send(2112,{ctidTraderAccountId:accountId},2113);
  const usd=(assets.payload?.asset as any[]|undefined)?.find(x=>String(x.name||x.displayName||'').toUpperCase()==='USD');
  const usdId=String(usd?.assetId||'');
  if(!quoteAssetId||!baseAssetId||!usdId)throw Error('Broker symbol or USD conversion asset unavailable');
  const usdToDeposit=await this.currencyConversion(accountId,accessToken,usdId,String(state.trader.depositAssetId||''));
  const baseToUsd=await this.currencyConversion(accountId,accessToken,baseAssetId,usdId);
  const fee=commissionPerUnitDeposit({commissionType:Number(meta.commissionType??0),
   preciseTradingCommissionRate:Number(meta.preciseTradingCommissionRate??0),
   preciseMinCommission:Number(meta.preciseMinCommission??0),
   minCommissionAsset:String(meta.minCommissionAsset||''),
   minCommissionType:Number(meta.minCommissionType??0),
   lotSize:Number(meta.lotSize),minVolume:Number(meta.minVolume),
   executionPrice:plan.side==='BUY'?q.ask:q.bid,quoteToDeposit:currency,usdToDeposit,baseToUsd});
  const relativeSL=Math.round(Math.abs((plan.side==='BUY'?q.ask:q.bid)-plan.stop)*1e5);
  const relativeTP=Math.round(Math.abs((plan.side==='BUY'?q.ask:q.bid)-plan.target)*1e5);
  if(!Number.isInteger(relativeSL)||!Number.isInteger(relativeTP)||relativeSL<=0||relativeTP<=0)throw Error('Invalid cTrader relative protective distances');
  const symbolDistance=Number(meta.distanceSetIn),minSL=Number(meta.slDistance||0),minTP=Number(meta.tpDistance||0);
  const floorSL=symbolDistance===2?(q.ask+q.bid)/2*minSL/10000:minSL/10**Number(meta.digits||5);
  const floorTP=symbolDistance===2?(q.ask+q.bid)/2*minTP/10000:minTP/10**Number(meta.digits||5);
  if((Number.isFinite(floorSL)&&Math.abs((plan.side==='BUY'?q.bid:q.ask)-plan.stop)<floorSL)||
     (Number.isFinite(floorTP)&&Math.abs((plan.side==='BUY'?q.bid:q.ask)-plan.target)<floorTP))throw Error('Stop/target distances violate broker minimum');

  const day=new Date().toISOString().slice(0,10),ledgerKey='risk:'+accountId;
  const previous=await this.ctx.storage.get<any>(ledgerKey);
  const ledger=previous&&previous.day===day?previous:{day,dayStartEquity:state.equity,peakEquity:Math.max(Number(previous?.peakEquity||0),state.equity)};
  ledger.peakEquity=Math.max(ledger.peakEquity,state.equity);
  await this.ctx.storage.put(ledgerKey,ledger);
  const risk:CTraderRiskInput={balance:state.balance,equity:state.equity,freeMargin:state.freeMargin,quoteToDeposit:currency,
   side:plan.side,bid:q.bid,ask:q.ask,stop:plan.stop,target:plan.target,riskPercent:plan.riskPercent,
   maxDailyLossPercent:Math.min(2,Number(plan.maxDailyLossPercent||2)),dailyStartEquity:ledger.dayStartEquity,
   maxDrawdownPercent:Math.min(5,Number(plan.maxDrawdownPercent||5)),peakEquity:ledger.peakEquity,
   maxSpreadPercent:Math.min(0.25,Number(plan.maxSpreadPercent||0.15)),minVolume:Number(meta.minVolume),
   maxVolume:Number(meta.maxVolume),stepVolume:Number(meta.stepVolume),maxSlippagePrice:plan.maxSlippagePrice,
   roundTripCommissionPerUnit:Math.max(fee,Number(plan.roundTripCommissionPerUnit||0)),
   openPositions:state.positions.length,pendingOrders:state.orders.length,maxPositions:1};
  const verdict=computeCTraderRisk(risk);
  if(!verdict.ok)throw Error(verdict.reason);
  const expected=await this.send(2139,{ctidTraderAccountId:accountId,symbolId:plan.symbolId,volume:[verdict.volume]},2140);
  const m=(expected.payload?.margin as any[]|undefined)?.find(x=>Number(x.volume)===verdict.volume);
  if(!m)throw Error('Broker expected-margin response did not match order volume');
  const used=Number(plan.side==='BUY'?m.buyMargin:m.sellMargin)/10**Number(expected.payload?.moneyDigits??state.trader.moneyDigits);
  if(!Number.isFinite(used)||used<=0||used>state.freeMargin*0.7)throw Error('Insufficient free margin after safety reserve');
  const entry=verdict.referenceEntry,slDistance=relativeSL,tpDistance=relativeTP;
  if(slDistance<=0||tpDistance<=0)throw Error('Invalid broker relative protection distances');
  const intent={clientOrderId:plan.clientOrderId,symbolId:plan.symbolId,stop:plan.stop,target:plan.target,side:plan.side,volume:verdict.volume,
   createdAt:Date.now(),status:'SUBMITTING',plannedRisk:verdict.riskDeposit,digits:Number(meta.digits)};
  await this.ctx.storage.put(intentKey,intent);
  const payload={ctidTraderAccountId:accountId,symbolId:plan.symbolId,orderType:1,tradeSide:plan.side==='BUY'?1:2,volume:verdict.volume,
   relativeStopLoss:slDistance,relativeTakeProfit:tpDistance,clientOrderId:plan.clientOrderId,label:plan.clientOrderId,comment:'Trading Vibes'};
  try{
   // A timeout never implies rejection: the persistent intent stays locked until reconciliation.
   await this.send(2106,payload,2126);
   const deadline=Date.now()+12000;let filled:any=null;
   while(Date.now()<deadline){
    const result=await this.send(2124,{ctidTraderAccountId:accountId,returnProtectionOrders:false},2125);
    const positions=result.payload?.position,orders=result.payload?.order;
    if(!Array.isArray(positions)||!Array.isArray(orders))throw Error('Cannot reconcile submitted order');
    const matching=positions.filter((p:any)=>p.tradeData?.label===plan.clientOrderId&&String(p.tradeData?.symbolId)===plan.symbolId);
    if(matching.length>1)throw Error('Multiple positions linked to one order intent');
    if(matching.length===1){filled=matching[0];break}
    if(orders.some((o:any)=>o.clientOrderId===plan.clientOrderId))throw Error('Unresolved working/partial order: entry locked');
    await new Promise<void>(resolve=>setTimeout(resolve,300));
   }
   if(!filled)throw Error('Order fill was not confirmed; intent locked for reconciliation');
   if(!cTraderProtectionValid(filled,{side:plan.side,stop:plan.stop,target:plan.target,digits:Number(meta.digits),volume:verdict.volume,symbolId:plan.symbolId})){
    await this.send(2110,{ctidTraderAccountId:accountId,positionId:filled.positionId,stopLoss:plan.stop,takeProfit:plan.target},2126);
    const recheck=await this.send(2124,{ctidTraderAccountId:accountId,returnProtectionOrders:false},2125);
    filled=(recheck.payload?.position as any[]|undefined)?.find(p=>String(p.positionId)===String(filled.positionId));
   }
   if(!cTraderProtectionValid(filled,{side:plan.side,stop:plan.stop,target:plan.target,digits:Number(meta.digits),volume:verdict.volume,symbolId:plan.symbolId})){
    // Never treat the position as safe when a protective order fails. Attempt an emergency close
    // against the exact position ID and confirmed filled volume; keep the intent locked either way.
    const id=String(filled?.positionId||''),vol=Number(filled?.tradeData?.volume);
    if(/^[0-9]+$/.test(id)&&Number.isInteger(vol)&&vol>0&&vol<=verdict.volume){
     try{await this.send(2111,{ctidTraderAccountId:accountId,positionId:id,volume:vol},2126)}
     catch{ /* Do not trust send outcomes: reconciliation is authoritative. */ }
     const final=await this.send(2124,{ctidTraderAccountId:accountId,returnProtectionOrders:false},2125);
     const stillOpen=(final.payload?.position as any[]|undefined)?.some(p=>String(p.positionId)===id);
     await this.ctx.storage.put(intentKey,{...intent,status:'EMERGENCY_CLOSE_ATTEMPTED',positionId:id,closeConfirmed:stillOpen===false});
    }
    throw Error('Protective SL/TP not confirmed. Emergency close attempted; reconcile broker position and closing deals before resuming');
   }
   await this.ctx.storage.put(intentKey,{...intent,status:'PROTECTED',positionId:String(filled.positionId),actualEntry:Number(filled.price),filledVolume:Number(filled.tradeData?.volume),confirmedAt:Date.now()});
   return {status:'PROTECTED_FILL',filled:true,protected:true,positionId:String(filled.positionId),volume:Number(filled.tradeData?.volume),actualEntry:Number(filled.price),plannedRisk:verdict.riskDeposit,clientOrderId:plan.clientOrderId};
  }catch(e){
   await this.ctx.storage.put(intentKey,{...intent,status:'UNCERTAIN',error:e instanceof Error?e.message:'Uncertain execution',updatedAt:Date.now()});
   throw Error('Execution uncertain, account locked: '+(e instanceof Error?e.message:'unknown error'));
  }
 }
 private async reconcileIntent(accountId:string,token:string){
  const key='intent:'+accountId,intent=await this.ctx.storage.get<any>(key),state=await this.brokerState(accountId,token);
  if(!intent)return {blocked:false,positions:state.positions.length,orders:state.orders.length,trades:((await this.ctx.storage.get<any[]>('trades:'+accountId))||[]).slice(-50)};
  const linked=state.positions.filter(p=>p.tradeData?.label===intent.clientOrderId);
  const resting=state.orders.filter(o=>o.clientOrderId===intent.clientOrderId);
  const tradesKey='trades:'+accountId;
  if(intent.status==='PROTECTED'&&linked.length===0&&resting.length===0&&state.positions.length===0&&state.orders.length===0&&/^[0-9]+$/.test(String(intent.positionId||''))){
   const response=await this.send(2179,{ctidTraderAccountId:accountId,positionId:intent.positionId,
    fromTimestamp:intent.createdAt-60000,toTimestamp:Date.now()},2180);
   if(response.payload?.hasMore===true||!Array.isArray(response.payload?.deal))throw Error('Closed broker deals not fully available. Entry remains locked.');
   const deals=response.payload.deal as any[],closing=deals.filter(d=>d.closePositionDetail&&Number(d.dealStatus)===2);
   if(!closing.length)throw Error('Broker has not confirmed a completed closing deal. Entry remains locked.');
   const realized=closing.reduce((total,d)=>{
    const c=d.closePositionDetail,digits=Number(c.moneyDigits??d.moneyDigits??state.trader.moneyDigits);
    const value=(Number(c.grossProfit||0)+Number(c.swap||0)+Number(c.commission||0)-Number(c.pnlConversionFee||0))/10**digits;
    if(!Number.isFinite(value))throw Error('Broker closing monetary data invalid');return total+value;
   },0);
   const old=(await this.ctx.storage.get<any[]>(tradesKey))||[];
   const completed={clientOrderId:intent.clientOrderId,positionId:intent.positionId,symbolId:intent.symbolId,
    filledVolume:intent.filledVolume,entry:intent.actualEntry,exit:closing.at(-1)?.executionPrice??null,
    pnl:realized,fee:closing.reduce((n,d)=>n+Math.abs(Number(d.commission||0))/10**Number(d.moneyDigits??state.trader.moneyDigits),0),
    openedAt:intent.createdAt,closedAt:Math.max(...closing.map(d=>Number(d.executionTimestamp))),deals:closing.length,
    reason:'Broker-confirmed closing deals'};
   await this.ctx.storage.put(tradesKey,[...old,completed].slice(-100));
   await this.ctx.storage.delete(key);
   return {blocked:false,closedTrade:completed,trades:[...old,completed].slice(-50),positions:0,orders:0};
  }
  if(linked.length!==1||resting.length||!cTraderProtectionValid(linked[0],{side:intent.side,stop:intent.stop,target:intent.target,
    digits:Number(intent.digits??5),volume:intent.volume,symbolId:intent.symbolId})){
   return {blocked:true,intent,positions:state.positions.length,orders:state.orders.length,requiresOperator:true,
    trades:((await this.ctx.storage.get<any[]>(tradesKey))||[]).slice(-50)};
  }
  const confirmed={...intent,status:'PROTECTED',positionId:String(linked[0].positionId),confirmedAt:Date.now()};
  await this.ctx.storage.put(key,confirmed);
  return {blocked:true,intent:confirmed,positions:state.positions.length,orders:state.orders.length,
   trades:((await this.ctx.storage.get<any[]>(tradesKey))||[]).slice(-50)};
 }

 async fetch(req:Request){
  if(req.method!=='POST')return Response.json({error:'POST required'},{status:405});
  try{
   const {environment,payloadType,payload,accountId,accessToken,mode,plan}=await req.json<any>();
   if(environment!=='demo'&&environment!=='live')throw Error('Invalid environment');
   if(!accessToken||typeof accessToken!=='string'||accessToken.length>4096)throw Error('Missing account token');
   if(mode!=='rpc'&&mode!=='quote'&&mode!=='conversion'&&mode!=='trade'&&mode!=='reconcile')throw Error('Unknown cTrader gateway operation');
   if((mode!=='rpc'||payloadType!==2149)&&!/^[0-9]{1,24}$/.test(String(accountId)))throw Error('Invalid account ID');
   if(this.ws&&this.environment!==environment)throw Error('Incorrect gateway environment');
   await this.connectBroker(environment);
   if(mode==='quote'){const value=await this.quote(String(accountId),String(payload?.symbolId),accessToken);return Response.json({payload:value})}
   if(mode==='conversion'){const rate=await this.currencyConversion(String(accountId),accessToken,String(payload?.firstAssetId),String(payload?.lastAssetId));return Response.json({payload:{rate,quoteTime:Date.now()}})}
   if(mode==='trade')return Response.json({payload:await this.serial(()=>this.execute({environment,accountId:String(accountId),accessToken,plan}))});
   if(mode==='reconcile')return Response.json({payload:await this.serial(()=>this.reconcileIntent(String(accountId),accessToken))});
   if(!READ_ONLY.has(payloadType))throw Error('This cTrader protocol request is not permitted');
   if(payloadType!==2149&&String(payload?.ctidTraderAccountId)!==String(accountId))throw Error('Account ID mismatch');
   if(payloadType!==2149)await this.account(String(accountId),accessToken);
   const params=payloadType===2149?{accessToken}:payload;
   if(payloadType===2137||payloadType===2145){const now=Date.now(),delay=Math.max(0,this.nextHistoryAt-now);this.nextHistoryAt=Math.max(now,this.nextHistoryAt)+250;if(delay)await new Promise<void>(resolve=>setTimeout(resolve,delay));}
   const reply=await this.send(payloadType,params,RESPONSES[payloadType]);
   return Response.json({payload:reply.payload||{}},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return Response.json({error:e instanceof Error?e.message:'cTrader gateway request failed'},{status:502})}
 }
}
export default {async fetch(req:Request,env:Env){
 if(!internalAuth(req.headers.get('Authorization')||'',env.CTRADER_GATEWAY_SECRET))return new Response('Unauthorized',{status:401});
 if(new URL(req.url).pathname==='/health')return Response.json({ready:Boolean(env.CTRADER_CLIENT_ID&&env.CTRADER_SECRET_KEY&&env.CTRADER_GATEWAY_SECRET&&env.CTRADER_GATEWAY_SECRET.length>=32),runtime:'ctrader-json-gateway',demoTradingEnabled:env.CTRADER_DEMO_TRADING_ENABLED==='true',liveTradingEnabled:env.CTRADER_LIVE_TRADING_ENABLED==='true'});
 const parts=new URL(req.url).pathname.split('/').filter(Boolean);
 if(parts.length===3&&parts[0]==='bots'&&/^[a-f0-9]{64}$/.test(parts[1])&&['deploy','pause','resume','stop','status','reconcile'].includes(parts[2])){
  const uid=req.headers.get('X-TV-UID');
  if(!uid||uid.length>128)return Response.json({error:'Missing authenticated backend user'},{status:403});
  if(req.method!==(parts[2]==='status'?'GET':'POST'))return new Response(null,{status:405});
  const content=req.method==='POST'?await req.text():undefined;
  if(content&&content.length>200000)return new Response(null,{status:413});
  return env.BOTS.get(env.BOTS.idFromName(parts[1])).fetch(new Request('https://bot/'+parts[2],{
   method:req.method,headers:{'X-TV-UID':uid,...(content===undefined?{}:{'Content-Type':'application/json'})},
   ...(content===undefined?{}:{body:content})}));
 }
 if(!['/rpc','/quote','/conversion','/trade','/reconcile'].includes(new URL(req.url).pathname)||req.method!=='POST')return Response.json({error:'Unknown route'},{status:404});
 const input=await req.text();if(input.length>35000)return new Response('Too large',{status:413});
 let requested:any;try{requested=JSON.parse(input)}catch{return new Response('Malformed JSON',{status:400})}
 requested.mode=new URL(req.url).pathname.slice(1);
 if(requested.environment!=='demo'&&requested.environment!=='live')return new Response('Invalid environment',{status:400});
 return env.GATEWAYS.get(env.GATEWAYS.idFromName('ctrader-'+requested.environment)).fetch(new Request('https://gateway/request',{method:'POST',body:JSON.stringify(requested),headers:{'Content-Type':'application/json'}}));
}} satisfies ExportedHandler<Env>;
