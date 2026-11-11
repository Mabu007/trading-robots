import type {ExecutionEvent} from '../shared/propdao-execution-journal.ts';
export type BrokerTradeEvidence={
 id:string;accountId:string;symbol:string;side:'BUY'|'SELL';qty:number;
 entry:number;openedAt:number|null;closedAt:number|null;
 positionId?:string|null;intentId?:string|null;orderId?:string|null;
};
export type Attribution='exact-provider-identity'|'probable-entry-evidence'|'conflicting-evidence'|'unattributed';
export type TradeLink={
 botId:string|null;grantId:string|null;attribution:Attribution;
 confidence:'verified'|'probable'|'unknown';eventId:string|null;
 evidence:string[];codeHash:string|null;decisionCandleClose:number|null
};
const none=(reason:string):TradeLink=>({botId:null,grantId:null,attribution:'unattributed',
 confidence:'unknown',eventId:null,evidence:[reason],codeHash:null,decisionCandleClose:null});
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const ms=(v:unknown)=>num(v)?v>1e11?v:v*1000:null;
function link(e:ExecutionEvent,confidence:'verified'|'probable',evidence:string[]):TradeLink{
 return {botId:e.botId,grantId:e.grantId,eventId:e.id,attribution:confidence==='verified'?
  'exact-provider-identity':'probable-entry-evidence',confidence,evidence,
  codeHash:e.codeHash??null,decisionCandleClose:num(e.decisionCandleClose)?e.decisionCandleClose:null};
}
/** No account-wide or currently-running-robot inference. A trade is EXACT
 * only when all shared broker provider IDs agree on one unique protected fill.
 * A fuzzy link requires contemporaneous fill PRICE and QUANTITY evidence,
 * cannot use mere order-intent or signal events and remains explicitly PROBABLE.
 */
export function reconcileBrokerTrade(t:BrokerTradeEvidence,journal:ExecutionEvent[]):TradeLink{
 const fills=journal.filter(e=>e.stage==='PROTECTED_FILL'&&e.accountId===t.accountId&&
   e.symbol===t.symbol&&e.side===t.side&&id(e.botId)&&id(e.grantId));
 const fields:[keyof BrokerTradeEvidence,keyof ExecutionEvent][]=[
  ['positionId','positionId'],['intentId','intentId'],['orderId','brokerOrderId']];
 const providerIds=fields.filter(([tf])=>id(t[tf]));
 const exact=fills.filter(e=>providerIds.some(([tf,ef])=>id(e[ef])&&t[tf]===e[ef]));
 if(exact.length){
  const matched=new Set(exact.map(e=>e.botId+':'+e.grantId+':'+(e.intentId||e.id)));
  // If the broker provides more than one identity, all matches must resolve
  // to the same event/intent, not just any one matching identifier.
  const chosen=exact[0];
  const contradicted=providerIds.some(([tf,ef])=>id(chosen[ef])&&t[tf]!==chosen[ef]);
  const disagree=providerIds.some(([tf,ef])=>
   exact.some(e=>id(e[ef])&&t[tf]===e[ef]&&e.botId+':'+e.grantId+':'+(e.intentId||e.id)!==
    chosen.botId+':'+chosen.grantId+':'+(chosen.intentId||chosen.id)));
  if(matched.size!==1||contradicted||disagree)return {...none('Conflicting broker identity evidence'),attribution:'conflicting-evidence'};
  return link(chosen,'verified',['Exact account-scoped protected-fill broker position, intent or order identifier']);
 }
 if(providerIds.length)return none('Broker supplied provider IDs but no matching protected fill exists');
 const opened=ms(t.openedAt);
 if(opened===null||!num(t.qty)||t.qty<=0||!num(t.entry)||t.entry<=0)
  return none('Incomplete provider entry time, price or quantity');
 const plausible=fills.filter(e=>{
  const filled=ms(e.filledAt??e.time);
  return filled!==null&&Math.abs(opened-filled)<=180000&&
   num(e.entryPrice)&&e.entryPrice>0&&Math.abs(e.entryPrice-t.entry)/t.entry<=.002&&
   num(e.quantity)&&e.quantity>0&&Math.abs(e.quantity-t.qty)<=Math.max(.000001,t.qty*.025);
 });
 if(!plausible.length)return none('No protected fill with matching entry time, price and quantity');
 const keys=new Set(plausible.map(e=>e.botId+':'+e.grantId+':'+(e.intentId||e.id)));
 if(keys.size!==1)return {...none('Several robots or protected fills are plausible'),attribution:'conflicting-evidence'};
 return link(plausible[0],'probable',[
  'Unique entry evidence: account, symbol, side, quantity, price and timestamp',
  'No broker-provided ID matched the Worker. This is not verified robot attribution.'
 ]);
}
