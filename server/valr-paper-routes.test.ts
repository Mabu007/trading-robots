import express from 'express';
import { afterAll,beforeAll,expect,it,vi } from 'vitest';
import type { Server } from 'node:http';
import { paperInstanceId,valrPaperRoutes } from './valr-paper-routes';

const code='export const config={timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2};export function onCandle(){return {action:"WAIT"}}';
const request=vi.fn(async()=>Response.json({deployed:true,state:{running:false}}));
const app=express();app.use(express.json());
valrPaperRoutes(app,{uid:async(req,res)=>{const uid=req.header('x-test-user');if(!uid){res.status(401).json({error:'Sign in'});return null}return uid},bot:async(uid,id)=>uid==='alice'&&id==='bot'?{asset:'ETHZAR',code}:null,request:request as typeof fetch,base:()=> 'https://runtime.example',secret:()=> 'test-internal-secret'});
let server:Server,base:string;
beforeAll(async()=>{await new Promise<void>(r=>{server=app.listen(0,'127.0.0.1',()=>r())});base=`http://127.0.0.1:${(server.address() as {port:number}).port}`});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()))});
it('requires sign-in and deploys only the signed-in owner’s source under an isolated identifier',async()=>{
 expect((await fetch(`${base}/api/valr/bots/bot/paper`)).status).toBe(401);
 const body={action:'deploy',asset:'FORGED',code:'FORGED',balance:1000,allocation:500,riskPercent:1,dailyLossPercent:3};
 const post=(uid:string)=>fetch(`${base}/api/valr/bots/bot/paper`,{method:'POST',headers:{'Content-Type':'application/json','x-test-user':uid},body:JSON.stringify(body)});
 expect((await post('bob')).status).toBe(400);
 const response=await post('alice');expect(response.status).toBe(200);
 const [url,options]=request.mock.calls.at(-1) as unknown as [URL,RequestInit];
 expect(url.pathname).toBe(`/paper/${paperInstanceId('alice','bot')}/deploy`);
 expect(paperInstanceId('alice','bot')).not.toBe(paperInstanceId('bob','bot'));
 expect(JSON.parse(String(options.body))).toMatchObject({pair:'ETHZAR',code});
 expect(JSON.stringify(await response.json())).not.toContain(code);
});
