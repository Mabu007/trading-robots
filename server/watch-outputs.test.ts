import express from 'express';
import {it,expect,vi} from 'vitest';
import {watchOutputs} from './watch-outputs.ts';
import type {OpenRouterAccounts} from './openrouter-account.ts';
import type {RecordStore,RecordData} from './firestore-store.ts';

it('delivers only a new authorized detection once and stops further outputs after revocation',async()=>{
 vi.stubEnv('CODE_WATCH_OUTPUTS_ENABLED','true');
 const secret='fixture-internal-secret-longer-than-32';
 vi.stubEnv('CODE_WATCH_INTERNAL_SECRET',secret);
 let now=Date.parse('2026-11-07T09:00:00Z');
 vi.spyOn(Date,'now').mockImplementation(()=>now);
 const rows=new Map<string,RecordData>();
 const store:RecordStore={
  get:async k=>rows.get(k)||null,put:async(k,v)=>{rows.set(k,v);},query:async()=>[],create:async()=>false,
  transaction:async(keys,change)=>{for(const [key,value] of Object.entries(change(keys.map(k=>rows.get(k)||null))))rows.set(key,value);}
 };
 const originFetch=fetch;
 const model=vi.fn(async()=>Response.json({choices:[{message:{content:'A Gold detection was recorded.'}}]}));
 vi.stubGlobal('fetch',(url:RequestInfo|URL,options?:RequestInit)=>String(url).startsWith('https://openrouter.ai/')?model():originFetch(url,options));
 const app=express().use(express.json());
 const outputs=watchOutputs(app,store,{load:async()=>({apiKey:'test-only',model:'fixture'})} as unknown as OpenRouterAccounts);
 const server=app.listen(0);
 try{
  const addr=server.address();if(!addr||typeof addr==='string')throw Error('Listener unavailable');
  const id='analysis-gold-test';
  const version=await outputs.start('alice',id,'GOLDUSDC','m1',{type:'ai'});
  now+=120_000;
  const time=(now-60_000)/1000,event={id:id+':'+time+':sweep',time,kind:'Sweep',level:2000,price:2001};
  const post=(authorization:string,outputVersion=version,input=event)=>originFetch('http://127.0.0.1:'+addr.port+'/api/internal/code-watch-event',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({uid:'alice',id,outputVersion,event:input})});
  expect((await post('Bearer wrong')).status).toBe(401);
  expect(await (await post('Bearer '+secret,version+1)).json()).toMatchObject({status:'skipped'});
  expect(await (await post('Bearer '+secret)).json()).toMatchObject({status:'completed'});
  expect(await (await post('Bearer '+secret)).json()).toMatchObject({status:'skipped'});
  await outputs.stop('alice',id);
  now+=900_000;
  const later=(now-60_000)/1000;
  expect(await (await post('Bearer '+secret,version,{...event,time:later,id:id+':'+later+':sweep'})).json()).toMatchObject({status:'skipped'});
  expect(model).toHaveBeenCalledTimes(1);
 }finally{server.close();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();}
});
