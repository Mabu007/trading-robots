import {safeExecutionEvents,type ExecutionEvent} from '../shared/propdao-execution-journal.ts';

type ClosedTrade={
 id:string;symbol:string;side:'BUY'|'SELL';qty:number;entry:number;exit:number;pnl:number;
 openedAt:number|null;closedAt:number|null;reason:string;fee:number|null;
 positionId?:string|null;intentId?:string|null;
};
type Group={key:string;count:number;losing:number;reportedPnl:number};
function tally(items:ClosedTrade[],key:(t:ClosedTrade)=>string):Group[]{
 const map=new Map<string,Group>();
 for(const trade of items){
  const label=key(trade);
  const group=map.get(label)||{key:label,count:0,losing:0,reportedPnl:0};
  group.count++;group.losing+=Number(trade.pnl<0);group.reportedPnl+=trade.pnl;map.set(label,group);
 }
 return [...map.values()].sort((a,b)=>b.count-a.count).slice(0,12).map(x=>({...x,reportedPnl:Number(x.reportedPnl.toFixed(6))}));
}
const strictId=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_-]{4,140}$/.test(s)?s:null;
const num=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
const utc=(time:number|null):string|null=>{
 if(time===null)return null;
 const millis=time>1e11?time:time*1000;
 return millis>=946684800000&&millis<=4102444800000?new Date(millis).toISOString():null;
};
/** This report is read-only and never infers robot attribution from mere trade timing. */
export function analyzeLiveTradeLosses(input:{
 trades:unknown;accountId:string;botId:string;executionEvents?:unknown;now?:number;limit?:number;
}){
 const raw=Array.isArray(input.trades)?input.trades.slice(0,50):[];
 const trades:ClosedTrade[]=raw.flatMap(row=>{
  if(!row||typeof row!=='object')return [];
  const t=row as Record<string,unknown>;
  if(typeof t.id!=='string'||!t.id.trim()||t.id.length>140||typeof t.symbol!=='string'||!['BUY','SELL'].includes(String(t.side))||
   [t.qty,t.entry,t.exit,t.pnl].some(v=>num(v)===null))return [];
  const id=String(t.id);
  const trade:ClosedTrade={id,symbol:String(t.symbol).slice(0,40),side:t.side as ClosedTrade['side'],
   qty:t.qty as number,entry:t.entry as number,exit:t.exit as number,pnl:t.pnl as number,
   openedAt:num(t.openedAt),closedAt:num(t.closedAt),fee:num(t.fee),
   reason:typeof t.reason==='string'?t.reason.slice(0,80):'',
   positionId:strictId(t.positionId),intentId:strictId(t.intentId)};
  return [trade];
 });
 // Only journal events carrying a provider-linked position/intent identity,
 // plus the same bot ID, account, side and symbol, can establish attribution.
 const events=safeExecutionEvents(input.executionEvents,input.accountId).filter(e=>e.botId===input.botId&&e.stage==='PROTECTED_FILL');
 const attributed=new Set<string>();
 for(const trade of trades){
  const matches=events.filter((e:ExecutionEvent)=>e.symbol===trade.symbol&&e.side===trade.side&&(
   (trade.positionId&&e.positionId===trade.positionId)||
   (trade.intentId&&e.intentId===trade.intentId)
  ));
  if(matches.length===1)attributed.add(trade.id);
 }
 const order=[...trades].sort((a,b)=>(b.closedAt??0)-(a.closedAt??0));
 const losses=order.filter(t=>t.pnl<0);
 const wins=order.filter(t=>t.pnl>0);
 const samples=order.filter(t=>t.pnl!==0);
 const pnl=trades.reduce((n,t)=>n+t.pnl,0);
 const worst=losses.length?Math.min(...losses.map(t=>t.pnl)):null;
 const byBot=trades.filter(t=>attributed.has(t.id));
 const brokerFeesKnown=trades.every(t=>t.fee!==null);
 const feeTotal=trades.reduce((n,t)=>n+(t.fee||0),0);
 return {
  source:'Direct authenticated PropDAO broker CLOSED trade history',
  accountId:input.accountId,botId:input.botId,fetchedAt:new Date(input.now??Date.now()).toISOString(),
  scope:'Most recent provider-returned account trades (maximum 50), not a full lifetime history',
  sampleSize:trades.length,reportedTotalPnl:Number(pnl.toFixed(6)),
  pnlMeaning:'Provider-reported P/L; whether fee is already included is not verified. Do not deduct fees again or call this definitively net.',
  brokerFees:brokerFeesKnown?Number(feeTotal.toFixed(6)):null,
  wins:wins.length,losses:losses.length,flat:trades.length-samples.length,
  winRatePercent:samples.length?Number((wins.length/samples.length*100).toFixed(2)):null,
  averageLoss:losses.length?Number((losses.reduce((n,t)=>n+t.pnl,0)/losses.length).toFixed(6)):null,
  worstLoss:worst,
  bySide:tally(trades,t=>t.side),
  byExitReason:tally(trades,t=>t.reason||'Unspecified by broker'),
  matchedRobotTradeCount:byBot.length,
  matchedRobotReportedPnl:Number(byBot.reduce((n,t)=>n+t.pnl,0).toFixed(6)),
  attribution:'Only broker position/intent IDs explicitly linked to this robot Worker journal establish attribution; other account trades must not be called robot trades.',
  attributableLosses:byBot.filter(t=>t.pnl<0).length,
  unmatchedAccountTrades:trades.length-byBot.length,
  reportedStopLossExits:trades.filter(t=>/^(?:SL|STOP[_ -]?LOSS|STOPPED[_ -]?OUT)$/i.test(t.reason.trim())).length,
  recentLosingTrades:losses.slice(0,input.limit??12).map(t=>({...t,
   openedAtUTC:utc(t.openedAt),closedAtUTC:utc(t.closedAt),
   robotAttribution:attributed.has(t.id)?'matched-by-identity':'unattributed-account-trade'})),
  recentTrades:order.slice(0,8).map(t=>({id:t.id,symbol:t.symbol,side:t.side,pnl:t.pnl,fee:t.fee,
   openedAtUTC:utc(t.openedAt),closedAtUTC:utc(t.closedAt),reason:t.reason,
   robotAttribution:attributed.has(t.id)?'matched-by-identity':'unattributed-account-trade'})),
  limitations:[
   'Provider trade history is account-wide and capped at the most recent 50 records; older losses may be missing.',
   'Unmatched trades may belong to this robot, another strategy, or manual activity; attribution is unknown.',
   'A stop-loss reason is a broker exit label, not proof which strategy condition or volatility pattern caused the loss.',
   'Without strategy decision checks and contemporary candles, the precise cause of a losing entry cannot be established.'
  ]
 };
}
