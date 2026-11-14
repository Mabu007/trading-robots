import type {ReplayBar,ReplayPosition,ReplaySession,ReplayTrade} from './market-replay-engine';
/** Older saves indexed only the selected day. Rebase only when all stored trade
 * timestamps agree with the newly returned day; otherwise leave the old save alone. */
export function rebaseDaySession(session:ReplaySession,dayBars:ReplayBar[],prefixLength:number):ReplaySession|null{
 if(!Number.isInteger(session.index)||session.index<0||session.index>=dayBars.length||!Array.isArray(session.trades))return null;
 const position=(p:ReplayPosition):ReplayPosition|null=>{
  if(!p||!Number.isInteger(p.entryIndex)||dayBars[p.entryIndex]?.time!==p.entryTime)return null;
  return {...p,entryIndex:p.entryIndex+prefixLength};
 };
 const positions=session.positions?.map(position);if(positions?.some(p=>!p))return null;
 const single=session.position?position(session.position):null;if(session.position&&!single)return null;
 const trades:ReplayTrade[]=[];
 for(const trade of session.trades){const entry=position(trade);if(!entry||!Number.isInteger(trade.exitIndex)||dayBars[trade.exitIndex]?.time!==trade.exitTime)return null;trades.push({...trade,entryIndex:entry.entryIndex,exitIndex:trade.exitIndex+prefixLength});}
 return {...session,index:session.index+prefixLength,position:single,...(positions?{positions:positions as ReplayPosition[]}:{}),trades};
}
