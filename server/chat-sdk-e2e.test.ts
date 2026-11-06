import {it,expect,vi} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {OpenRouterAccounts} from './openrouter-account.ts';
import {postApiStream} from '../src/api.ts';
import * as r2 from './r2.ts';

it('authenticates a Firebase token and streams a model response through the SDK chat route',async()=>{
 const oldProject=process.env.FIREBASE_PROJECT_ID,oldWeb=process.env.VITE_FIREBASE_PROJECT_ID;
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256'};
 const now=Math.floor(Date.now()/1000);
 const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const unsigned=encode({alg:'RS256',kid:'test-key'})+'.'+encode({aud:'test-project',iss:'https://securetoken.google.com/test-project',sub:'test-user',iat:now,exp:now+300});
 const token=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
 process.env.FIREBASE_PROJECT_ID='test-project';process.env.VITE_FIREBASE_PROJECT_ID='test-project';
 let bookRequests=0,toolCalls=0,strategyCalls=0,backtestCalls=0;
 const simulation=Buffer.from(JSON.stringify({asset:'GOLDUSDC',from:'2026-01-01',to:'2026-01-02',logs:[],result:{candles:[{},{}],trades:[{id:1,pnl:-1}],metrics:{netReturn:-1}}}));
 const savedRead=vi.spyOn(r2,'readR2Object').mockImplementation(async(key)=>{
  if(key==='user-bots/dGVzdC11c2Vy/bot-1/current.json')return JSON.stringify({userId:'test-user',botId:'bot-1',code:'export function onCandle() {}'});
  if(key==='user-bots/dGVzdC11c2Vy/bot-1/backtest.json')return JSON.stringify({userId:'test-user',botId:'bot-1',format:'gzip-base64',version:2,payload:gzipSync(simulation).toString('base64'),uncompressedBytes:simulation.length});
  return null;
 });
 const realFetch=globalThis.fetch;
 const mockFetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const url=String(input);
  if(url.includes('securetoken@system.gserviceaccount.com'))return Response.json({keys:[jwk]});
  if(url==='https://api.hyperliquid.xyz/info'){
   bookRequests++;return Response.json({coin:'BTC',time:Date.now(),levels:[[{px:'99',sz:'1',n:1}],[{px:'101',sz:'2',n:1}]]});
  }
  if(url==='https://openrouter.ai/api/v1/chat/completions'){
   const sent=JSON.parse(String(init?.body));
   expect(sent.messages.some((x:{content:unknown})=>typeof x.content==='string'&&x.content.includes('untrusted evidence'))).toBe(true);
   const isBook=sent.messages.some((x:{content:unknown})=>x.content==='Book');
   const isStrategy=sent.messages.some((x:{content:unknown})=>x.content==='Strategy');
   const isBacktest=sent.messages.some((x:{content:unknown})=>x.content==='Backtest result');
   const seenTool=sent.messages.some((x:{role:string})=>x.role==='tool');
   if(isBacktest&&!seenTool){
    backtestCalls++;
    const events=[
     {id:'test',object:'chat.completion.chunk',created:now,model:'test/model',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_b',type:'function',function:{name:'getSavedBacktest',arguments:'{\"botId\":\"bot-1\"}'}}]},finish_reason:null}]},
     {id:'test',object:'chat.completion.chunk',created:now,model:'test/model',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}
    ];
    return new Response(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
   }
   if(isBacktest&&seenTool){backtestCalls++;expect(JSON.stringify(sent.messages)).toContain('simulation');expect(JSON.stringify(sent.messages)).toContain('netReturn');}
   if(isStrategy&&!seenTool){
    strategyCalls++;
    const events=[
     {id:'test',object:'chat.completion.chunk',created:now,model:'test/model',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_s',type:'function',function:{name:'getSavedStrategy',arguments:'{\"botId\":\"bot-1\"}'}}]},finish_reason:null}]},
     {id:'test',object:'chat.completion.chunk',created:now,model:'test/model',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}
    ];
    return new Response(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
   }
   if(isStrategy&&seenTool){strategyCalls++;expect(JSON.stringify(sent.messages)).toContain('export function onCandle');}
   if(isBook&&!seenTool){
    toolCalls++;
    const events=[
     {id:'test',object:'chat.completion.chunk',created:now,model:'test/model',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'getHyperliquidOrderBook',arguments:'{\"coin\":\"BTC\"}'}}]},finish_reason:null}]},
     {id:'test',object:'chat.completion.chunk',created:now,model:'test/model',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}
    ];
    return new Response(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
   }
   if(isBook&&seenTool)toolCalls++;
   const events=[
    {id:'test',object:'chat.completion.chunk',created:now,model:'test/model',choices:[{index:0,delta:{role:'assistant',content:'Hello trader'},finish_reason:null}]},
    {id:'test',object:'chat.completion.chunk',created:now,model:'test/model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}}
   ];
   return new Response(events.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  }
  return realFetch(input,init);
 });
 const load=vi.spyOn(OpenRouterAccounts.prototype,'load').mockResolvedValue({apiKey:'sk-or-v1-test',model:'test/model'});
 const {default:app}=await import('./index.ts');
 const server=app.listen(0);
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('no listener');
  const url='http://127.0.0.1:'+address.port+'/api/ai-sdk/stream';
  const rejected=await realFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Hello'}]})});
  expect(rejected.status).toBe(401);
  const chunks:string[]=[];
  const text=await postApiStream(url,{messages:[{role:'system',content:'Explain clearly.'},{role:'user',content:'Hello'}]},'AI',(_chunk,full)=>chunks.push(full),undefined,token);
  expect(text).toBe('Hello trader');expect(chunks.at(-1)).toBe('Hello trader');
  const book=await postApiStream(url,{messages:[{role:'user',content:'Book'}],includeMarketContext:true},'AI',()=>undefined,undefined,token);
  expect(book).toBe('Hello trader');expect(toolCalls).toBe(2);expect(bookRequests).toBe(1);
  const strategy=await postApiStream(url,{messages:[{role:'user',content:'Strategy'}],includeMarketContext:true},'AI',()=>undefined,undefined,token);
  expect(strategy).toBe('Hello trader');expect(strategyCalls).toBe(2);
  expect(savedRead).toHaveBeenCalledWith('user-bots/dGVzdC11c2Vy/bot-1/current.json');
  const backtest=await postApiStream(url,{messages:[{role:'user',content:'Backtest result'}],includeMarketContext:true},'AI',()=>undefined,undefined,token);
  expect(backtest).toBe('Hello trader');expect(backtestCalls).toBe(2);
  expect(savedRead).toHaveBeenCalledWith('user-bots/dGVzdC11c2Vy/bot-1/backtest.json');
 }finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()));load.mockRestore();mockFetch.mockRestore();savedRead.mockRestore();
  if(oldProject===undefined)delete process.env.FIREBASE_PROJECT_ID;else process.env.FIREBASE_PROJECT_ID=oldProject;
  if(oldWeb===undefined)delete process.env.VITE_FIREBASE_PROJECT_ID;else process.env.VITE_FIREBASE_PROJECT_ID=oldWeb;
 }
},15000);
