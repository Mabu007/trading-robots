import {brokerBacktestAssumptions,type CTraderSpecification} from './ctrader-monetary-backtest';
import type {Candle,Trade} from './types';
import type {MonetaryResult,MonetaryTrade} from './monetary-backtest';
export type CTraderTick={timeMs:number;price:number};
export function simulateCTraderTickReplay(candles:Candle[],decisions:any[],bids:CTraderTick[],asks:CTraderTick[],
 startingBalance:number,riskPercent:number,spec:CTraderSpecification,slippage=0):MonetaryResult{
 const a=brokerBacktestAssumptions(spec,slippage);
 if(!candles.length||decisions.length!==candles.length||!Number.isFinite(startingBalance)||startingBalance<=0||
   !Number.isFinite(riskPercent)||riskPercent<=0||riskPercent>2)throw Error('Invalid tick replay input');
 const ordered=[...bids.map(t=>({...t,type:'bid' as const})),...asks.map(t=>({...t,type:'ask' as const}))].sort((x,y)=>x.timeMs-y.timeMs||(x.type==='bid'?-1:1));
 if(!ordered.length)throw Error('Historical tick coverage is empty');
 let equity=startingBalance,peak=equity,maxDrawdown=0,maxDrawdownPercent=0;
 const trades:MonetaryTrade[]=[],rejected:MonetaryResult['rejected']=[],curve:MonetaryResult['equity']=[{time:candles[0].time,value:equity}];
 let bid=0,ask=0,lastBidTime=-Infinity,lastAskTime=-Infinity;
 let pending:{side:'LONG'|'SHORT';stop:number;target:number;time:number}|null=null;
 let position:{side:'LONG'|'SHORT';entry:number;entryTime:number;stop:number;target:number;units:number;volume:number;risk:number;intendedRisk:number;entrySpread:number}|null=null;
 let cursor=0,scheduledFor=-1;
 const tickInRange=(tick:CTraderTick)=>Number.isSafeInteger(tick.timeMs)&&Number.isFinite(tick.price)&&tick.price>0;
 if(!ordered.every(tickInRange))throw Error('Malformed broker tick data');
 const durations=candles.slice(1).map((c,i)=>c.time-candles[i].time).filter(v=>Number.isSafeInteger(v)&&v>0);
 const period=durations.length?Math.min(...durations):60;
 if(period<60||period>86400)throw Error('Unsupported broker candle period');
 const start=candles[0].time*1000,last=(candles.at(-1)!.time+period)*1000;
 const unitsStep=spec.stepVolume/100,minUnits=spec.minVolume/100,maxUnits=spec.maxVolume/100;
 const observe=(value:number)=>{peak=Math.max(peak,value);const dd=peak-value;maxDrawdown=Math.max(maxDrawdown,dd);maxDrawdownPercent=Math.max(maxDrawdownPercent,peak>0?dd/peak*100:0)};
 const close=(timeMs:number,rawExit:number,reason:Trade['reason'])=>{
  if(!position)return;
  const pos=position,dir=pos.side==='LONG'?1:-1;
  const exit=reason==='target'?pos.target:rawExit-dir*slippage;
  const fee=spec.roundTripCommissionPerUnit*pos.units;
  const pnlMoney=(exit-pos.entry)*dir*pos.units*spec.quoteToDeposit-fee;
  const cashRisk=pos.risk;
  const pnl=cashRisk>0?pnlMoney/cashRisk:0;
  equity+=pnlMoney;observe(equity);
  const closed:MonetaryTrade={id:trades.length+1,side:pos.side,entryTime:pos.entryTime,exitTime:Math.floor(timeMs/1000),
   entry:pos.entry,exit,stop:pos.stop,target:pos.target,reason,pnl,volume:pos.volume,
   intendedRisk:pos.intendedRisk,riskAtStop:cashRisk,pnlZar:pnlMoney,equityAfter:equity,
   spreadZar:pos.entrySpread*pos.units*spec.quoteToDeposit,slippageZar:2*slippage*pos.units*spec.quoteToDeposit,
   commissionZar:fee};
  trades.push(closed);curve.push({time:Math.floor(timeMs/1000),value:equity,tradeId:closed.id});position=null;
 };
 for(const tick of ordered){
  if(tick.timeMs<start||tick.timeMs>=last)continue;
  if(tick.type==='bid'){bid=tick.price;lastBidTime=tick.timeMs}else{ask=tick.price;lastAskTime=tick.timeMs}
  if(!(bid>0&&ask>=bid)||tick.timeMs-lastBidTime>10000||tick.timeMs-lastAskTime>10000)continue;
  while(cursor+1<candles.length&&tick.timeMs>=candles[cursor+1].time*1000)cursor++;
  if(cursor!==scheduledFor){
   scheduledFor=cursor;
   if(cursor>0){
    const decision=decisions[cursor-1];
    pending=(decision?.action==='BUY'||decision?.action==='SELL')?{
     side:decision.action==='BUY'?'LONG':'SHORT',stop:Number(decision.stopLoss),target:Number(decision.takeProfit),time:candles[cursor].time}:null;
   }
  }
  if(position){
   const pos=position,price=pos.side==='LONG'?bid:ask;
   const stop=pos.side==='LONG'?price<=pos.stop:price>=pos.stop;
   const target=pos.side==='LONG'?price>=pos.target:price<=pos.target;
   if(stop||target){close(tick.timeMs,stop?price:pos.target,stop?'stop':'target');pending=null;continue}
   const unrealized=(price-pos.entry)*(pos.side==='LONG'?1:-1)*pos.units*spec.quoteToDeposit-
    spec.roundTripCommissionPerUnit*pos.units;
   observe(equity+unrealized);
   continue;
  }
  if(!pending)continue;
  const dir=pending.side==='LONG'?1:-1,entry=(dir>0?ask:bid)+dir*slippage;
  if(!Number.isFinite(pending.stop)||!Number.isFinite(pending.target)||
   pending.stop<=0||pending.target<=0||dir*(entry-pending.stop)<=0||dir*(pending.target-entry)<=0){
   rejected.push({time:pending.time,reason:'Invalid broker tick entry relative to stop/target'});pending=null;continue;
  }
  const stopPerUnit=(Math.abs(entry-pending.stop)+slippage)*spec.quoteToDeposit+spec.roundTripCommissionPerUnit;
  const budget=equity*riskPercent/100,rawUnits=budget/stopPerUnit;
  const units=Math.min(maxUnits,Math.floor((rawUnits+1e-10)/unitsStep)*unitsStep);
  const margin=entry*units*spec.quoteToDeposit/(a.leverage||1);
  if(units<minUnits||margin>equity*0.7){
   rejected.push({time:pending.time,reason:units<minUnits?'Risk is below the broker minimum volume':'Broker margin reserve exceeded'});pending=null;continue;
  }
  position={side:pending.side,entry,entryTime:Math.floor(tick.timeMs/1000),stop:pending.stop,target:pending.target,
   units,volume:units/(spec.lotSize/100),risk:stopPerUnit*units,intendedRisk:budget,entrySpread:ask-bid};
  pending=null;
 }
 if(position&&bid>0&&ask>0){const t=ordered.at(-1)!;close(Math.min(t.timeMs,last),position.side==='LONG'?bid:ask,'end')}
 return {startingBalance,endingBalance:equity,netProfit:equity-startingBalance,returnPercent:(equity-startingBalance)/startingBalance*100,
  maxDrawdown,maxDrawdownPercent,trades,rejected,equity:curve,assumptions:a,riskPercent,currency:spec.depositCurrency,
  source:'broker-tick-replay'};
}
