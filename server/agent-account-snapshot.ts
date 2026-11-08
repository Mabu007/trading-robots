import {tool} from 'ai';
import {z} from 'zod';

export const accountSnapshotInputSchema=z.object({
 accountId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
}).strict();
type AccountRisk={
 account:{accountId?:string;status?:string};
 risk:{equity:number;balance?:number;roomUsd:number;breached:boolean};
 positions:unknown[];orders:unknown[];
};
const amount=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const safe=(v:unknown)=>typeof v==='string'?v.slice(0,90):null;
/** Read-only, owner-scoped broker data. Never treat an API error as zero exposure. */
export function createPropDAOAccountSnapshotTool(uid:string,read:(uid:string,accountId:string)=>Promise<AccountRisk>){
 return tool({
  description:'Read broker-reported equity, available risk, open positions and resting orders for an explicitly selected user-owned PropDAO account. Never place or cancel orders. An account ID must be selected; do not guess it. If unavailable, exposure is unknown.',
  inputSchema:accountSnapshotInputSchema,
  execute:async({accountId})=>{
   if(!uid||uid.length>128||uid.includes('/'))return {available:false,exposure:'unknown',reason:'Invalid signed-in user.'};
   try{
    const snapshot=await read(uid,accountId);
    if(!snapshot||!Array.isArray(snapshot.positions)||!Array.isArray(snapshot.orders)||
       !Number.isFinite(snapshot.risk?.equity)||!Number.isFinite(snapshot.risk?.roomUsd)||
       typeof snapshot.risk?.breached!=='boolean')throw Error('Invalid broker response');
    const positions=snapshot.positions.slice(0,30).map((value:any)=>({
      id:safe(value?.id),symbol:safe(value?.symbol),side:safe(value?.side),
      qty:amount(value?.qty),entry:amount(value?.entry),mark:amount(value?.mark),
      unrealizedPnl:amount(value?.unrealizedPnl)
    }));
    const pendingOrders=snapshot.orders.slice(0,30).map((value:any)=>({
      id:safe(value?.id??value?.orderId),symbol:safe(value?.symbol),side:safe(value?.side),
      status:safe(value?.status),qty:amount(value?.qty??value?.quantity),
      price:amount(value?.price??value?.limitPrice)
    }));
    return {available:true,source:'Direct authenticated PropDAO account read',checkedAt:new Date().toISOString(),
      accountId,status:safe(snapshot.account?.status),
      equity:snapshot.risk.equity,balance:amount(snapshot.risk.balance),riskRoomUsd:snapshot.risk.roomUsd,
      riskBreached:snapshot.risk.breached,exposure:'verified',openPositionCount:snapshot.positions.length,
      pendingOrderCount:snapshot.orders.length,positions,pendingOrders,
      truncated:snapshot.positions.length>30||snapshot.orders.length>30,
      note:'Provider-reported account exposure, not trading instructions or proof of future fills.'};
   }catch{return {available:false,accountId,source:'PropDAO account read failed',checkedAt:new Date().toISOString(),
     exposure:'unknown',equity:null,openPositionCount:null,pendingOrderCount:null,
     positions:null,pendingOrders:null,reason:'Could not verify broker account exposure. Recheck the connected PropDAO account.'};}
  }
 });
}
