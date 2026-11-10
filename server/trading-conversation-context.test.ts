import {describe,it,expect} from 'vitest';
import {readTradingReferent,rememberDeskTrade,rememberInspectedTrade,readRobotReferent,rememberRobotReferent} from './trading-conversation-context';
import type {RecordStore} from './firestore-store';
const now=Date.UTC(2026,10,10,12,0);
function store(){
 const docs=new Map<string,Record<string,unknown>>();
 return {docs,db:{
  put:async(path:string,v:Record<string,unknown>)=>{docs.set(path,v)},
  get:async(path:string)=>docs.get(path)||null,
  create:async()=>true,query:async()=>[]
 } as RecordStore};
}
const row={available:true,day:'2026-11-10',recentLosses:[
 {accountId:'prop-1',tradeId:'trade-1',botId:'bot-1',
 attribution:'probable-entry-evidence',closedAtUTC:'2026-11-10T11:59:00.000Z'}]};
describe('durable owner-scoped conversational trade references',()=>{
 it('persists trade and probable confidence separately in owner/conversation scope',async()=>{
  const {db,docs}=store();
  const ref=await rememberDeskTrade(db,'alice','chat-a',row,now);
  expect(ref).toMatchObject({accountId:'prop-1',tradeId:'trade-1',
   robotId:'bot-1',attribution:'probable-entry-evidence'});
  expect(await readTradingReferent(db,'alice','chat-a',now)).toEqual(ref);
  expect(await readTradingReferent(db,'bob','chat-a',now)).toBeNull();
  expect(await readTradingReferent(db,'alice','chat-b',now)).toBeNull();
  expect([...docs.keys()]).toEqual(['users/alice/tradingConversationRefs/chat-a']);
 });
 it('will not choose one of two losses at the same time',async()=>{
  const {db}=store();
  expect(await rememberDeskTrade(db,'alice','chat-a',{...row,
   recentLosses:[row.recentLosses[0],{...row.recentLosses[0],tradeId:'trade-2'}]},now)).toBeNull();
 });
 it('expires pointers and refuses future-dated or invalid owner identities',async()=>{
  const {db}=store();
  await rememberDeskTrade(db,'alice','chat-a',row,now);
  expect(await readTradingReferent(db,'alice','chat-a',now+8*24*3600_000)).toBeNull();
  expect(await readTradingReferent(db,'alice','chat-a',now-3600_000)).toBeNull();
  expect(await rememberDeskTrade(db,'alice/other','chat-a',row,now)).toBeNull();
 });
 it('refreshes a reference only from a successful authenticated trade inspection',async()=>{
  const {db}=store();
  await rememberDeskTrade(db,'alice','chat-a',row,now);
  expect(await rememberInspectedTrade(db,'alice','chat-a',{available:false,
   accountId:'prop-1',tradeId:'fake'},now+1000)).toBeNull();
  const updated=await rememberInspectedTrade(db,'alice','chat-a',{
   available:true,accountId:'prop-1',tradeId:'trade-2',
   attribution:{botId:null,attribution:'unattributed'}},now+1000);
  expect(updated).toMatchObject({tradeId:'trade-2',robotId:null,attribution:'unattributed'});
 });
});

describe('robot context independent of any closed trade',()=>{
 it('remembers a verified robot per user and conversation until expiration',async()=>{
  const {db}=store();
  expect(await rememberRobotReferent(db,'alice','conv-1','bot-1','prop-1',now)).toBe(true);
  expect(await readRobotReferent(db,'alice','conv-1',now)).toMatchObject({robotId:'bot-1',accountId:'prop-1'});
  expect(await readRobotReferent(db,'bob','conv-1',now)).toBeNull();
  expect(await readRobotReferent(db,'alice','conv-1',now+8*24*3600_000)).toBeNull();
 });
 it('does not save untrusted cross-path identifiers',async()=>{
  const {db,docs}=store();
  expect(await rememberRobotReferent(db,'alice/other','conv-1','bot-1','prop-1',now)).toBe(false);
  expect(await rememberRobotReferent(db,'alice','conv/1','bot-1','prop-1',now)).toBe(false);
  expect(docs.size).toBe(0);
 });
});
