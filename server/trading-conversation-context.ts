import type {RecordStore} from './firestore-store.ts';

const id=/^[A-Za-z0-9_-]{1,100}$/;
export type TradingReferent={accountId:string;tradeId:string;robotId:string|null;
 attribution:string;recordedAt:number;day:string};
const path=(uid:string,conversationId:string)=>'users/'+uid+'/tradingConversationRefs/'+conversationId;
function valid(ref:unknown):ref is TradingReferent{
 const v=ref as TradingReferent;
 return !!v&&id.test(v.accountId)&&id.test(v.tradeId)&&
  (v.robotId===null||id.test(v.robotId))&&typeof v.attribution==='string'&&
  typeof v.recordedAt==='number'&&Number.isFinite(v.recordedAt)&&
  typeof v.day==='string'&&/^\d{4}-\d\d-\d\d$/.test(v.day);
}
const scope=(uid:string,conversationId:string)=>Boolean(uid&&!uid.includes('/')&&uid.length<=256&&id.test(conversationId));
/** Referential identity is merely a pointer: every subsequent trade inspection
 * revalidates the connected broker account ownership and current evidence. */
export async function readTradingReferent(store:RecordStore|null,uid:string,conversationId:string,now=Date.now()){
 if(!store||!scope(uid,conversationId))return null;
 const value=await store.get(path(uid,conversationId));
 if(!valid(value)||now-value.recordedAt>7*24*3600_000||value.recordedAt>now+300_000)return null;
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
 const first=rows[0];
 if(!first||typeof first.accountId!=='string'||typeof first.tradeId!=='string'||
  !id.test(first.accountId)||!id.test(first.tradeId))return null;
 // Do not resolve an ambiguous "last loss" from two equally recent fills.
 if(rows.length>1&&first.closedAtUTC===rows[1].closedAtUTC)return null;
 const robotId=typeof first.botId==='string'&&id.test(first.botId)?first.botId:null;
 const ref:TradingReferent={accountId:first.accountId,tradeId:first.tradeId,robotId,
  attribution:typeof first.attribution==='string'?first.attribution:'unattributed',
  recordedAt:now,day:value.day};
 await store.put(path(uid,conversationId),ref);
 return ref;
}
export async function rememberInspectedTrade(store:RecordStore|null,uid:string,conversationId:string,
 result:unknown,now=Date.now()):Promise<TradingReferent|null>{
 if(!store||!scope(uid,conversationId)||!result||typeof result!=='object')return null;
 const v=result as Record<string,unknown>,link=v.attribution as Record<string,unknown>|undefined;
 if(v.available!==true||typeof v.accountId!=='string'||typeof v.tradeId!=='string'||
  !id.test(v.accountId)||!id.test(v.tradeId))return null;
 const ref={accountId:v.accountId,tradeId:v.tradeId,
  robotId:typeof link?.botId==='string'&&id.test(link.botId)?link.botId:null,
  attribution:typeof link?.attribution==='string'?link.attribution:'unattributed',
  recordedAt:now,day:new Date(now+7200000).toISOString().slice(0,10)};
 await store.put(path(uid,conversationId),ref);
 return ref;
}
