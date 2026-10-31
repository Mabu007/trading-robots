import express from 'express';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import {legacyProviderGuard} from './legacy-provider-guard';

const app=express();app.use(express.json());app.use(legacyProviderGuard);app.post('/api/marketplace/bots/:id/deployment',(_req,res)=>res.json({ok:true}));app.post('/api/marketplace/bots/:id/subscribe',(_req,res)=>res.json({ok:true}));
let server:Server,base:string;
beforeAll(async()=>{vi.stubEnv('ENABLE_LEGACY_CTRADER','false');await new Promise<void>(r=>{server=app.listen(0,'127.0.0.1',()=>r())});base=`http://127.0.0.1:${(server.address() as {port:number}).port}`});
afterAll(async()=>{vi.unstubAllEnvs();await new Promise<void>(r=>server.close(()=>r()))});
it('parks legacy start and deploy while preserving stop and pause',async()=>{
 const post=async(path:string,action:string)=>(await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})})).status;
 const deployment='/api/marketplace/bots/test/deployment',subscription='/api/marketplace/bots/test/subscribe';
 expect(await post(deployment,'start')).toBe(409);expect(await post(deployment,'deploy')).toBe(409);expect(await post(deployment,'stop')).toBe(200);expect(await post(deployment,'undeploy')).toBe(200);
 expect(await post(subscription,'start')).toBe(409);expect(await post(subscription,'pause')).toBe(200);
});
