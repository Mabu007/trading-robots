import type {BrokerTradeEvidence,TradeLink} from './trade-attribution.ts';
import type {ExecutionEvent} from '../shared/propdao-execution-journal.ts';

export type EvidenceCandle={time:number;open:number;high:number;low:number;close:number};
export type DecisionEvidence={accountId:string;botId:string;grantId:string;codeHash:string|null;
 candleClose:number;time:number;action:string;reason:string;checks:unknown[];
 recentCandles?:EvidenceCandle[];executionTimeframe?:string;marketSource?:string};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const rounded=(v:number)=>Number(v.toFixed(6));
export function averageTrueRange(candles:EvidenceCandle[],period=14):number|null{
 const good=candles.filter(c=>[c.open,c.high,c.low,c.close].every(finite)&&
  c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
 if(good.length<period+1)return null;
 const ranges:number[]=[];
 for(let i=1;i<good.length;i++){
  const c=good[i],prev=good[i-1];
  ranges.push(Math.max(c.high-c.low,Math.abs(c.high-prev.close),Math.abs(c.low-prev.close)));
 }
 const subset=ranges.slice(-period);
 return subset.length===period?rounded(subset.reduce((a,b)=>a+b,0)/period):null;
}
/** Only measurements actually supported by the archived entry evidence.
 * A hit SL never, by itself, proves the stop was too tight. */
export function diagnoseBrokerTrade(trade:BrokerTradeEvidence,link:TradeLink,
 event?:ExecutionEvent|null,decision?:DecisionEvidence|null){
 const stop=finite(event?.stopPrice)?event!.stopPrice!:null;
 const entry=finite(event?.entryPrice)?event!.entryPrice!:trade.entry;
 const stopDistance=stop!==null&&finite(entry)?Math.abs(entry-stop):null;
 const candles=Array.isArray(decision?.recentCandles)?decision.recentCandles:[];
 const atr=averageTrueRange(candles);
 const direction=trade.side==='BUY'?1:-1;
 const highs=candles.slice(0,-1).map(c=>c.high).filter(finite);
 const lows=candles.slice(0,-1).map(c=>c.low).filter(finite);
 const structure=trade.side==='BUY'?(lows.length?Math.min(...lows):null):
  highs.length?Math.max(...highs):null;
 const structuralDistance=structure!==null?Math.max(0, direction*(entry-structure)):null;
 const stopToAtr=atr!==null&&atr>0&&stopDistance!==null?rounded(stopDistance/atr):null;
 const risk=finite(event?.riskBudgetUsd)&&event!.riskBudgetUsd!>0?event!.riskBudgetUsd!:null;
 const realizedR=risk!==null?rounded(trade.pnl/risk):null;
 const isStop=/^(?:SL|STOP[_ -]?LOSS|STOPPED[_ -]?OUT)$/i.test(trade.reason);
 const stopExecutionDifference=isStop&&stop!==null?
  rounded(direction*(stop-trade.exit)):null;
 const observations:string[]=[];
 if(stopDistance!==null)observations.push('Original intended stop distance was recorded by the Worker.');
 else observations.push('Original stop price is unavailable; stop tightness cannot be established.');
 if(stopToAtr!==null)observations.push('Stop distance is '+stopToAtr+' times the captured entry-time ATR.');
 else observations.push('Insufficient contemporaneous candles for an ATR-relative stop assessment.');
 if(isStop)observations.push('Broker reports a stop-loss exit; this does not establish why the stop was reached.');
 if(link.confidence!=='verified')observations.push('Robot attribution is not exact; do not treat this as confirmed robot strategy performance.');
 return {tradeId:trade.id,accountId:trade.accountId,robotId:link.botId,
  attribution:link.attribution,confidence:link.confidence,
  entry:trade.entry,exit:trade.exit,side:trade.side,quantity:trade.qty,
  stopPrice:stop,stopDistance:stopDistance===null?null:rounded(stopDistance),
  stopDistancePercent:stopDistance===null?null:rounded(100*stopDistance/entry),
  atr14:atr,stopDistanceAtr:stopToAtr,structureReferencePrice:structure,
  distanceToStructure:structuralDistance===null?null:rounded(structuralDistance),
  stopBeyondStructure:structure===null||stop===null?null:
   trade.side==='BUY'?stop<structure:stop>structure,
  stopExecutionDifference,reportedPnl:trade.pnl,brokerFee:trade.fee,
  brokerFeeTreatment:'Whether fees are already included in broker P/L is unverified; no deduction performed',
  intendedRiskUsd:risk,realizedR,executionTimeframe:decision?.executionTimeframe??null,
  signalReason:decision?.reason??null,signalChecks:decision?.checks??null,
  marketEvidenceSource:decision?.marketSource??null,
  exactStrategyCodeHash:link.strategyCodeHash??decision?.codeHash??null,
  evidenceCoverage:{entryEvent:Boolean(event),decision:Boolean(decision),
   candleCount:candles.length,atrAvailable:atr!==null},
  observations,
  hypothesis:stopToAtr!==null&&stopToAtr<0.7?
   'The stop is relatively small versus measured entry-time volatility. Test alternatives; this alone does not prove the loss was caused by stop placement.':
   stopToAtr!==null?'Entry-time volatility ratio available; assess repeated outcomes before recommending changes.':
   'Insufficient evidence to determine whether the stop was unusually tight.'};
}
export function summarizeDeterministicPerformance(trades:BrokerTradeEvidence[]){
 const ordered=[...trades].filter(t=>finite(t.pnl)&&finite(t.closedAt)).sort((a,b)=>Number(a.closedAt)-Number(b.closedAt));
 const wins=ordered.filter(t=>t.pnl>0),losses=ordered.filter(t=>t.pnl<0);
 const grossWins=wins.reduce((n,t)=>n+t.pnl,0);
 const grossLoss=-losses.reduce((n,t)=>n+t.pnl,0);
 let equity=0,peak=0,maxDrawdown=0,streak=0,maxLosingStreak=0;
 for(const t of ordered){
  equity+=t.pnl;peak=Math.max(peak,equity);
  maxDrawdown=Math.max(maxDrawdown,peak-equity);
  streak=t.pnl<0?streak+1:0;maxLosingStreak=Math.max(maxLosingStreak,streak);
 }
 const n=ordered.length;
 return {count:n,winRatePercent:n?rounded(wins.length*100/n):null,
  wins:wins.length,losses:losses.length,breakEven:n-wins.length-losses.length,
  averageWinner:wins.length?rounded(grossWins/wins.length):null,
  averageLoser:losses.length?rounded(-grossLoss/losses.length):null,
  profitFactor:grossLoss>0?rounded(grossWins/grossLoss):null,
  expectancyReportedCurrencyPerTrade:n?rounded(ordered.reduce((x,t)=>x+t.pnl,0)/n):null,
  maxClosedTradeDrawdownReportedCurrency:rounded(maxDrawdown),maxConsecutiveLosses:maxLosingStreak,
  pnlFeeCaveat:'Broker P/L fee inclusion unverified; values use broker-reported P/L without fee double subtraction.',
  coverage:'Closed trades only; no floating drawdown, unobserved trades or attribution assumptions.'};
}
