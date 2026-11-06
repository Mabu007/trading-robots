import {describe,it,expect,vi} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {FirestoreStore} from './firestore-store.ts';
import * as r2 from './r2.ts';

describe('Phase 2 signed HTTP approval / backtest safety path',()=>{
 it('requires a valid signed identity, proves exact approval single-use and computes from isolated provider fixture',async()=>{
  const originalEnv=Object.fromEntries(['FIREBASE_PROJECT_ID','VITE_FIREBASE_PROJECT_ID','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET','AI_SDK_STRATEGY_APPROVAL_ENABLED','AI_SDK_SERVER_BACKTEST_ENABLED'].map(k=>[k,process.env[k]]));
  Object.assign(process.env,{FIREBASE_PROJECT_ID:'test-project',VITE_FIREBASE_PROJECT_ID:'test-project',FIREBASE_CLIENT_EMAIL:'qa@example.test',FIREBASE_PRIVATE_KEY:'fixture',R2_ACCOUNT_ID:'fixture',R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture',R2_BUCKET:'fixture',AI_SDK_STRATEGY_APPROVAL_ENABLED:'true',AI_SDK_SERVER_BACKTEST_ENABLED:'true'});
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'qa-key',alg:'RS256'};
  const now=Math.floor(Date.now()/1000);
  const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned=encode({alg:'RS256',kid:'qa-key'})+'.'+encode({aud:'test-project',iss:'https://securetoken.google.com/test-project',sub:'qa-user',iat:now,exp:now+300});
  const token=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
  const metadata=new Map<string,any>([['users/qa-user/bots/qa-bot',{id:'qa-bot',name:'QA',asset:'BTC',venue:'hyperliquid',ownerUid:'qa-user'}]]);
  const objects=new Map<string,string>(),original='export const config={timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2};export function onCandle(){return {action:"WAIT"}};';
  const next=original.replace('riskReward:2','riskReward:3');
  objects.set('user-bots/cWEtdXNlcg/qa-bot/current.json',JSON.stringify({userId:'qa-user',botId:'qa-bot',venue:'hyperliquid',code:original}));
  let serial=Promise.resolve();
  vi.spyOn(FirestoreStore.prototype,'get').mockImplementation(async k=>metadata.get(k)||null);
  vi.spyOn(FirestoreStore.prototype,'put').mockImplementation(async(k,v)=>{metadata.set(k,v)});
  vi.spyOn(FirestoreStore.prototype,'create').mockImplementation(async(k,v)=>{if(metadata.has(k))return false;metadata.set(k,v);return true});
  vi.spyOn(FirestoreStore.prototype,'remove').mockImplementation(async k=>{metadata.delete(k)});
  vi.spyOn(FirestoreStore.prototype,'query').mockResolvedValue([]);
  vi.spyOn(FirestoreStore.prototype,'transaction').mockImplementation(async(keys,callback)=>{
    const action=serial.then(()=>{const changes=callback(keys.map(k=>metadata.get(k)||null));for(const [k,v]of Object.entries(changes))metadata.set(k,v)});
    serial=action.catch(()=>{});await action;
  });
  vi.spyOn(r2,'readR2Object').mockImplementation(async k=>objects.get(k)||null);
  vi.spyOn(r2,'writeR2Object').mockImplementation(async(k,v)=>{objects.set(k,v)});
  vi.spyOn(r2,'listR2Objects').mockImplementation(async(prefix)=>[...objects.keys()].filter(x=>x.startsWith(prefix)));
  vi.spyOn(r2,'deleteR2Object').mockImplementation(async key=>{objects.delete(key)});
  const rawFetch=globalThis.fetch;
  let providerRequests=0;
  vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const url=String(input);
    if(url.includes('securetoken@system.gserviceaccount.com'))return Response.json({keys:[jwk]});
    if(url==='https://api.hyperliquid.xyz/info'){
      const query=JSON.parse(String(init?.body||'{}'));if(query.type!=='candleSnapshot')throw Error('Unexpected provider query');
      providerRequests++;
      const {coin,interval,startTime,endTime}=query.req;
      const candles=Array.from({length:120},(_,i)=>({s:coin,i:interval,t:startTime+i*60000,o:'100',h:'101',l:'99',c:'100',v:'1'})).filter(x=>x.t<=endTime);
      return Response.json(candles);
    }
    return rawFetch(input,init);
  });
  let listener:any;
  try{
    const {default:app}=await import('./index.ts');
    listener=app.listen(0);
    const address=listener.address();if(!address||typeof address==='string')throw Error('Server unavailable');
    const base='http://127.0.0.1:'+address.port,post=(path:string,body:any,auth=true)=>rawFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    const anonymous=await post('/api/agent/strategy-reviews',{botId:'qa-bot',expectedCode:original,proposedCode:next},false);
    expect(anonymous.status).toBe(401);
    const capabilities=await rawFetch(base+'/api/agent/capabilities',{headers:{Authorization:'Bearer '+token}});
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({strategyApprovals:true,verifiedHyperliquidBacktest:true,financialAgentExecution:false});
    const staged=await post('/api/agent/strategy-reviews',{botId:'qa-bot',expectedCode:original,proposedCode:next});
    expect(staged.status).toBe(201);
    const body=await staged.json() as any;
    const ref='/api/agent/strategy-reviews/qa-bot/'+body.intentId;
    expect((await post(ref+'/apply',{})).status).toBe(409);
    expect((await post(ref+'/approve',{})).status).toBe(200);
    expect((await post(ref+'/apply',{})).status).toBe(200);
    expect((await post(ref+'/apply',{})).status).toBe(409);
    expect(JSON.parse(objects.get('user-bots/cWEtdXNlcg/qa-bot/current.json')!).code).toBe(next);
    const replay=await post('/api/agent/backtest/verify',{botId:'qa-bot',lookbackCandles:120});
    expect(replay.status).toBe(200);
    const result=await replay.json() as any;
    expect(result).toMatchObject({available:true,kind:'simulation',asset:'BTC',tradeCount:0});
    expect(result.coverage[0].count).toBe(120);
    expect(providerRequests).toBe(1);
    expect((await post('/api/agent/backtest/verify',{botId:'qa-bot',lookbackCandles:100})).status).toBe(400);
  }finally{
    if(listener)await new Promise<void>((resolve,reject)=>listener.close((e:Error)=>e?reject(e):resolve()));
    vi.restoreAllMocks();
    for(const [key,value]of Object.entries(originalEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 });
});