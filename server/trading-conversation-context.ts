import type {RecordStore} from './firestore-store.ts';

const id=/^[A-Za-z0-9_-]{1,100}$/;
type TradePointer={accountId:string;tradeId:string;robotId:string|null;
 grantId:string|null;strategyCodeHash:string|null;attribution:string};
export type TradingReferent=TradePointer&{recordedAt:number;day:string;
 latestClosedTrade?:TradePointer|null};
const path=(uid:string,conversationId:string)=>'users/'+uid+'/tradingConversationRefs/'+conversationId;
function valid(ref:unknown):ref is TradingReferent{
 const v=ref as TradingReferent;
 return !!v&&id.test(v.accountId)&&id.test(v.tradeId)&&
  (v.robotId===null||id.test(v.robotId))&&
  (v.grantId===null||id.test(v.grantId))&&
  (v.strategyCodeHash===null||/^[a-f0-9]{64}$/.test(v.strategyCodeHash))&&
  typeof v.attribution==='string'&&
  typeof v.recordedAt==='number'&&Number.isFinite(v.recordedAt)&&
  typeof v.day==='string'&&/^\d{4}-\d\d-\d\d$/.test(v.day);
}
const scope=(uid:string,conversationId:string)=>Boolean(uid&&!uid.includes('/')&&uid.length<=256&&id.test(conversationId));
/** Referential identity is merely a pointer: every subsequent trade inspection
 * revalidates the connected broker account ownership and current evidence. */
export async function readTradingReferent(store:RecordStore|null,uid:string,conversationId:string,
 now=Date.now(),focus:'loss'|'trade'='loss'){
 if(!store||!scope(uid,conversationId))return null;
 const value=await store.get(path(uid,conversationId));
 if(!valid(value)||now-value.recordedAt>7*24*3600_000||value.recordedAt>now+300_000)return null;
 if(focus==='trade'&&value.latestClosedTrade&&
    id.test(value.latestClosedTrade.accountId)&&id.test(value.latestClosedTrade.tradeId))
  return {...value,...value.latestClosedTrade};
 return value;
}
/** Persist a specific most recent broker LOSS, never a menu option or an
 * inferred bot. Ties in close time cannot select a "last" trade. */
export async function rememberDeskTrade(store:RecordStore|null,uid:string,conversationId:string,
 desk:unknown,now=Date.now()):Promise<TradingReferent|null>{
 if(!store||!scope(uid,conversationId)||!desk||typeof desk!=='object')return null;
 const value=desk as Record<string,unknown>;
 if(value.available!==true||!Array.isArray(value.recentLosses)||typeof value.day!=='string')return null;
 const rows=value.recentLosses as Record<string,unknown>[];
 const recent=Array.isArray(value.recentTrades)?value.recentTrades as Record<string,unknown>[]:[];
 const lastTrade=recent[0];
 const pointer=(v:Record<string,unknown>|undefined):TradePointer|null=>
  v&&typeof v.accountId==='string'&&typeof v.tradeId==='string'&&
  id.test(v.accountId)&&id.test(v.tradeId)?{
   accountId:v.accountId,tradeId:v.tradeId,
   robotId:typeof v.botId==='string'&&id.test(v.botId)?v.botId:null,
   grantId:typeof v.grantId==='string'&&id.test(v.grantId)?v.grantId:null,
   strategyCodeHash:typeof v.strategyCodeHash==='string'&&/^[a-f0-9]{64}$/.test(v.strategyCodeHash)?v.strategyCodeHash:null,
   attribution:typeof v.attribution==='string'?v.attribution:'unattributed'
  }:null;
 const loss=pointer(rows[0]),latest=pointer(lastTrade);
 if(!loss&&!latest)return null;
 // Do not resolve an ambiguous "last loss" or "last trade" by array order.
 if(rows.length>1&&rows[0]?.closedAtUTC===rows[1]?.closedAtUTC)return null;
 const uniqueRecent=recent.length<2||recent[0]?.closedAtUTC!==recent[1]?.closedAtUTC;
 const selected=loss??latest!;
 const ref:TradingReferent={...selected,recordedAt:now,day:value.day,
  latestClosedTrade:uniqueRecent?latest:null};
 await store.put(path(uid,conversationId),ref);
 return ref;
}
export async function rememberInspectedTrade(store:RecordStore|null,uid:string,conversationId:string,
 result:unknown,now=Date.now()):Promise<TradingReferent|null>{
 if(!store||!scope(uid,conversationId)||!result||typeof result!=='object')return null;
 const v=result as Record<string,unknown>,link=v.attribution as Record<string,unknown>|undefined;
 if(v.available!==true||typeof v.accountId!=='string'||typeof v.tradeId!=='string'||
  !id.test(v.accountId)||!id.test(v.tradeId))return null;
 const prior=await readTradingReferent(store,uid,conversationId,now).catch(()=>null);
 const ref:TradingReferent={accountId:v.accountId,tradeId:v.tradeId,
  robotId:typeof link?.botId==='string'&&id.test(link.botId)?link.botId:null,
  grantId:typeof link?.grantId==='string'&&id.test(link.grantId)?link.grantId:null,
  strategyCodeHash:typeof link?.strategyCodeHash==='string'&&/^[a-f0-9]{64}$/.test(link.strategyCodeHash)?link.strategyCodeHash:null,
  attribution:typeof link?.attribution==='string'?link.attribution:'unattributed',
  recordedAt:now,day:new Date(now+7200000).toISOString().slice(0,10),
  latestClosedTrade:prior?.latestClosedTrade??null};
 await store.put(path(uid,conversationId),ref);
 return ref;
}


export type RobotReferent={robotId:string;accountId:string|null;recordedAt:number};
/** Separate entity pointer: a bot can be under discussion before any trade
 * exists. The caller must have obtained this ID from an owner-checked read. */
export async function rememberRobotReferent(store:RecordStore|null,uid:string,conversationId:string,
 robotId:string,accountId:string|null,now=Date.now()){
 if(!store||!scope(uid,conversationId)||!id.test(robotId)||
    (accountId!==null&&!id.test(accountId)))return false;
 await store.put('users/'+uid+'/tradingConversationRobot/'+conversationId,{
  robotId,accountId,recordedAt:now});
 return true;
}
export async function readRobotReferent(store:RecordStore|null,uid:string,conversationId:string,now=Date.now()):
 Promise<RobotReferent|null>{
 if(!store||!scope(uid,conversationId))return null;
 const value=await store.get('users/'+uid+'/tradingConversationRobot/'+conversationId);
 if(!value||!id.test(value.robotId)||
    (value.accountId!==null&&!id.test(value.accountId))||
    typeof value.recordedAt!=='number'||!Number.isFinite(value.recordedAt)||
    now-value.recordedAt>7*24*3600_000||value.recordedAt>now+300_000)return null;
 return value as RobotReferent;
}
