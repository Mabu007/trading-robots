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
 it('reads scoped agent state without exposing unrelated fields or fabricating certainty',async()=>{
  const runtimeStatus=vi.fn(async(agentId:string)=>({agentId,state:'unknown',verified:false,checkedAt:10,secret:'must not escape'}));
  const t=createAgentReadTools('alice',async()=>null,{runtimeStatus}).getAgentRuntimeStatus as any;
  const x=await t.execute({agentId:'agent-1'},{toolCallId:'test',messages:[]});
  expect(x).toMatchObject({available:true,agentId:'agent-1',state:'unknown',verified:false,checkedAt:10});
  expect(x).not.toHaveProperty('secret');expect(runtimeStatus).toHaveBeenCalledWith('agent-1');
  const bad=createAgentReadTools('alice',async()=>null,{runtimeStatus:async()=>({agentId:'wrong',state:'running',verified:true})}).getAgentRuntimeStatus as any;
  expect((await bad.execute({agentId:'agent-1'},{toolCallId:'test',messages:[]})).available).toBe(false);
 });
 it('exposes read-only descriptors and rejects invalid IDs before storage access',()=>{
  expect(agentReadToolRegistry.every(x=>x.classification==='read'&&!x.approvalRequired)).toBe(true);
  expect(agentReadToolRegistry[0].inputSchema.safeParse({botId:'../bob'}).success).toBe(false);
 });
});


describe('scoped read-only resource discovery',()=>{
 const invocation=(tool:any,limit=20)=>tool.execute({limit},{toolCallId:'list',messages:[],abortSignal:new AbortController().signal});
 it('lists bounded owned strategy metadata and excludes foreign owner records',async()=>{
  const tools=createAgentReadTools('alice',async()=>null,{listStrategies:async()=>[
    {id:'owned-1',name:'Gold strategy',asset:'GOLDUSDC',venue:'propdao',userId:'alice',lastBacktest:{netR:2}},
    {id:'foreign-1',name:'Private broker key',userId:'bob'},
    {id:'../invalid',name:'Invalid identifier'},
    {id:'owned-2',name:'Second bot',userId:'alice',secret:'do not expose'}
  ]});
  const r:any=await invocation(tools.listSavedStrategies);
  expect(r.available).toBe(true);
  expect(r.strategies.map((x:any)=>x.id)).toEqual(['owned-1','owned-2']);
  expect(JSON.stringify(r)).not.toMatch(/Private broker key|do not expose|foreign-1/);
  expect(r.strategies[0].hasBacktest).toBe(true);
 });
 it('lists only owner-scoped agent IDs, never secrets, and marks live status unverified',async()=>{
  const tools=createAgentReadTools('alice',async()=>null,{listAgents:async()=>[
    {id:'a-1',ownerUid:'alice',botId:'owned-1',state:'running',venue:'propdao',name:'A',token:'top-secret',updatedAt:2000},
    {id:'a-2',ownerUid:'bob',botId:'foreign-1',state:'running'}
  ]});
  const r:any=await invocation(tools.listUserAgents);
  expect(r.agents).toHaveLength(1);
  expect(r.agents[0]).toMatchObject({agentId:'a-1',savedState:'running',verifiedLive:false});
  expect(JSON.stringify(r)).not.toContain('top-secret');
 });
 it('fails closed when listing service cannot be verified',async()=>{
  const tools=createAgentReadTools('alice',async()=>null,{listStrategies:async()=>{throw Error('offline')}});
  expect((await invocation(tools.listSavedStrategies) as any).available).toBe(false);
 });
});
