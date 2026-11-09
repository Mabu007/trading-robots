import {createHash} from 'node:crypto';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export type DraftFragment={
 ownerUid:string;taskId:string;id:string;fragmentHash:string;slot:string;index:number;total:number;
 asset:string;venue:'propdao'|'hyperliquid';source:string;createdAt:string;
};
type Context=Pick<DraftFragment,'ownerUid'|'taskId'|'slot'|'asset'|'venue'>;
const regex=/^[a-zA-Z0-9_-]{1,40}$/;
export function makeDraftFragment(context:Context,index:number,total:number,source:string,now=new Date().toISOString()):DraftFragment{
 if(!context.ownerUid||!regex.test(context.slot)||!context.taskId||!Number.isInteger(index)||
  !Number.isInteger(total)||total<2||total>8||index<0||index>=total||
  typeof source!=='string'||source.length<10||source.length>4500)throw Error('Invalid bounded strategy fragment');
 const fragmentHash=digest([context.taskId,context.slot,index,total,context.asset,context.venue,source].join(':'));
 return {...context,index,total,source,id:'fragment_'+fragmentHash.slice(0,32),fragmentHash,createdAt:now};
}
export function assembleDraftFragments(context:Context,rows:DraftFragment[]):string{
 if(!Array.isArray(rows)||rows.length<2||rows.length>8)throw Error('Expected 2–8 immutable draft fragments');
 let combined='';
 const ids=new Set<string>();
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  if(!row||row.ownerUid!==context.ownerUid||row.taskId!==context.taskId||row.slot!==context.slot||
   row.asset!==context.asset||row.venue!==context.venue||row.total!==rows.length||row.index!==i)
   throw Error('Fragment owner, venue, count or ordering mismatch');
  const expected=makeDraftFragment(context,i,rows.length,row.source,row.createdAt);
  if(row.fragmentHash!==expected.fragmentHash||row.id!==expected.id||ids.has(row.id))
   throw Error('Immutable draft fragment content hash mismatch');
  ids.add(row.id);
  combined+=row.source;
  if(combined.length>20000)throw Error('Assembled strategy exceeds 20,000 characters');
 }
 return combined;
}
