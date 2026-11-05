import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import {codeWatchRoutes} from './code-watch-routes';
import type {RecordStore} from './firestore-store';
describe('owner-scoped Code watch authorization',()=>{
 it('does not activate a watch without an explicit confirmation or enabled Worker',async()=>{
  const app=express();app.use(express.json());
  const records=new Map<string,any>([['users/alice/codeAnalyses/analysis-liquidity_sweeps-propdao-goldusdc-m1',{kind:'liquidity_sweeps',name:'Gold sweeps',asset:'GOLDUSDC',timeframe:'m1',lookback:5}]]);
  const store={get:vi.fn(async p=>records.get(p)||null),put:vi.fn(async(p,d)=>{records.set(p,d)}),query:vi.fn(async()=>[])} as unknown as RecordStore;
  const request=vi.fn(async()=>Response.json({running:true,events:[]}));
  codeWatchRoutes(app,{uid:async()=> 'alice',store,request:request as typeof fetch,env:{CODE_WATCH_ENABLED:'false'} as any});
  const server=app.listen(0);
  try{
   const port=(server.address() as any).port,url='http://127.0.0.1:'+port+'/api/code-watches/analysis-liquidity_sweeps-propdao-goldusdc-m1';
   const bad=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start'})});expect(bad.status).toBe(400);
   const blocked=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start',confirm:'START CODE WATCH'})});expect(blocked.status).toBe(503);
   expect(request).not.toHaveBeenCalled();
  }finally{server.close()}
 });
});
