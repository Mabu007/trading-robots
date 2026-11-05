import express from 'express';
import {expect,it} from 'vitest';
import type {RecordStore} from './firestore-store.ts';
import {AgentRegistry,agentRoutes,type AgentBot,type AgentRecord} from './agent-registry.ts';

const code='export const config={timeframes:["m1","h1"],executionTimeframe:"m1",riskPercent:0.5,riskReward:2}; export function onCandle(){return {action:"WAIT"}};';
const bot:AgentBot={id:'bot-1',ownerUid:'alice',name:'Gold strategy',asset:'GOLDUSDC',venue:'propdao',code};
function memory(){const records=new Map<string,any>();const store:RecordStore={
 get:async path=>records.get(path)||null,
 put:async(path,data)=>{records.set(path,structuredClone(data))},
 create:async(path,data)=>{if(records.has(path))return false;records.set(path,structuredClone(data));return true},
 remove:async path=>{records.delete(path)},
 query:async collection=>[...records].filter(([path])=>path.startsWith(collection+'/')&&path.slice(collection.length+1).split('/').length===1).map(([path,data])=>({id:path.split('/').at(-1),...structuredClone(data)})),
 transaction:async(paths,update)=>{const result=update(paths.map(path=>records.get(path)||null));for(const [path,data] of Object.entries(result))records.set(path,structuredClone(data))}
};return {store,records}}
const time=(start=100)=>{let value=start;return()=>value++};

it('creates owner-scoped agent identities only for an explicit backtest run',async()=>{
 const {store}=memory(),registry=new AgentRegistry(store,time());
 const started=await registry.startBacktest('alice',bot);
 expect(started.agent).toMatchObject({id:registry.idFor('alice',bot.id),ownerUid:'alice',botId:'bot-1',asset:'GOLDUSDC',venue:'propdao',mode:'backtest',state:'backtest_running',configuration:{executionTimeframe:'m1',timeframes:['m1','h1']}});
 expect(started.agent.permissions).toMatchObject({marketDataRead:true,backtests:true,brokerStateRead:false,paperExecution:false,liveExecution:false,executionManagement:false});
 expect(registry.idFor('alice',bot.id)).not.toBe(registry.idFor('bob',bot.id));
 await expect(registry.get('bob',started.agent.id)).rejects.toThrow('Agent not found');
 expect((await registry.list('alice'))).toHaveLength(1);expect(await registry.list('bob')).toHaveLength(0);
});

it('persists a version-linked backtest summary and append-only lifecycle audit',async()=>{
 const {store,records}=memory(),registry=new AgentRegistry(store,time(1000));
 const started=await registry.startBacktest('alice',bot);
 const completed=await registry.finishBacktest('alice',bot,started.runId,'completed',{netReturn:3.5,profitFactor:1.4,trades:9,untrustedField:'drop'});
 expect(completed).toMatchObject({state:'backtest_completed',lastBacktest:{runId:started.runId,codeHash:started.agent.strategy.codeHash,summary:{netReturn:3.5,profitFactor:1.4,trades:9}}});
 expect(JSON.stringify(completed)).not.toContain(code);
 const events=await registry.audit('alice',started.agent.id);
 expect(events.map(e=>e.action)).toEqual(['backtest_started','backtest_completed']);
 expect(events[1]).toMatchObject({actorUid:'alice',details:{runId:started.runId,codeHash:started.agent.strategy.codeHash}});
 await expect(registry.finishBacktest('alice',bot,started.runId,'completed',{netReturn:4})).rejects.toThrow('no longer active');
 const stored=[...records.keys()].filter(path=>path.includes('/audit/'));expect(stored).toHaveLength(2);
});

it('keeps a live backtest identity fresh with heartbeats and marks interrupted runs stale',async()=>{
 const {store}=memory();let now=1_000,sequence=0;const registry=new AgentRegistry(store,()=>now,()=>`run-${++sequence}`);
 const started=await registry.startBacktest('alice',bot);
 now+=AgentRegistry.BACKTEST_STALE_AFTER_MS-1;
 await registry.heartbeatBacktest('alice',bot.id,started.runId);
 now+=AgentRegistry.BACKTEST_STALE_AFTER_MS-1;
 expect((await registry.list('alice'))[0].state).toBe('backtest_running');
 now+=2;
 const records=await registry.list('alice');
 expect(records[0]).toMatchObject({state:'backtest_failed',lastError:'Backtest heartbeat expired; this browser run was interrupted.'});
 expect(records[0].activeBacktest).toBeUndefined();
 expect((await registry.audit('alice',started.agent.id)).map(event=>event.action)).toEqual(['backtest_started','backtest_interrupted']);
 const next=await registry.startBacktest('alice',bot);
 expect(next.agent.state).toBe('backtest_running');
});

it('allows only one concurrent active run per saved strategy identity',async()=>{
 const {store}=memory(),registry=new AgentRegistry(store,time(100));
 const attempts=await Promise.allSettled([registry.startBacktest('alice',bot),registry.startBacktest('alice',bot)]);
 expect(attempts.filter(attempt=>attempt.status==='fulfilled')).toHaveLength(1);
 expect(attempts.filter(attempt=>attempt.status==='rejected')).toHaveLength(1);
 const records=await registry.list('alice');expect(records).toHaveLength(1);expect(records[0].state).toBe('backtest_running');
 expect((await registry.audit('alice',records[0].id)).map(event=>event.action)).toEqual(['backtest_started']);
});

it('rejects stale or cross-user backtest completions and does not backtest a live agent',async()=>{
 const {store}=memory(),registry=new AgentRegistry(store,time());
 const started=await registry.startBacktest('alice',bot);
 await expect(registry.finishBacktest('bob',{...bot,ownerUid:'bob'},started.runId,'completed',{trades:1})).rejects.toThrow();
 await expect(registry.liveTransition('alice',bot,{state:'deployment_pending',action:'deployment_authorized',grantId:'grant-a',expiresAt:99_999,limits:{riskUsd:2}})).rejects.toThrow('active backtest');
 const liveRegistry=new AgentRegistry(memory().store,time());await liveRegistry.liveTransition('alice',bot,{state:'running',action:'deployment_succeeded',grantId:'grant-a',expiresAt:99_999,limits:{riskUsd:2}});
 await expect(liveRegistry.startBacktest('alice',bot)).rejects.toThrow('live agent');
});

it('records live permissions, strategy revisions, stop revocation and lifecycle audit',async()=>{
 const {store}=memory(),registry=new AgentRegistry(store,time(10));
 await registry.liveTransition('alice',bot,{state:'deployment_pending',action:'deployment_authorized',grantId:'grant-a',expiresAt:90,limits:{riskUsd:2,leverage:1}});
 const deployed=await registry.liveTransition('alice',bot,{state:'running',action:'deployment_succeeded',grantId:'grant-a',expiresAt:90,limits:{riskUsd:2,leverage:1}});
 expect(deployed.permissions).toMatchObject({liveExecution:true,brokerStateRead:true,executionManagement:true});
 const revised={...bot,code:code.replace('riskPercent:0.5','riskPercent:0.25')};
 const stopped=await registry.liveTransition('alice',revised,{state:'stopped',action:'execution_stopped'});
 expect(stopped.strategy.revision).toBe(2);expect(stopped.permissions).toMatchObject({liveExecution:false,brokerStateRead:true});
 const events=await registry.audit('alice',deployed.id);expect(events.map(e=>e.action)).toEqual(['deployment_authorized','deployment_succeeded','execution_stopped']);
 expect(events[2].strategyVersion).toBe(stopped.strategy.version);
});

it('authenticates agent route access and rejects unowned bots for backtest records',async()=>{
 const {store}=memory(),registry=new AgentRegistry(store),app=express();app.use(express.json());
 agentRoutes(app,{uid:async(req,res)=>{const uid=req.header('x-fixture-uid');if(!uid){res.status(401).json({error:'Sign in'});return null}return uid},registry,bot:async(uid,id)=>uid==='alice'&&id===bot.id?bot:null});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}`;
 try{
  expect((await fetch(base+'/api/agents')).status).toBe(401);
  expect((await fetch(base+'/api/agents/backtest',{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Uid':'bob'},body:JSON.stringify({action:'start',botId:bot.id})})).status).toBe(400);
  const created=await fetch(base+'/api/agents/backtest',{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Uid':'alice'},body:JSON.stringify({action:'start',botId:bot.id})});expect(created.status).toBe(200);
  const data=await created.json() as any;expect(data.agent.ownerUid).toBe('alice');
  expect((await fetch(base+'/api/agents/backtest',{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Uid':'alice'},body:JSON.stringify({action:'heartbeat',botId:bot.id,runId:data.runId})})).status).toBe(200);
  expect((await fetch(base+'/api/agents/backtest',{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Uid':'alice'},body:JSON.stringify({action:'heartbeat',botId:bot.id,runId:'stale-run'})})).status).toBe(400);
  expect((await fetch(`${base}/api/agents/${data.agent.id}`,{headers:{'X-Fixture-Uid':'bob'}})).status).toBe(404);
  expect((await fetch(base+'/api/agents',{headers:{'X-Fixture-Uid':'alice'}})).status).toBe(200);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
