// Pure, deterministic spot-paper execution. A Durable Object must persist the
// returned state atomically and serialize calls; this module places no orders.
export type PaperCandle = { time:number; open:number; high:number; low:number; close:number; volume:number };
export type PaperDecision = { action:'BUY'|'SELL'|'WAIT'; stopLoss?:number; takeProfit?:number; reason?:string };
export type PaperSpec = { baseDecimalPlaces:number; minBaseAmount:number; maxBaseAmount:number; minQuoteAmount:number; maxQuoteAmount:number };
export type PaperRisk = { allocation:number; riskPercent:number; dailyLossPercent:number; timeframeSeconds:number };
export type PaperState = {
  running:boolean; balance:number; lastCandle:number|null; day:string; dayStartBalance:number;
  pending:{stopLoss:number;takeProfit:number}|null;
  position:{quantity:number;entry:number;stopLoss:number;takeProfit:number}|null;
  lastSignal?:{action:'BUY'|'SELL'|'WAIT';candleTime:number;reason:string};
  resumeLatest?:boolean;
  lastResult:string;
};

export function processPaperCandle(previous:PaperState, candle:PaperCandle, decision:PaperDecision, spec:PaperSpec, risk:PaperRisk):PaperState {
  if (!Number.isSafeInteger(candle.time)||candle.time<=0||![candle.open,candle.high,candle.low,candle.close].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(candle.volume)||candle.volume<0||candle.high<Math.max(candle.open,candle.close)||candle.low>Math.min(candle.open,candle.close)||candle.high<candle.low) throw Error('Invalid candle');
  if (!Number.isSafeInteger(risk.timeframeSeconds)||risk.timeframeSeconds<=0||candle.time%risk.timeframeSeconds!==0) throw Error('Invalid timeframe');
  if (previous.lastCandle===candle.time) return previous;
  if (previous.lastCandle!==null&&candle.time!==previous.lastCandle+risk.timeframeSeconds&&!(previous.resumeLatest&&candle.time>previous.lastCandle)) throw Error('Paper runtime is missing candles or received an out-of-order candle');
  if (!['BUY','SELL','WAIT'].includes(decision?.action)) throw Error('Invalid strategy decision');
  if (![previous.balance,risk.allocation,risk.riskPercent,risk.dailyLossPercent,spec.minBaseAmount,spec.maxBaseAmount,spec.minQuoteAmount,spec.maxQuoteAmount].every(Number.isFinite)||previous.balance<0||risk.allocation<=0||risk.riskPercent<=0||risk.riskPercent>2||risk.dailyLossPercent<=0||risk.dailyLossPercent>10||spec.minBaseAmount<=0||spec.maxBaseAmount<spec.minBaseAmount||spec.minQuoteAmount<=0||spec.maxQuoteAmount<spec.minQuoteAmount||!Number.isInteger(spec.baseDecimalPlaces)||spec.baseDecimalPlaces<0||spec.baseDecimalPlaces>8) throw Error('Invalid paper limits or market specification');
  const state:PaperState = {...previous,pending:previous.pending&&{...previous.pending},position:previous.position&&{...previous.position}};
  state.resumeLatest=false;
  if(state.running)state.lastSignal={action:decision.action,candleTime:candle.time,reason:typeof decision.reason==='string'?decision.reason.slice(0,300):''};
  const day=new Date(candle.time*1000).toISOString().slice(0,10);
  if(state.day!==day){state.day=day;state.dayStartBalance=state.balance+(state.position?state.position.quantity*candle.open:0)}
  let closed=false;
  if(state.running&&state.pending&&!state.position){
    const {stopLoss,takeProfit}=state.pending;state.pending=null;
    // Cap the next trade at the remaining daily loss budget as well as the
    // per-trade budget. Price gaps can still exceed either simulated limit.
    const remainingDaily=Math.max(0,state.balance-state.dayStartBalance*(1-risk.dailyLossPercent/100));
    const riskBudget=Math.min(Math.min(state.balance,risk.allocation)*risk.riskPercent/100,remainingDaily);
    const price=candle.open;
    if(riskBudget<=0)state.lastResult='Daily paper loss limit reached';
    else if(!(stopLoss<price&&price<takeProfit)) state.lastResult='Entry skipped: opening price outside protective levels';
    else {
      const raw=Math.min(riskBudget/(price-stopLoss),Math.min(state.balance,risk.allocation,spec.maxQuoteAmount)/price,spec.maxBaseAmount);
      const scale=10**spec.baseDecimalPlaces, units=Math.floor(raw*scale), quantity=units/scale;
      if(!Number.isSafeInteger(units)||quantity<spec.minBaseAmount||quantity*price<spec.minQuoteAmount)state.lastResult='Entry skipped: below VALR market minimum';
      else{state.balance-=quantity*price;state.position={quantity,entry:price,stopLoss,takeProfit};state.lastResult='Paper BUY filled';}
    }
  } else if(!state.running) state.pending=null;
  if(state.position){
    const p=state.position;
    // If both levels are reached, use the stop first, matching backtest policy.
    const exit=candle.low<=p.stopLoss?Math.min(candle.open,p.stopLoss):candle.high>=p.takeProfit?p.takeProfit:null;
    if(exit!==null){state.balance+=p.quantity*exit;state.position=null;closed=true;state.lastResult=`Paper exit · ${exit===p.takeProfit?'target':'stop'}`;}
  }
  if(state.running&&!state.position&&!closed&&!state.pending){
    const equity=state.balance;
    if(state.dayStartBalance>0&&equity<=state.dayStartBalance*(1-risk.dailyLossPercent/100))state.lastResult='Daily paper loss limit reached';
    else if(decision.action==='SELL')state.lastResult='SELL short is unsupported in spot paper mode';
    else if(decision.action==='BUY'){
      const stop=decision.stopLoss,target=decision.takeProfit;
      if(typeof stop!=='number'||typeof target!=='number'||!Number.isFinite(stop)||!Number.isFinite(target)||!(stop>0&&stop<candle.close&&candle.close<target))state.lastResult='Signal rejected: invalid protective levels';
      else{state.pending={stopLoss:stop,takeProfit:target};state.lastResult='Paper BUY queued for next candle';}
    }
  }
  state.lastCandle=candle.time;
  return state;
}
