/** Deterministic market replay — completed-candle paper execution only.
 * No broker connectivity. Past bars are immutable; future bars are never exposed to the UI.
 * Trade fills use bid/ask estimates based on configurable spread and slippage.
 */
export type ReplayBar={time:number;open:number;high:number;low:number;close:number;volume?:number};
export type ReplaySide='BUY'|'SELL';
export type ReplayCosts={spread:number;slippage:number;feePerOunce:number;leverage:number};
export type ReplayPosition={id:string;side:ReplaySide;quantity:number;entry:number;stop:number;target:number;entryTime:number;entryIndex:number;entryFee:number};
export type ReplayTrade=ReplayPosition&{exit:number;exitTime:number;exitIndex:number;exitFee:number;gross:number;net:number;reason:'STOP'|'TARGET'|'MANUAL'|'SESSION_END';balanceAfter:number};
export type ReplaySession={index:number;initialBalance:number;balance:number;position:ReplayPosition|null;trades:ReplayTrade[]};
const finite=(value:number)=>Number.isFinite(value);
export const DEFAULT_REPLAY_COSTS:ReplayCosts={spread:0.25,slippage:0.05,feePerOunce:0.03,leverage:20};
export function validateReplayBars(bars:ReplayBar[]){
 let last=0;
 if(!Array.isArray(bars)||bars.length<2||bars.length>1500)throw Error('Choose a UTC day containing at least two valid M1 candles.');
 for(const bar of bars){
  if(!Number.isSafeInteger(bar.time)||bar.time<=last||bar.time%60!==0||
   ![bar.open,bar.high,bar.low,bar.close].every(v=>finite(v)&&v>0)||
   bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))
   throw Error('Historical candle integrity failed. Replay cannot start.');
  last=bar.time;
 }
 return bars;
}
export function validateReplayCosts(costs:ReplayCosts){
 if(!finite(costs.spread)||costs.spread<0||costs.spread>30||
  !finite(costs.slippage)||costs.slippage<0||costs.slippage>10||
  !finite(costs.feePerOunce)||costs.feePerOunce<0||costs.feePerOunce>5||
  !finite(costs.leverage)||costs.leverage<1||costs.leverage>100)throw Error('Choose valid replay transaction costs.');
}
export function beginReplay(bars:ReplayBar[],cursor:number,startingBalance=10000):ReplaySession{
 validateReplayBars(bars);
 if(!Number.isInteger(cursor)||cursor<0||cursor>=bars.length)throw Error('Replay start must be within available history.');
 if(!finite(startingBalance)||startingBalance<100||startingBalance>1e8)throw Error('Choose a starting balance between $100 and $100 million.');
 return {index:cursor,initialBalance:startingBalance,balance:startingBalance,position:null,trades:[]};
}
export const replayVisibleBars=(bars:ReplayBar[],state:ReplaySession)=>bars.slice(0,state.index+1);
export function replayMark(state:ReplaySession,bar:ReplayBar,costs:ReplayCosts){
 const p=state.position;
 if(!p)return {unrealized:0,equity:state.balance,marginUsed:0,liquidation:bar.close};
 const exit=p.side==='BUY'?bar.close-costs.slippage:bar.close+costs.spread+costs.slippage;
 const gross=(p.side==='BUY'?exit-p.entry:p.entry-exit)*p.quantity;
 return {unrealized:gross-p.quantity*costs.feePerOunce,equity:state.balance+gross-p.quantity*costs.feePerOunce,
   marginUsed:p.quantity*p.entry/costs.leverage,liquidation:exit};
}
export function replayEnter(state:ReplaySession,bars:ReplayBar[],side:ReplaySide,quantity:number,stopDistance:number,targetDistance:number,costs:ReplayCosts):ReplaySession{
 validateReplayCosts(costs);
 if(state.position)throw Error('Close your current position before opening another.');
 if(!['BUY','SELL'].includes(side)||!finite(quantity)||quantity<=0||quantity>10000||
   !finite(stopDistance)||stopDistance<=0||!finite(targetDistance)||targetDistance<=0)throw Error('Enter a positive trade size, stop distance and target distance.');
 const bar=bars[state.index];if(!bar)throw Error('No revealed candle at this time.');
 const entry=side==='BUY'?bar.close+costs.spread+costs.slippage:bar.close-costs.slippage;
 const fee=quantity*costs.feePerOunce;
 const margin=entry*quantity/costs.leverage;
 if(margin>state.balance-fee)throw Error('Insufficient available replay equity for this position and leverage.');
 const direction=side==='BUY'?1:-1;
 const position:ReplayPosition={id:'replay-'+bar.time+'-'+state.trades.length,side,quantity,entry,
  stop:entry-direction*stopDistance,target:entry+direction*targetDistance,entryTime:bar.time,entryIndex:state.index,entryFee:fee};
 if(position.stop<=0)throw Error('Your stop must be above zero.');
 return {...state,balance:state.balance-fee,position};
}
/** Revise protective orders at the current revealed price only; no retroactive fills. */
export function replayModifyPosition(state:ReplaySession,bars:ReplayBar[],costs:ReplayCosts,stop:number,target:number):ReplaySession{
 validateReplayCosts(costs);
 const position=state.position;if(!position)throw Error('No open position to manage.');
 if(!finite(stop)||!finite(target)||stop<=0||target<=0)throw Error('Enter valid positive stop and target prices.');
 const bar=bars[state.index];if(!bar)throw Error('No revealed candle to price the modification.');
 const currentBid=bar.close,currentAsk=bar.close+costs.spread;
 if(position.side==='BUY'&&!(stop<currentBid&&target>currentBid))
  throw Error('For a long trade, place the stop below current bid and target above it.');
 if(position.side==='SELL'&&!(stop>currentAsk&&target<currentAsk))
  throw Error('For a short trade, place the stop above current ask and target below it.');
 return {...state,position:{...position,stop,target}};
}
function finish(state:ReplaySession,bar:ReplayBar,costs:ReplayCosts,exit:number,reason:ReplayTrade['reason']):ReplaySession{
 const p=state.position;if(!p)return state;
 const exitFee=p.quantity*costs.feePerOunce;
 const gross=(p.side==='BUY'?exit-p.entry:p.entry-exit)*p.quantity;
 const newBalance=state.balance+gross-exitFee;
 const trade:ReplayTrade={...p,exit,exitTime:bar.time,exitIndex:state.index,exitFee,gross,
   net:gross-p.entryFee-exitFee,reason,balanceAfter:newBalance};
 return {...state,balance:newBalance,position:null,trades:[...state.trades,trade]};
}
export function replayClose(state:ReplaySession,bars:ReplayBar[],costs:ReplayCosts,reason:'MANUAL'|'SESSION_END'='MANUAL'):ReplaySession{
 validateReplayCosts(costs);
 if(!state.position)return state;
 const bar=bars[state.index];if(!bar)throw Error('No current candle.');
 const exit=state.position.side==='BUY'?bar.close-costs.slippage:bar.close+costs.spread+costs.slippage;
 return finish(state,bar,costs,exit,reason);
}
/** At next completed candle: stop first when both SL & TP are inside the same bar;
 * gaps beyond stop fill at the worse opening bid/ask; never grant optimistic OHLC ordering.
 */
export function replayStep(state:ReplaySession,bars:ReplayBar[],costs:ReplayCosts):ReplaySession{
 validateReplayCosts(costs);
 const nextIndex=state.index+1;
 if(nextIndex>=bars.length)return state;
 const bar=bars[nextIndex],position=state.position;
 let out:ReplaySession={...state,index:nextIndex};
 if(!position)return out;
 const spread=costs.spread,slip=costs.slippage;
 if(position.side==='BUY'){
  const openingBid=bar.open,lowBid=bar.low,highBid=bar.high;
  if(lowBid<=position.stop)out=finish(out,bar,costs,Math.min(position.stop,openingBid)-slip,'STOP');
  else if(highBid>=position.target)out=finish(out,bar,costs,position.target-slip,'TARGET');
 }else{
  const openingAsk=bar.open+spread,highAsk=bar.high+spread,lowAsk=bar.low+spread;
  if(highAsk>=position.stop)out=finish(out,bar,costs,Math.max(position.stop,openingAsk)+slip,'STOP');
  else if(lowAsk<=position.target)out=finish(out,bar,costs,position.target+slip,'TARGET');
 }
 if(out.index===bars.length-1&&out.position)out=replayClose(out,bars,costs,'SESSION_END');
 return out;
}
export function replayAdvance(state:ReplaySession,bars:ReplayBar[],costs:ReplayCosts,count=1):ReplaySession{
 if(!Number.isInteger(count)||count<1||count>1000)throw Error('Invalid replay step count');
 let next=state;for(let i=0;i<count&&next.index<bars.length-1;i++)next=replayStep(next,bars,costs);
 return next;
}
export function replayMetrics(state:ReplaySession,bars:ReplayBar[],costs:ReplayCosts){
 const winners=state.trades.filter(t=>t.net>0),losers=state.trades.filter(t=>t.net<0);
 const winGross=winners.reduce((n,t)=>n+t.net,0),lossGross=-losers.reduce((n,t)=>n+t.net,0);
 let high=state.initialBalance,maxDrawdown=0,streak=0,bestStreak=0;
 for(const t of state.trades){high=Math.max(high,t.balanceAfter);maxDrawdown=Math.max(maxDrawdown,100*(high-t.balanceAfter)/high);streak=t.net>0?streak+1:0;bestStreak=Math.max(bestStreak,streak);}
 const mark=replayMark(state,bars[state.index],costs);
 return {trades:state.trades.length,wins:winners.length,losses:losers.length,winRate:state.trades.length?100*winners.length/state.trades.length:0,
   net:state.balance-state.initialBalance,unrealized:mark.unrealized,equity:mark.equity,
   profitFactor:lossGross>0?winGross/lossGross:winGross>0?Infinity:0,
   maxDrawdown,bestStreak,returnPercent:100*(mark.equity-state.initialBalance)/state.initialBalance};
}
export function aggregateReplayBars(visible:ReplayBar[],minutes:1|5|15|60):ReplayBar[]{
 if(minutes===1)return visible;
 const seconds=minutes*60,groups=new Map<number,ReplayBar[]>();
 for(const b of visible){const time=Math.floor(b.time/seconds)*seconds;let arr=groups.get(time);if(!arr){arr=[];groups.set(time,arr)}arr.push(b)}
 return [...groups].map(([time,group])=>({time,open:group[0].open,high:Math.max(...group.map(x=>x.high)),low:Math.min(...group.map(x=>x.low)),close:group.at(-1)!.close}));
}
export function replayEMA(visible:ReplayBar[],period:number){
 const points:{time:number;value:number}[]=[];if(visible.length<period)return points;
 const alpha=2/(period+1);let ema=visible.slice(0,period).reduce((s,b)=>s+b.close,0)/period;
 points.push({time:visible[period-1].time,value:ema});
 for(const b of visible.slice(period)){ema=b.close*alpha+ema*(1-alpha);points.push({time:b.time,value:ema})}
 return points;
}
