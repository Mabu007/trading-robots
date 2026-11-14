/** Deterministic market replay — completed-candle paper execution only.
 * No broker connectivity. Past bars are immutable; future bars are never exposed to the UI.
 * Trade fills use bid/ask estimates based on configurable spread and slippage.
 */
export type ReplayBar={time:number;open:number;high:number;low:number;close:number;volume?:number};
export type ReplaySide='BUY'|'SELL';
export type ReplayCosts={spread:number;slippage:number;feePerOunce:number;leverage:number};
export type ReplayPosition={id:string;side:ReplaySide;quantity:number;entry:number;stop:number;target:number;entryTime:number;entryIndex:number;entryFee:number};
export type ReplayTrade=ReplayPosition&{exit:number;exitTime:number;exitIndex:number;exitFee:number;gross:number;net:number;reason:'STOP'|'TARGET'|'MANUAL'|'SESSION_END';balanceAfter:number};
export type ReplayPending={side:ReplaySide;type:'limit'|'stop';price:number;quantity:number;stopDistance:number;targetDistance:number};
export type ReplaySession={index:number;initialBalance:number;balance:number;position:ReplayPosition|null;positions?:ReplayPosition[];sequence?:number;trades:ReplayTrade[];pending?:ReplayPending|null};
const finite=(value:number)=>Number.isFinite(value);
export const DEFAULT_REPLAY_COSTS:ReplayCosts={spread:0.25,slippage:0.05,feePerOunce:0.03,leverage:20};
export function validateReplayBars(bars:ReplayBar[]){
 let last=0;
 if(!Array.isArray(bars)||bars.length<2||bars.length>12000)throw Error('Choose a historical range containing at least two valid M1 candles (maximum 12,000).');
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
 return {index:cursor,initialBalance:startingBalance,balance:startingBalance,position:null,positions:[],sequence:0,trades:[]};
}
export const replayPositions=(state:ReplaySession):ReplayPosition[]=>Array.isArray(state.positions)?state.positions:state.position?[state.position]:[];
function withPositions(state:ReplaySession,positions:ReplayPosition[]):ReplaySession{return {...state,positions,position:positions[0]||null};}
export const replayVisibleBars=(bars:ReplayBar[],state:ReplaySession)=>bars.slice(0,state.index+1);
export function replayMark(state:ReplaySession,bar:ReplayBar,costs:ReplayCosts){
 let unrealized=0,marginUsed=0;
 for(const p of replayPositions(state)){
  const exit=p.side==='BUY'?bar.close-costs.slippage:bar.close+costs.spread+costs.slippage;
  unrealized+=(p.side==='BUY'?exit-p.entry:p.entry-exit)*p.quantity-p.quantity*costs.feePerOunce;
  marginUsed+=p.quantity*p.entry/costs.leverage;
 }
 return {unrealized,equity:state.balance+unrealized,marginUsed,liquidation:bar.close};
}
function nextId(state:ReplaySession,time:number){const sequence=(state.sequence??state.trades.length+replayPositions(state).length)+1;return {sequence,id:'replay-'+time+'-'+sequence};}
export function replayEnter(state:ReplaySession,bars:ReplayBar[],side:ReplaySide,quantity:number,stopDistance:number,targetDistance:number,costs:ReplayCosts):ReplaySession{
 validateReplayCosts(costs);
 if(!['BUY','SELL'].includes(side)||!finite(quantity)||quantity<=0||quantity>10000||!finite(stopDistance)||stopDistance<=0||!finite(targetDistance)||targetDistance<=0)throw Error('Enter a positive trade size, stop distance and target distance.');
 const bar=bars[state.index];if(!bar)throw Error('No revealed candle at this time.');
 const entry=side==='BUY'?bar.close+costs.spread+costs.slippage:bar.close-costs.slippage,fee=quantity*costs.feePerOunce,margin=entry*quantity/costs.leverage,mark=replayMark(state,bar,costs);
 if(margin>mark.equity-mark.marginUsed-fee)throw Error('Insufficient available replay equity for this position and leverage.');
 const direction=side==='BUY'?1:-1,identity=nextId(state,bar.time);
 const position:ReplayPosition={id:identity.id,side,quantity,entry,stop:entry-direction*stopDistance,target:entry+direction*targetDistance,entryTime:bar.time,entryIndex:state.index,entryFee:fee};
 if(position.stop<=0)throw Error('Your stop must be above zero.');
 return withPositions({...state,sequence:identity.sequence,balance:state.balance-fee},[...replayPositions(state),position]);
}
export function replayPlacePending(state:ReplaySession,bars:ReplayBar[],side:ReplaySide,type:'limit'|'stop',price:number,quantity:number,stopDistance:number,targetDistance:number,costs:ReplayCosts):ReplaySession{
 validateReplayCosts(costs);
 if(state.pending)throw Error('Cancel your existing pending order first.');
 const bar=bars[state.index];if(!bar||!finite(price)||price<=0||!finite(quantity)||quantity<=0||quantity>10000||!finite(stopDistance)||stopDistance<=0||!finite(targetDistance)||targetDistance<=0)throw Error('Enter a valid order price, size, stop and target.');
 if(!['BUY','SELL'].includes(side)||!['limit','stop'].includes(type))throw Error('Choose a valid pending order.');
 const current=side==='BUY'?bar.close+costs.spread:bar.close;
 if(type==='limit'&&(side==='BUY'?price>=current:price<=current))throw Error('A buy limit must be below the current ask; a sell limit must be above the current bid.');
 if(type==='stop'&&(side==='BUY'?price<=current:price>=current))throw Error('A buy stop must be above the current ask; a sell stop must be below the current bid.');
 const mark=replayMark(state,bar,costs);if(price*quantity/costs.leverage+quantity*costs.feePerOunce>mark.equity-mark.marginUsed)throw Error('Insufficient replay equity for this pending order.');
 return {...state,pending:{side,type,price,quantity,stopDistance,targetDistance}};
}
export function replayCancelPending(state:ReplaySession):ReplaySession{return state.pending?{...state,pending:null}:state;}
export function replayModifyPosition(state:ReplaySession,bars:ReplayBar[],costs:ReplayCosts,stop:number,target:number,positionId?:string):ReplaySession{
 validateReplayCosts(costs);
 const positions=replayPositions(state),position=positionId?positions.find(p=>p.id===positionId):positions[0];if(!position)throw Error('No open position to manage.');
 if(!finite(stop)||!finite(target)||stop<=0||target<=0)throw Error('Enter valid positive stop and target prices.');
 const bar=bars[state.index];if(!bar)throw Error('No revealed candle to price the modification.');
 const currentBid=bar.close,currentAsk=bar.close+costs.spread;
 if(position.side==='BUY'&&!(stop<currentBid&&target>currentBid))throw Error('For a long trade, place the stop below current bid and target above it.');
 if(position.side==='SELL'&&!(stop>currentAsk&&target<currentAsk))throw Error('For a short trade, place the stop above current ask and target below it.');
 return withPositions(state,positions.map(p=>p.id===position.id?{...p,stop,target}:p));
}
function finish(state:ReplaySession,bar:ReplayBar,costs:ReplayCosts,exit:number,reason:ReplayTrade['reason'],id:string):ReplaySession{
 const positions=replayPositions(state),p=positions.find(item=>item.id===id);if(!p)return state;
 const exitFee=p.quantity*costs.feePerOunce,gross=(p.side==='BUY'?exit-p.entry:p.entry-exit)*p.quantity,newBalance=state.balance+gross-exitFee;
 const trade:ReplayTrade={...p,exit,exitTime:bar.time,exitIndex:state.index,exitFee,gross,net:gross-p.entryFee-exitFee,reason,balanceAfter:newBalance};
 return withPositions({...state,balance:newBalance,trades:[...state.trades,trade]},positions.filter(item=>item.id!==id));
}
export function replayClose(state:ReplaySession,bars:ReplayBar[],costs:ReplayCosts,reason:'MANUAL'|'SESSION_END'='MANUAL',positionId?:string):ReplaySession{
 validateReplayCosts(costs);
 const positions=replayPositions(state),position=positionId?positions.find(p=>p.id===positionId):positions[0];if(!position)return state;
 const bar=bars[state.index];if(!bar)throw Error('No current candle.');
 const exit=position.side==='BUY'?bar.close-costs.slippage:bar.close+costs.spread+costs.slippage;
 return finish(state,bar,costs,exit,reason,position.id);
}
/** Completed candles cannot establish intrabar ordering; stop takes precedence. */
export function replayStep(state:ReplaySession,bars:ReplayBar[],costs:ReplayCosts):ReplaySession{
 validateReplayCosts(costs);const nextIndex=state.index+1;if(nextIndex>=bars.length)return state;
 const bar=bars[nextIndex];let out:ReplaySession={...state,index:nextIndex};let newId:string|null=null;const pending=state.pending;
 if(pending){
  const askOpen=bar.open+costs.spread,askHigh=bar.high+costs.spread,askLow=bar.low+costs.spread;
  const touched=pending.side==='BUY'?(pending.type==='limit'?askLow<=pending.price:askHigh>=pending.price):(pending.type==='limit'?bar.high>=pending.price:bar.low<=pending.price);
  if(touched){
   const raw=pending.side==='BUY'?(pending.type==='limit'?Math.min(pending.price,askOpen):Math.max(pending.price,askOpen)):(pending.type==='limit'?Math.max(pending.price,bar.open):Math.min(pending.price,bar.open));
   const entry=raw+(pending.side==='BUY'?costs.slippage:-costs.slippage),fee=pending.quantity*costs.feePerOunce,dir=pending.side==='BUY'?1:-1,mark=replayMark(out,{...bar,close:bar.open},costs),identity=nextId(out,bar.time);
   if(entry*pending.quantity/costs.leverage+fee>mark.equity-mark.marginUsed||entry-dir*pending.stopDistance<=0)out={...out,pending:null};
   else {const position:ReplayPosition={id:identity.id,side:pending.side,quantity:pending.quantity,entry,stop:entry-dir*pending.stopDistance,target:entry+dir*pending.targetDistance,entryTime:bar.time,entryIndex:nextIndex,entryFee:fee};newId=position.id;out=withPositions({...out,pending:null,sequence:identity.sequence,balance:out.balance-fee},[...replayPositions(out),position]);}
  }
 }
 const spread=costs.spread,slip=costs.slippage;
 for(const position of replayPositions(out)){
  if(position.side==='BUY'){
   if(bar.low<=position.stop)out=finish(out,bar,costs,Math.min(position.stop,bar.open)-slip,'STOP',position.id);
   else if(position.id!==newId&&bar.high>=position.target)out=finish(out,bar,costs,position.target-slip,'TARGET',position.id);
  }else{
   if(bar.high+spread>=position.stop)out=finish(out,bar,costs,Math.max(position.stop,bar.open+spread)+slip,'STOP',position.id);
   else if(position.id!==newId&&bar.low+spread<=position.target)out=finish(out,bar,costs,position.target+slip,'TARGET',position.id);
  }
 }
 if(nextIndex===bars.length-1){for(const position of replayPositions(out))out=replayClose(out,bars,costs,'SESSION_END',position.id);out={...out,pending:null};}
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
