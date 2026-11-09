import type { Candle, Side, Trade } from './types';
import {nextOpenRewardGuard} from './entry-fill-guard.ts';

/** Evaluation assumptions are fixed to the user's Iron $1K Pro terms, not live account data. */
export const IRON_1K = Object.freeze({ startingBalance:1000, targetProfit:100, maxStaticLoss:50, maxDailyLoss:20 });
export type EvaluationStatus='passed'|'failed-daily'|'failed-total'|'not-passed';
export type EvaluationTrade=Trade&{ pnlUsd:number; balanceAfter:number; riskUsd:number };
export type EvaluationPoint={time:number;equity:number;balance:number;dailyLossUsed:number;drawdownUsed:number};
export type PropDAOSimulation={
 status:EvaluationStatus; reason:string; startingBalance:number; equity:number; balance:number;
 available:number; profit:number; profitTargetUsed:number; profitTargetRemaining:number;
 dailyLossUsed:number; dailyAllowance:number; drawdownUsed:number; maxObservedDrawdown:number; maxObservedDailyLoss:number;
 riskPercent:number; trades:EvaluationTrade[]; equityCurve:EvaluationPoint[];
 endedAt:number|null; endLabel:string; completedTrades:number;
};
/** Run a separate evaluation replay so breaching / passing stops subsequent orders.
 * Candle extrema enforce conservative limit checks when intrabar order is unknown.
 * This is a signal-level simulation, not verified exchange executions/margin.
 */
export function simulatePropDAO(candles:Candle[],decisions:any[],riskPercent=0.25,costs={spread:0,slippage:0,commissionR:0},configuredRR?:number):PropDAOSimulation {
 if(!Number.isFinite(riskPercent)||riskPercent<=0||riskPercent>2)throw Error('Evaluation risk must be between 0 and 2%.');
 if(!Object.values(costs).every(x=>Number.isFinite(x)&&x>=0))throw Error('Evaluation costs must be non-negative.');
 const initial=IRON_1K.startingBalance, riskUsd=initial*riskPercent/100;
 let balance:number=initial,equity:number=initial,dailyStart:number=initial,dayAllowance:number=IRON_1K.maxDailyLoss,highClosed:number=initial,day='',maxDaily=0,maxTotal=0;
 let status:EvaluationStatus='not-passed',reason='Profit target not reached in selected historical period.';
 let endedAt:number|null=null,position:({side:Side;entryTime:number;entry:number;stop:number;target:number;riskDistance:number;entryFeeR:number})|null=null;
 const trades:EvaluationTrade[]=[],equityCurve:EvaluationPoint[]=[];
 const limit=(value:number)=>Math.max(0,value);
 const assess=(time:number,probe:number)=>{
  equity=probe;
  const total=limit(initial-equity),daily=limit(highClosed-equity);
  maxTotal=Math.max(maxTotal,total);maxDaily=Math.max(maxDaily,daily);
  if(equity<=initial-IRON_1K.maxStaticLoss+1e-8){status='failed-total';reason='Static 5% drawdown limit was reached or exceeded.';}
  else if(equity<=highClosed-dayAllowance+1e-8){status='failed-daily';reason='Daily 2% loss limit was reached or exceeded.';}
  if(status!=='not-passed')endedAt=time;
 };
 const mark=(time:number)=>{
  equityCurve.push({time,equity,balance,dailyLossUsed:limit(highClosed-equity),drawdownUsed:limit(initial-equity)});
 };
 const pnlR=(p:NonNullable<typeof position>,price:number)=>((price-p.entry)*(p.side==='LONG'?1:-1)-costs.spread-2*costs.slippage)/p.riskDistance-costs.commissionR;
 const close=(p:NonNullable<typeof position>,c:Candle,price:number,why:Trade['reason'])=>{
  const r=pnlR(p,price),pnlUsd=r*riskUsd;balance+=pnlUsd;
  highClosed=Math.max(highClosed,balance);
  trades.push({id:trades.length+1,side:p.side,entryTime:p.entryTime,exitTime:c.time,entry:p.entry,exit:price,stop:p.stop,target:p.target,reason:why,pnl:r,pnlUsd,balanceAfter:balance,riskUsd});
  equity=balance;
 };
 for(let i=0;i<candles.length;i++){
  const c=candles[i];const today=new Date(c.time*1000).toISOString().slice(0,10);
  if(today!==day){day=today;dailyStart=equity;dayAllowance=Math.max(0,dailyStart*0.02);highClosed=balance;}
  let closed=false;
  if(position){
   const p=position;
   // Worst-case within each OHLC bar is checked before any profit: avoid hindsight.
   const stopHit=p.side==='LONG'?c.low<=p.stop:c.high>=p.stop;
   const targetHit=p.side==='LONG'?c.high>=p.target:c.low<=p.target;
   // A protective stop caps modeled intrabar loss at its stop price,
   // except when the candle opens through the stop (gap-through).
   const worst=stopHit?(p.side==='LONG'?Math.min(c.open,p.stop):Math.max(c.open,p.stop)):(p.side==='LONG'?c.low:c.high);
   const adverse=pnlR(p,worst)*riskUsd+balance;
   assess(c.time,adverse);
   if(status!=='not-passed'){close(p,c,worst,'signal');position=null;equity=balance;mark(c.time);break;}
   if(stopHit||targetHit){
    const price=stopHit?(p.side==='LONG'?Math.min(c.open,p.stop):Math.max(c.open,p.stop)):p.target;
    close(p,c,price,stopHit?'stop':'target');position=null;closed=true;
    assess(c.time,balance);
   }else assess(c.time,balance+pnlR(p,c.close)*riskUsd);
   if(status!=='not-passed'){mark(c.time);break;}
   if(closed && balance>=initial+IRON_1K.targetProfit){status='passed';reason='Closed-trade balance reached the 10% profit target without a recorded breach.';endedAt=c.time;mark(c.time);break;}
  }
  if(i>0&&!position&&!closed){
   const signal=decisions[i-1],action=signal?.action;
   if(action==='BUY'||action==='SELL'){
    const long=action==='BUY',entry=c.open,stop=Number(signal.stopLoss),target=Number(signal.takeProfit),prev=candles[i-1].close;
    const valid=Number.isFinite(stop)&&Number.isFinite(target)&&stop>0&&target>0&&(long?stop<prev&&target>prev&&stop<entry&&entry<target:stop>prev&&target<prev&&target<entry&&entry<stop);
    if(valid&&!nextOpenRewardGuard(prev,entry,stop,target,action,configuredRR))position={side:long?'LONG':'SHORT',entryTime:c.time,entry,stop,target,riskDistance:Math.abs(entry-stop),entryFeeR:0};
   }
  }
  if(position&&position.entryTime===c.time){
   const p=position;
   const stopCrossed=p.side==='LONG'?c.low<=p.stop:c.high>=p.stop;
   const worst=stopCrossed?(p.side==='LONG'?Math.min(c.open,p.stop):Math.max(c.open,p.stop)):(p.side==='LONG'?c.low:c.high);
   assess(c.time,balance+pnlR(p,worst)*riskUsd);
   if(status!=='not-passed'){close(p,c,worst,'signal');position=null;equity=balance;mark(c.time);break;}
   const hitStop=p.side==='LONG'?c.low<=p.stop:c.high>=p.stop;
   const hitTarget=p.side==='LONG'?c.high>=p.target:c.low<=p.target;
   if(hitStop||hitTarget){
    close(p,c,hitStop?p.stop:p.target,hitStop?'stop':'target');position=null;closed=true;
    assess(c.time,balance);
   }else assess(c.time,balance+pnlR(p,c.close)*riskUsd);
   if(status!=='not-passed'){mark(c.time);break;}
   if(closed&&balance>=initial+IRON_1K.targetProfit){status='passed';reason='Closed-trade balance reached the 10% profit target without a recorded breach.';endedAt=c.time;mark(c.time);break;}
  }
  if(!position)equity=balance;
  mark(c.time);
 }
 if(position&&candles.length&&status==='not-passed'){
  const last=candles[candles.length-1];
  close(position,last,last.close,'end');position=null;
  assess(last.time,balance);
  if(status==='not-passed'&&balance>=initial+IRON_1K.targetProfit){status='passed';reason='Balance reached the target at the historical test endpoint; final-position closure is simulated.';endedAt=last.time;}
  mark(last.time);
 }
 const last=equityCurve.at(-1);
 return {
  status,reason,startingBalance:initial,equity,balance,available:equity,
  profit:balance-initial,profitTargetUsed:Math.max(0,(balance-initial)/initial*100),
  profitTargetRemaining:Math.max(0,initial+IRON_1K.targetProfit-balance),
  dailyLossUsed:last?.dailyLossUsed??0,dailyAllowance:dayAllowance,drawdownUsed:last?.drawdownUsed??0,
  maxObservedDrawdown:maxTotal,maxObservedDailyLoss:maxDaily,
  riskPercent,trades,equityCurve,endedAt,
  endLabel:endedAt?new Date(endedAt*1000).toISOString():'Historical period ended',completedTrades:trades.length
 };
}
