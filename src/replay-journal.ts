import type {PracticeRecord} from './practice-history';
import type {ReplayTrade} from './market-replay-engine';

// Deleting a trade review must not rewrite the deterministic execution ledger.
// A tombstone prevents a reopened local session from republishing deleted reviews.
const tombstoneKey=(uid:string,recordId:string)=>`trading-vibes:replay-deleted-trades:v1:${uid}:${recordId}`;
export function hiddenReplayTradeIds(uid:string,recordId:string):string[]{
 try{const parsed=JSON.parse(localStorage.getItem(tombstoneKey(uid,recordId))||'[]');
  return Array.isArray(parsed)?parsed.filter(value=>typeof value==='string'):[];
 }catch{return []}
}
export function visibleArchivedTrades(uid:string,recordId:string,trades:ReplayTrade[]):ReplayTrade[]{
 const hidden=new Set(hiddenReplayTradeIds(uid,recordId));
 return trades.filter(trade=>!hidden.has(trade.id));
}
export function hideArchivedTrade(uid:string,recordId:string,tradeId:string){
 const ids=new Set(hiddenReplayTradeIds(uid,recordId));ids.add(tradeId);
 localStorage.setItem(tombstoneKey(uid,recordId),JSON.stringify([...ids]));
}
// When a review is edited from My Progress, mirror the note into the local
// replay snapshot so reopening that day cannot revert the Firebase edit.
export function patchSavedReplayReview(uid:string,record:PracticeRecord,tradeId:string,note:string){
 const key=`trading-vibes:replay:zar:v4:${uid}:${record.asset||'XAUUSD'}:${record.day}`;
 try{
  const saved=localStorage.getItem(key);if(!saved)return;
  const parsed=JSON.parse(saved);
  if(parsed?.version!==4||parsed.attemptId!==record.id)return;
  parsed.annotations={...(parsed.annotations||{}),[tradeId]:note};
  localStorage.setItem(key,JSON.stringify(parsed));
 }catch{/* A failed local mirror must not prevent cloud review edits. */}
}
