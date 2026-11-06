import {it,expect,vi} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {OpenRouterAccounts} from './openrouter-account.ts';
import {postApiStream} from '../src/api.ts';

it('authenticates a Firebase token and streams a model response through the SDK chat route',async()=>{
 const oldProject=process.env.FIREBASE_PROJECT_ID,oldWeb=process.env.VITE_FIREBASE_PROJECT_ID;
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256'};
 const now=Math.floor(Date.now()/1000);
 const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const unsigned=encode({alg:'RS256',kid:'test-key'})+'.'+encode({aud:'test-project',iss:'https://securetoken.google.com/test-project',sub:'test-user',iat:now,exp:now+300});
 const token=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
 process.env.FIREBASE_PROJECT_ID='test-project';process.env.VITE_FIREBASE_PROJECT_ID='test-project';
 const realFetch=globalThis.fetch;
 const mockFetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const url=String(input);
  if(url.includes('securetoken@system.gserviceaccount.com'))return Response.json({keys:[jwk]});
  if(url==='https://openrouter.ai/api/v1/chat/completions'){
   const sent=JSON.parse(String(init?.body));
   expect(sent.messages.some((x:{content:string})=>x.content==='Hello')).toBe(true);
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
  const text=await postApiStream(url,{messages:[{role:'user',content:'Hello'}]},'AI',(_chunk,full)=>chunks.push(full),undefined,token);
  expect(text).toBe('Hello trader');expect(chunks.at(-1)).toBe('Hello trader');
 }finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()));load.mockRestore();mockFetch.mockRestore();
  if(oldProject===undefined)delete process.env.FIREBASE_PROJECT_ID;else process.env.FIREBASE_PROJECT_ID=oldProject;
  if(oldWeb===undefined)delete process.env.VITE_FIREBASE_PROJECT_ID;else process.env.VITE_FIREBASE_PROJECT_ID=oldWeb;
 }
},15000);
