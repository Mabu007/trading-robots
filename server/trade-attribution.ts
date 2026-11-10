import type {ExecutionEvent} from '../shared/propdao-execution-journal.ts';

/** Broker-side executions are authoritative; a Worker-reported signal is not a fill. */
export type BrokerTradeEvidence={
 id:string;accountId:string;symbol:string;side:'BUY'|'SELL';qty:number;
 entry:number;exit:number;pnl:number;openedAt:number|null;closedAt:number|null;
 fee:number|null;reason:string;positionId?:string|null;intentId?:string|null;orderId?:string|null;
};
export type AttributionLevel='exact-provider-identity'|'probable-entry-evidence'|'conflicting-evidence'|'unattributed';
export type TradeLink={
 botId:string|null;grantId:string|null;attribution:AttributionLevel;
 confidence:'verified'|'probable'|'unknown';
 evidence:string[];eventId:string|null;strategyCodeHash:string|null;
 decisionCandleClose:number|null;
};
const missing:TradeLink={botId:null,grantId:null,attribution:'unattributed',
 confidence:'unknown',evidence:[],eventId:null,strategyCodeHash:null,decisionCandleClose:null};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const ms=(v:number|null|undefined)=>finite(v)?(v>1e11?v:v*1000):null;
const identifier=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
function linked(e:ExecutionEvent,kind:AttributionLevel,evidence:string[]):TradeLink{
 return {botId:e.botId,grantId:e.grantId,attribution:kind,
  confidence:kind==='exact-provider-identity'?'verified':'probable',
  evidence,eventId:e.id,strategyCodeHash:e.codeHash??null,
  decisionCandleClose:finite(e.decisionCandleClose)?e.decisionCandleClose:null};
}
/** Strict exact matching, then independently labelled probabilistic recovery.
 * Missing provider IDs never become exact matches, even with one active robot.
 * Fuzzy recovery requires ALL of: same account, side, symbol, entry time,
 * entry price, quantity, and exactly one distinct originating fill.
 */
export function reconcileTradeIdentity(t:BrokerTradeEvidence,events:ExecutionEvent[]):TradeLink{
 const candidates=events.filter(e=>e.stage==='PROTECTED_FILL'&&e.accountId===t.accountId&&
  e.symbol===t.symbol&&e.side===t.side&&identifier(e.botId)&&identifier(e.grantId));
 const exact=candidates.filter(e=>
  (identifier(t.positionId)&&identifier(e.positionId)&&t.positionId===e.positionId)||
  (identifier(t.intentId)&&identifier(e.intentId)&&t.intentId===e.intentId)||
  (identifier(t.orderId)&&identifier(e.brokerOrderId)&&t.orderId===e.brokerOrderId));
 const distinct=(rows:ExecutionEvent[])=>new Set(rows.map(e=>e.botId+':'+e.grantId+':'+(e.intentId??e.id)));
 if(exact.length){
  if(distinct(exact).size!==1)return {...missing,attribution:'conflicting-evidence',evidence:['Conflicting provider-identity matches']};
  return linked(exact[0],'exact-provider-identity',['Matching account-scoped broker position, intent or order ID']);
 }
 // When the broker supplies an identifier that contradicts the journal,
 // timing alone cannot override that contradiction.
 if(identifier(t.positionId)||identifier(t.intentId)||identifier(t.orderId))
  return {...missing,evidence:['Provider identifier not present in available protected-fill journal']};
 const open=ms(t.openedAt);
 if(open===null||!finite(t.qty)||t.qty<=0||!finite(t.entry)||t.entry<=0)
  return {...missing,evidence:['Broker entry evidence incomplete']};
 const probable=candidates.filter(e=>{
  const at=ms(e.filledAt??e.time);
  const quantity=e.quantity;
  const entry=e.entryPrice;
  return at!==null&&Math.abs(open-at)<=180_000&&
   finite(quantity)&&quantity>0&&Math.abs(t.qty-quantity)<=Math.max(0.000001,t.qty*0.025)&&
   finite(entry)&&entry>0&&Math.abs(t.entry-entry)/t.entry<=0.002;
 });
 if(!probable.length)return {...missing,evidence:['No qualifying protected-fill entry evidence']};
 if(distinct(probable).size!==1)return {...missing,attribution:'conflicting-evidence',
  evidence:['Multiple distinct protected fills satisfy broker entry evidence']};
 return linked(probable[0],'probable-entry-evidence',[
  'Unique matching protected fill: account, instrument, side, quantity, entry time and price',
  'Broker supplied no exact position, intent or order identity; attribution is NOT verified'
 ]);
}
