import {createHash} from 'node:crypto';
import type {RecordStore} from './firestore-store.ts';
import {updateToolTrace,type ToolTrace} from '../src/tool-trace.ts';

export const chatIdPattern=/^[A-Za-z0-9_-]{1,100}$/;
export const receiptIdPattern=/^[a-f0-9-]{36}$/;

function receiptPath(uid:string,conversationId:string,receiptId:string){
 return 'serverChatToolReceipts/'+createHash('sha256').update(JSON.stringify([uid,conversationId,receiptId])).digest('hex');
}

export class ChatToolReceipt {
 private trace:ToolTrace[]=[];
 private readonly ownerUid:string;
 private readonly conversationId:string;
 readonly id:string;
 constructor(ownerUid:string,conversationId:string,id:string){
  this.ownerUid=ownerUid;
  this.conversationId=conversationId;
  this.id=id;
 }
 record(event:unknown){this.trace=updateToolTrace(this.trace,event)}
 async save(store:RecordStore){
  const completed=this.trace.filter(item=>item.state==='completed');
  if(!completed.length)return false;
  return store.create(receiptPath(this.ownerUid,this.conversationId,this.id),{
   ownerUid:this.ownerUid,conversationId:this.conversationId,receiptId:this.id,
   recordedAt:new Date().toISOString(),traceJson:JSON.stringify(completed)
  });
 }
 static async read(store:RecordStore,uid:string,conversationId:string,id:string):Promise<ToolTrace[]|null>{
  const record=await store.get(receiptPath(uid,conversationId,id));
  if(!record||record.ownerUid!==uid||record.conversationId!==conversationId||record.receiptId!==id||typeof record.traceJson!=='string')return null;
  return JSON.parse(record.traceJson);
 }
}
