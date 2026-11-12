import {createHash} from 'node:crypto';
const ownerHash=(v:string)=>createHash('sha256').update(v).digest('hex');
import {it,expect,vi} from 'vitest';
import express from 'express';
vi.mock('ai',async original=>({...await original<any>(),generateText:vi.fn(async()=>({text:'The saved Gold alert matched c1. No broker order was placed.'}))}));
import {generateText} from 'ai';
import {marketAlertRoutes} from './market-alert-service';
it('links Telegram, authorizes owned rules, dispatches once and replies with the original alert context over HTTP',async()=>{
 const docs=new Map<string,any>(),sent:any[]=[];const store={remove:async(p:string)=>{docs.delete(p)},get:async(p:string)=>docs.get(p)||null,put:async(p:string,v:any)=>{docs.set(p,v)},create:async(p:string,v:any)=>{if(docs.has(p))return false;docs.set(p,v);return true},query:async(p:string)=>[...docs].filter(([k])=>k.startsWith(p+'/')).map(([,v])=>v),transaction:async(paths:string[],fn:any)=>{for(const [p,v]of Object.entries(fn(paths.map(p=>docs.get(p)||null))))docs.set(p,v)}};
 const secret='s'.repeat(32),env={TELEGRAM_BOT_TOKEN:'fixture-only',TELEGRAM_BOT_USERNAME:'vibes_bot',TELEGRAM_WEBHOOK_SECRET:secret,ALERT_SECRET:secret,MARKET_ALERT_RUNTIME_URL:'https://worker.example'};
 const request=async(url:any,init:any)=>{if(String(url).includes('api.telegram.org')){sent.push(JSON.parse(init.body));return Response.json({ok:true,result:{message_id:sent.length}})}return Response.json({running:true,events:[]});};
 const app=express();app.use(express.json());marketAlertRoutes(app,{store,env,request:request as any,uid:async(req,res)=>{const uid=req.header('x-test-user');if(!uid){res.sendStatus(401);return null;}return uid;},accounts:{load:async()=>({apiKey:'fixture-only',model:'fixture/model'})} as any,read:async()=>null});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.on('listening',resolve));const base='http://127.0.0.1:'+(server.address() as any).port;
 const post=(path:string,body:any,headers:any={'x-test-user':'alice'})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  expect((await post('/api/telegram/link',{},{})).status).toBe(401);
  const link=await (await post('/api/telegram/link',{})).json() as any,token=new URL(link.url).searchParams.get('start');
  const update={update_id:1,message:{chat:{id:123,type:'private'},from:{id:123},text:'/start '+token}};
  expect((await post('/api/telegram/webhook',update,{})).status).toBe(401);
  await post('/api/telegram/webhook',update,{'x-telegram-bot-api-secret-token':secret});
  expect(docs.get('serverTelegramUsers/'+ownerHash('alice')).active).toBe(true);
  const rule={name:'Gold',symbol:'XAUUSD',timeframe:'m5',mode:'all',conditions:[{id:'c1',kind:'above',value:100}],notifyStages:false,cooldownSeconds:300,sequenceSeconds:600,expiresAt:Math.floor(Date.now()/1000)+86400,repeat:true,session:null,basis:'completed-candle',strategy:null};
  const row=await (await post('/api/market-alerts',rule)).json() as any;
  expect((await fetch(base+'/api/market-alerts/'+row.id,{headers:{'x-test-user':'bob'}})).status).toBe(400);
  expect((await post('/api/market-alerts/'+row.id+'/control',{action:'start',revision:row.revision})).status).toBe(200);
  const event={id:row.revision+':fixture',time:Math.floor(Date.now()/1000),matched:['c1'],complete:true,price:105};
  for(let i=0;i<2;i++)await post('/api/internal/market-alert-event',{uid:'alice',id:row.id,revision:row.revision,event},{authorization:'Bearer '+secret});
  expect(sent).toHaveLength(2); // connection confirmation + one event
  await post('/api/telegram/webhook',{update_id:2,message:{chat:{id:123,type:'private'},from:{id:123},text:'What happened?',reply_to_message:{message_id:2}}},{'x-telegram-bot-api-secret-token':secret});
  expect(sent).toHaveLength(3);expect(vi.mocked(generateText).mock.calls.at(-1)?.[0].system).toContain(row.revision);
  await post('/api/telegram/webhook',{update_id:2,message:{chat:{id:123,type:'private'},from:{id:123},text:'What happened?'}},{'x-telegram-bot-api-secret-token':secret});expect(sent).toHaveLength(3);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
