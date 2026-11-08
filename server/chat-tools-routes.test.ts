import {it,expect,vi} from 'vitest';
import express from 'express';
import {chatToolRoutes,plannerFailure} from './chat-tools';
async function fixture(run:(base:string,request:any,load:any)=>Promise<void>){
 const app=express();app.use(express.json());
 const load=vi.fn(async(uid:string)=>uid==='alice'?{apiKey:'secret-key',model:'fixture/model'}:null);
 const request=vi.fn(async()=>Response.json({choices:[{message:{tool_calls:[{type:'function',function:{name:'stop',arguments:'{}'}}]}}]}));
 chatToolRoutes(app,{load} as any,async(req,res)=>{const uid=req.header('authorization');if(!uid){res.status(401).json({error:'Unauthorized'});return null}return uid},request as any);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{await run(`http://127.0.0.1:${(server.address() as any).port}`,request,load)}finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}
it('authenticates before accessing credentials or model',()=>fixture(async(base,request,load)=>{const r=await fetch(base+'/api/chat/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Stop my bot'})});expect(r.status).toBe(401);expect(load).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled()}));
it('returns a confirmation request, never executes stop or exposes key',()=>fixture(async(base,request,load)=>{const r=await fetch(base+'/api/chat/plan',{method:'POST',headers:{'Content-Type':'application/json',authorization:'alice'},body:JSON.stringify({message:'Stop my bot',uid:'victim'})});expect(await r.json()).toEqual({tool:'stop',requiresConfirmation:true});expect(load).toHaveBeenCalledWith('alice');expect(request).toHaveBeenCalledTimes(1);expect(String(request.mock.calls[0][0])).toBe('https://openrouter.ai/api/v1/chat/completions')}));
it('isolates missing credentials without falling back to a shared key',()=>fixture(async(base,request)=>{const r=await fetch(base+'/api/chat/plan',{method:'POST',headers:{'Content-Type':'application/json',authorization:'bob'},body:JSON.stringify({message:'backtest'})});expect(r.status).toBe(409);expect(request).not.toHaveBeenCalled()}));

it('explains provider quota, invalid key, credits, and tool capability errors without suggesting the operation completed',()=>{
 expect(plannerFailure(429)).toMatchObject({status:429,error:expect.stringMatching(/rate-limit/i)});
 expect(plannerFailure(401)).toMatchObject({status:409,error:expect.stringMatching(/key/i)});
 expect(plannerFailure(402)).toMatchObject({status:402,error:expect.stringMatching(/credits/i)});
 expect(plannerFailure(422)).toMatchObject({status:422,error:expect.stringMatching(/tool-capable/i)});
});
it('returns the actual provider 429 with a recoverable explanation',()=>fixture(async(base,request)=>{
 request.mockResolvedValueOnce(Response.json({error:{message:'rate exceeded'}},{status:429}));
 const r=await fetch(base+'/api/chat/plan',{method:'POST',headers:{'Content-Type':'application/json',authorization:'alice'},body:JSON.stringify({message:'Create a Gold strategy on PropDAO'})});
 expect(r.status).toBe(429);
 const body=await r.json();
 expect(body.error).toMatch(/rate-limit/i);
 expect(body.error).toMatch(/not executed/i);
}));
