import {it,expect,vi} from 'vitest';
import express from 'express';
import {chatToolRoutes} from './chat-tools.ts';
it('uses the SDK planner to propose, but never execute or authorize, an action',async()=>{
 const app=express();app.use(express.json());
 const load=vi.fn(async(uid:string)=>uid==='alice'?{apiKey:'fixture-key',model:'fixture/model'}:null);
 const modelFetch=vi.fn(async()=>Response.json({id:'fixture',object:'chat.completion',created:1,model:'fixture/model',choices:[{index:0,finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'stop',arguments:'{}'}}]}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
 chatToolRoutes(app,{load} as any,async(req,res)=>{const uid=req.header('authorization');if(!uid){res.status(401).json({error:'Unauthorized'});return null}return uid},modelFetch as any);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{
  const base='http://127.0.0.1:'+(server.address() as any).port;
  const noAuth=await fetch(base+'/api/chat/sdk-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'Stop'})});
  expect(noAuth.status).toBe(401);expect(load).not.toHaveBeenCalled();
  const r=await fetch(base+'/api/chat/sdk-plan',{method:'POST',headers:{'content-type':'application/json',authorization:'alice'},body:JSON.stringify({message:'Stop my bot',uid:'victim'})});
  expect(r.status).toBe(200);expect(await r.json()).toEqual({tool:'stop',requiresConfirmation:true});
  expect(load).toHaveBeenCalledWith('alice');expect(modelFetch).toHaveBeenCalledTimes(1);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
