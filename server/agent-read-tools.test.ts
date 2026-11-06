import {describe,it,expect,vi} from 'vitest';
import {gzipSync} from 'node:zlib';
import {createAgentReadTools,agentReadToolRegistry} from './agent-read-tools.ts';
const call=async(t:any,botId:string)=>t.execute({botId},{toolCallId:'test',messages:[],abortSignal:new AbortController().signal});
describe('user-scoped agent read tools',()=>{
 it('reads only the authenticated owner and returns a bounded strategy with a hash',async()=>{
  const read=vi.fn(async()=>JSON.stringify({userId:'alice',botId:'bot-1',code:'A'.repeat(21000),updatedAt:'2026-11-01'}));
  const x=await call(createAgentReadTools('alice',read).getSavedStrategy,'bot-1');
  expect(read).toHaveBeenCalledWith('user-bots/YWxpY2U/bot-1/current.json');expect(x.available).toBe(true);expect(x.truncated).toBe(true);expect(x.code.length).toBe(20000);expect(x.codeHash).toHaveLength(64);
 });
 it('fails closed for cross-user records, missing records and storage errors',async()=>{
  const x=createAgentReadTools('alice',async()=>JSON.stringify({userId:'bob',botId:'bot-1',code:'secret'}));
  expect((await call(x.getSavedStrategy,'bot-1')).available).toBe(false);
  expect((await call(createAgentReadTools('alice',async()=>null).getSavedStrategy,'bot-1')).available).toBe(false);
  expect((await call(createAgentReadTools('alice',async()=>{throw Error('secret')}).getSavedStrategy,'bot-1')).available).toBe(false);
 });
 it('reads a compressed saved backtest but never reports it as live performance',async()=>{
  const state={asset:'GOLDUSDC',from:'2026-01-01',to:'2026-01-02',logs:[],result:{candles:[{},{}],trades:[{id:7,side:'BUY',entry:100,exit:98,pnl:-2,reason:'stop'}],metrics:{net:1.5,unavailable:null}}};
  const raw=Buffer.from(JSON.stringify(state));const record={userId:'alice',botId:'bot-1',format:'gzip-base64',version:2,payload:gzipSync(raw).toString('base64'),uncompressedBytes:raw.length,savedAt:'2026-01-03'};
  const x=await call(createAgentReadTools('alice',async()=>JSON.stringify(record)).getSavedBacktest,'bot-1');
  expect(x).toMatchObject({available:true,kind:'simulation',candleCount:2,tradeCount:1,metrics:{net:1.5}});
  const tradeTool=createAgentReadTools('alice',async()=>JSON.stringify(record)).getSavedBacktestTrade;
  const trade=await (tradeTool as any).execute({botId:'bot-1',tradeIndex:0},{toolCallId:'test',messages:[]});
  expect(trade).toMatchObject({available:true,kind:'simulation',trade:{id:7,pnl:-2,reason:'stop'}});
  expect((await (tradeTool as any).execute({botId:'bot-1',tradeIndex:1},{toolCallId:'test',messages:[]})).available).toBe(false);
  record.uncompressedBytes++;expect((await call(createAgentReadTools('alice',async()=>JSON.stringify(record)).getSavedBacktest,'bot-1')).available).toBe(false);
 });
 it('exposes read-only descriptors and rejects invalid IDs before storage access',()=>{
  expect(agentReadToolRegistry.every(x=>x.classification==='read'&&!x.approvalRequired)).toBe(true);
  expect(agentReadToolRegistry[0].inputSchema.safeParse({botId:'../bob'}).success).toBe(false);
 });
});
