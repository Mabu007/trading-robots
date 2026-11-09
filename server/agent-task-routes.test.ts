import {afterEach,describe,it,expect,vi} from 'vitest';
import express from 'express';
import {registerAgentTaskRoutes,taskRuntimeConfigured} from './agent-task-routes';
import {initialTask} from '../shared/agent-task-state';

describe('owner-authorized durable task endpoints',()=>{
 const oldUrl=process.env.VIBES_TASK_WORKER_URL,oldSecret=process.env.VIBES_TASK_INTERNAL_SECRET;
 afterEach(()=>{
  if(oldUrl===undefined)delete process.env.VIBES_TASK_WORKER_URL;else process.env.VIBES_TASK_WORKER_URL=oldUrl;
  if(oldSecret===undefined)delete process.env.VIBES_TASK_INTERNAL_SECRET;else process.env.VIBES_TASK_INTERNAL_SECRET=oldSecret;
  vi.unstubAllGlobals();
 });
 it('does not pretend persistence exists when the Worker is not configured',()=>{
  delete process.env.VIBES_TASK_WORKER_URL;delete process.env.VIBES_TASK_INTERNAL_SECRET;
  expect(taskRuntimeConfigured()).toBe(false);
 });
 it('checks that configuration is HTTPS and internal secret is strong',()=>{
  process.env.VIBES_TASK_WORKER_URL='http://localhost:8787';
  process.env.VIBES_TASK_INTERNAL_SECRET='a'.repeat(32);
  expect(taskRuntimeConfigured()).toBe(false);
  process.env.VIBES_TASK_WORKER_URL='https://tasks.example.com';
  expect(taskRuntimeConfigured()).toBe(true);
 });
 it('starts a task under Firebase identity and rejects unrelated task identities from Worker',async()=>{
  process.env.VIBES_TASK_WORKER_URL='https://tasks.example.com';
  process.env.VIBES_TASK_INTERNAL_SECRET='x'.repeat(40);
  const originalFetch=globalThis.fetch.bind(globalThis);
  const fetchMock=vi.fn(async()=>Response.json({task:initialTask('owner123','task_AAABBBCCC','Research gold scalping')}));
  vi.stubGlobal('fetch',fetchMock);
  const app=express();app.use(express.json());
  registerAgentTaskRoutes(app,{uidOrReply:async()=> 'owner123',accounts:{} as any,market:{} as any,owned:async()=>null,read:async()=>null,write:async()=>{},tasks:{put:async()=>{},query:async()=>[],get:async()=>null,create:async()=>true} as any});
  const listener=app.listen(0);
  try{
   const port=(listener.address() as any).port;
   const response=await originalFetch('http://127.0.0.1:'+port+'/api/agent-tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({objective:'Research gold scalping opportunities and validate evidence'})});
   expect(response.status).toBe(503); // Mismatched DO id must not be trusted.
   expect(fetchMock).toHaveBeenCalledTimes(1);
  }finally{listener.close()}
 });
});
