import {afterEach,describe,expect,it,vi} from 'vitest';
import {PropDAOLiveService} from './propdao-live-routes.ts';
import {starterCode} from '../src/strategy.ts';
import {gzipSync} from 'node:zlib';
import type {PropDAOAccounts} from './propdao-account.ts';

afterEach(()=>vi.unstubAllEnvs());
const setup=(strictReviews=false)=>{
 const saved=new Map<string,string>();
 if(strictReviews){
  const body={venue:'propdao',asset:'BTCUSDC',strategyCode:starterCode,riskPercent:1,from:'2026-11-01',to:'2026-11-02',
   result:{timeframe:'m1',source:'test fixture candles',candles:[{time:1,open:100,high:101,low:99,close:100,volume:1}],trades:[],metrics:{trades:0}}};
  const bytes=Buffer.from(JSON.stringify(body)),payload=gzipSync(bytes).toString('base64');
  saved.set(`user-bots/${Buffer.from('alice').toString('base64url')}/bot-1/backtest.json`,JSON.stringify({format:'gzip-base64',version:2,payload,uncompressedBytes:bytes.length,userId:'alice',botId:'bot-1',savedAt:'2026-11-03T00:00:00.000Z'}));
 }
 const storage={read:vi.fn(async(k:string)=>saved.get(k)??null),write:vi.fn(async(k:string,v:string)=>{saved.set(k,v)}),remove:vi.fn(async(k:string)=>{saved.delete(k)}),list:vi.fn(async(prefix:string)=>[...saved.keys()].filter(k=>k.startsWith(prefix)))};
 const accounts={
  accountRisk:vi.fn(async()=>({account:{status:'active'},risk:{equity:1000,roomUsd:50,breached:false},positions:[],orders:[]})),
  getPublicMarkets:vi.fn(async()=>({data:[{symbol:'BTCUSDC',coin:'BTC',dex:null,lotStep:0.00001,maxLeverage:2}],fees:{taker:0.00045}})),
  executeOrder:vi.fn(async()=>({intentId:'test',protected:true})),
  recentTrades:vi.fn(async()=>[]),
 };
 const fetcher=vi.fn(async(url:string)=>String(url).endsWith('/health')?Response.json({ready:true}):Response.json({grant:null,running:false,paused:false,pendingIntent:null,events:['authorized']}));
 const svc=new PropDAOLiveService({...storage,unsafeLegacyDeployForTests:!strictReviews,uid:async()=> 'alice',bot:async()=>({asset:'BTCUSDC',venue:'propdao',code:starterCode}),accounts:accounts as unknown as PropDAOAccounts,request:fetcher as unknown as typeof fetch});
 return {svc,fetcher,accounts,saved,storage};
};
describe('PropDAO live execution authorization',()=>{
 it('blocks deletion while a bot is running or its runtime cannot be verified',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved}=setup();
  await svc.assertDeletable('alice','bot-1');
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const grant=JSON.parse([...saved.values()][0]);
  fetcher.mockImplementation(async(url:string)=>String(url).endsWith('/health')?Response.json({ready:true}):Response.json({grant:{id:grant.id},running:true,paused:false,pendingIntent:null}));
  await expect(svc.assertDeletable('alice','bot-1')).rejects.toThrow(/Stop and reconcile/);
  fetcher.mockRejectedValue(Error('offline'));
  await expect(svc.assertDeletable('alice','bot-1')).rejects.toThrow(/Stop and reconcile/);
 });
 it('is fail-closed without a verified Cloudflare Worker and secret',async()=>{
  const {svc,fetcher}=setup();
  vi.stubEnv('PROPDAO_LIVE_ENABLED','false');
  const state=await svc.status('alice','bot-1');
  expect(state.configured).toBe(false);
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any)).rejects.toThrow(/not ready/);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('returns broker pending orders separately from unresolved execution intent',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,accounts,saved,fetcher}=setup();
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const grant=JSON.parse([...saved.values()][0]);
  fetcher.mockImplementation(async(url:string)=>{
   if(String(url).endsWith('/health'))return Response.json({ready:true});
   return Response.json({grant:{id:grant.id},running:true,paused:false,pendingIntent:{intentId:'tv-unknown'}});
  });
  accounts.accountRisk.mockResolvedValueOnce({account:{status:'active'},risk:{equity:1000,roomUsd:50,breached:false},positions:[],orders:[{id:'order-42',symbol:'BTCUSDC',side:'BUY',qty:0.5,price:99.8,status:'PENDING',orderType:'LIMIT',privateField:'do not return'}]} as any);
  const state=await svc.status('alice','bot-1');
  expect(state.pendingOrders).toEqual([{id:'order-42',symbol:'BTCUSDC',side:'BUY',qty:0.5,price:99.8,status:'PENDING',type:'LIMIT',createdAt:null}]);
  expect(state.pendingIntent).toEqual({intentId:'tv-unknown'});
  expect(JSON.stringify(state)).not.toContain('do not return');
 });
 it('isolates bots on the same account while keeping order submission separately gated',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,accounts,saved}=setup();
  accounts.accountRisk.mockResolvedValue({account:{status:'active'},risk:{equity:1000,roomUsd:50,breached:false},positions:[{id:'other-position'}],orders:[]} as any);
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  await svc.deploy('alice','bot-2',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const grants=[...saved.values()].map(raw=>JSON.parse(raw));
  expect(grants).toHaveLength(2);expect(grants.map(g=>g.runtimeScope)).toEqual(['bot','bot']);
  expect(grants[0].id).not.toBe(grants[1].id);
  const deployed=fetcher.mock.calls.map(([url])=>new URL(String(url)).pathname).filter(path=>path.endsWith('/deploy'));
  expect(deployed).toHaveLength(2);expect(deployed[0]).not.toBe(deployed[1]);
  expect(accounts.executeOrder).not.toHaveBeenCalled();
 });
 it('blocks only when the account-wide execution lock is genuinely unresolved',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved}=setup();
  const lockId=(await import('node:crypto')).createHash('sha256').update('propdao-execution:alice:prop-1').digest('hex');
  fetcher.mockImplementation(async(url:string)=>{
   if(String(url).endsWith('/health'))return Response.json({ready:true});
   if(String(url).includes(lockId))return Response.json({running:false,accountLock:{intentId:'tv-prior-1700000000',botId:'bot-other'}});
   return Response.json({running:false,paused:false,pendingIntent:null});
  });
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:1,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any)).rejects.toThrow(/unresolved order/);
  expect(saved.size).toBe(0);
 });
 it('Stop deletes the old grant and fresh Deploy creates a new identity',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,saved}=setup();
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const previous=JSON.parse([...saved.values()][0]);
  const stopped=await svc.stop('alice','bot-1');
  expect(stopped).toMatchObject({running:false,deployed:false,stopped:true});
  expect(saved.size).toBe(0);
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const current=JSON.parse([...saved.values()][0]);
  expect(current.id).not.toBe(previous.id);expect(current.runtimeScope).toBe('bot');
 });
 it('requires explicit authorization and rejects unavailable account risk',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,accounts}=setup();
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1}} as any)).rejects.toThrow(/Explicit/);
  accounts.accountRisk.mockResolvedValueOnce({account:{status:'active'},risk:{equity:1000,roomUsd:3,breached:false},positions:[],orders:[]});
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any)).rejects.toThrow(/risk room/);
  expect(fetcher).toHaveBeenCalledTimes(1); // readiness only; no deployment call
 });
 it('stores an account-scoped grant, authorizes worker provider only, blocks key changes while running',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));vi.stubEnv('VERCEL_ENV','preview');
  const {svc,fetcher,accounts,saved}=setup();
  const result=await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  expect(result.running).toBe(false);
  const grant=JSON.parse([...saved.values()][0]);
  expect(grant.codeHash).toMatch(/^[a-f0-9]{64}$/);
  expect(grant.uid).toBe('alice');expect(grant.accountId).toBe('prop-1');
  expect(JSON.stringify(saved)).not.toContain('pd_live_');
  await expect(svc.provider({uid:'bob',botId:'bot-1',grantId:grant.id,action:'execute',payload:{}})).rejects.toThrow();
  await expect(svc.provider({uid:'alice',botId:'bot-1',grantId:grant.id,action:'execute',payload:{symbol:'BTCUSDC',intentId:'invalid'}})).rejects.toThrow(/match/);
  const payload={symbol:'BTCUSDC',intentId:`tv-${grant.id}-1700000000`,candleClose:1700000000,side:'BUY',price:100,stop:99,target:103,quoteTime:Date.now()};
  await svc.provider({uid:'alice',botId:'bot-1',grantId:grant.id,action:'execute',payload});
  expect(accounts.executeOrder).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async(url:string)=>{
   if(String(url).endsWith('/health'))return Response.json({ready:true});
   if(String(url).endsWith('/status'))return Response.json({grant:{id:grant.id,botId:'bot-1'},running:true,paused:false,pendingIntent:null});
   return Response.json({running:true});
  });
  await expect(svc.beforeCredentialChange('alice')).rejects.toThrow(/Stop and reconcile/);
  expect(fetcher).toHaveBeenCalled();
 });
 it('checks connectivity while entries are disabled and rejects deployment',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','false');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher}=setup();
  expect(await svc.health()).toMatchObject({configured:false,connected:true,error:'Runtime connected. Automated trading is disabled.'});
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any)).rejects.toThrow(/not ready/);
  expect(fetcher.mock.calls.every(call=>String(call[0]).endsWith('/health'))).toBe(true);
 });
 it('revokes provider permission even when the Worker stop request fails',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved,accounts}=setup();
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const grant=JSON.parse([...saved.values()][0]);
  fetcher.mockRejectedValueOnce(new Error('Worker offline'));
  const stopped=await svc.stop('alice','bot-1');
  expect(stopped).toMatchObject({authorizationRevoked:true,runtimeStopped:false,uncertain:true,needsReconciliation:true});
  await expect(svc.provider({uid:'alice',botId:'bot-1',grantId:grant.id,action:'execute'})).rejects.toThrow(/authorization expired/);
  expect(accounts.executeOrder).not.toHaveBeenCalled();
 });
 it('reports uncertainty when a saved deployment cannot be reached',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher}=setup();
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  fetcher.mockRejectedValueOnce(new Error('Worker offline'));
  expect(await svc.status('alice','bot-1')).toMatchObject({running:false,uncertain:true,connected:false});
 });

 it('does not overwrite authorization when the account worker has a pending order',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved}=setup();
  fetcher.mockImplementation(async(url:string)=>{
   if(String(url).endsWith('/health'))return Response.json({ready:true});
   if(String(url).endsWith('/status'))return Response.json({running:false,paused:false,pendingIntent:{intentId:'tv-old-1700000000'}});
   return Response.json({error:'unexpected deploy'},{status:400});
  });
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any)).rejects.toThrow(/Unresolved prior order/);
  expect(saved.size).toBe(0);
  expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/deploy'))).toBe(false);
 });
 it('rolls back a grant on definite worker rejection without retrying the order',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved,storage}=setup();
  fetcher.mockImplementation(async(url:string)=>{
   if(String(url).endsWith('/health'))return Response.json({ready:true});
   if(String(url).endsWith('/status'))return Response.json({running:false,paused:false,pendingIntent:null});
   return Response.json({error:'Unresolved prior order. Operator reconciliation required before redeployment.'},{status:400});
  });
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any)).rejects.toThrow(/Unresolved prior order/);
  expect(storage.remove).toHaveBeenCalledTimes(1);
  expect(saved.size).toBe(0);
 });
 it('requires an explicit reconciliation confirmation and an existing grant',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher}=setup();
  await expect(svc.reconcile('alice','bot-1',{body:{confirm:'yes'}} as any)).rejects.toThrow(/Check the PropDAO account/);
  await expect(svc.reconcile('alice','bot-1',{body:{confirm:'I VERIFIED PROPDAO HAS NO OPEN ORDERS OR POSITIONS'}} as any)).rejects.toThrow(/Select the PropDAO account/);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('finds an old bot pending intent by account and reconciles without staging a new grant',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved,accounts}=setup();
  fetcher.mockImplementation(async(url:string)=>{
   if(String(url).endsWith('/health'))return Response.json({ready:true});
   if(String(url).endsWith('/status'))return Response.json({grant:{id:'prior',botId:'old-bot'},running:false,paused:false,pendingIntent:{intentId:'tv-prior-1700000000',symbol:'BTCUSDC'}});
   if(String(url).endsWith('/reconcile'))return Response.json({reconciled:true,pendingIntent:null,running:false});
   return Response.json({error:'Unexpected route'},{status:400});
  });
  const state=await svc.status('alice','new-bot','prop-1');
  expect(state).toMatchObject({deployed:false,accountId:'prop-1',blockingBotId:'old-bot',pendingIntent:{intentId:'tv-prior-1700000000'}});
  const cleared=await svc.reconcile('alice','new-bot',{body:{confirm:'I VERIFIED PROPDAO HAS NO OPEN ORDERS OR POSITIONS',accountId:'prop-1'}} as any);
  expect(cleared).toMatchObject({reconciled:true,pendingIntent:null});
  expect(saved.size).toBe(0);
  expect(accounts.accountRisk).toHaveBeenCalled();
 });
 it('requires a saved owner authorization before reading live market candles',async()=>{
  const {svc}=setup();
  await expect(svc.market('alice','bot-1')).rejects.toThrow(/No PropDAO deployment/);
 });
 it('serves validated fresh Hyperliquid candles for an authorized PropDAO workspace',async()=>{
  vi.stubEnv('VERCEL_ENV','development');vi.stubEnv('PROPDAO_LIVE_ENABLED','true');
  vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');
  vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','x'.repeat(40));
  const {svc,fetcher}=setup();
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:1,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const candleStart=Math.floor(Date.now()/60000)*60000;
  fetcher.mockImplementation(async(url:string)=>String(url)==='https://api.hyperliquid.xyz/info'
   ?Response.json([{t:candleStart,o:'100',h:'102',l:'99',c:'101',v:'1000'}])
   :Response.json({ready:true}));
  const market=await svc.market('alice','bot-1');
  expect(market).toMatchObject({source:'Hyperliquid',symbol:'BTCUSDC',timeframe:'m1',fresh:true});
  expect(market.candles).toHaveLength(1);
  expect(market.candles[0].close).toBe(101);
  await expect(svc.market('bob','bot-1')).rejects.toThrow(/No PropDAO deployment/);
 });
 it('permits pause/resume only with an unrevoked authorized grant and checked account',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved}=setup();
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const grant=JSON.parse([...saved.values()][0]);
  fetcher.mockImplementation(async(url:string)=>{
   const path=String(url);
   if(path.endsWith('/health'))return Response.json({ready:true});
   if(path.endsWith('/status'))return Response.json({grant:{id:grant.id},running:false,paused:true,events:[],pendingIntent:null});
   if(path.endsWith('/pause'))return Response.json({running:false,paused:true});
   if(path.endsWith('/resume'))return Response.json({running:true,paused:false});
   if(path.endsWith('/stop'))return Response.json({running:false});
   return Response.json({error:'Unknown'},{status:404});
  });
  const paused=await svc.pause('alice','bot-1');expect(paused).toMatchObject({running:false,paused:true});
  const status=await svc.status('alice','bot-1');expect(status.canResume).toBe(true);
  const resumed=await svc.resume('alice','bot-1',{} as any);expect(resumed).toMatchObject({running:true,paused:false});
  expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/resume'))).toBe(true);
  await svc.stop('alice','bot-1');
  await expect(svc.resume('alice','bot-1',{} as any)).rejects.toThrow(/authorization has ended/);
 });
 it('rejects pause and resume without an account-scoped grant',async()=>{
  const {svc}=setup();await expect(svc.pause('alice','bot-1')).rejects.toThrow(/No active/);
  await expect(svc.resume('alice','bot-1',{} as any)).rejects.toThrow(/authorization has ended/);
 });
});


describe('revision- and account-bound PropDAO deployment review',()=>{
 const setupReady=()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');
  vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');
  vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  return setup(true);
 };
 const requestBody={accountId:'prop-1',riskUsd:2,leverage:1};
 const auth='I AUTHORIZE PROPDAO SIMULATED LIVE TRADING';
 it('requires a review even when a legacy client supplies a confirmation string',async()=>{
  const {svc,saved}=setupReady();
  await expect(svc.deploy('alice','bot-1',{body:{...requestBody,confirm:auth}} as any)).rejects.toThrow(/fresh deployment review/);
  expect([...saved.keys()].filter(key=>key.includes('propdao-live/v1')).length).toBe(0);
 });
 it('pins the reviewed code hash, instrument and exact account and consumes only once',async()=>{
  const {svc}=setupReady();
  const reviewed=await svc.review('alice','bot-1',{body:requestBody} as any);
  expect(reviewed).toMatchObject({accountId:'prop-1',symbol:'BTCUSDC',riskUsd:2,leverage:1,backtest:{from:'2026-11-01',provenance:'client-produced-research'}});
  const body={...requestBody,reviewId:reviewed.reviewId,expectedCodeHash:reviewed.codeHash,confirm:auth};
  await expect(svc.deploy('alice','bot-1',{body:{...body,accountId:'prop-2'}} as any)).rejects.toThrow(/changed since review/);
  await svc.deploy('alice','bot-1',{body} as any);
  await expect(svc.deploy('alice','bot-1',{body} as any)).rejects.toThrow(/Existing deployment authorization/);
  await expect(svc.review('alice','bot-1',{body:requestBody} as any)).rejects.toThrow(/already exists/);
  await svc.stop('alice','bot-1');
  await expect(svc.deploy('alice','bot-1',{body} as any)).rejects.toThrow(/already used/);
 });
 it('rejects modified risk, stale source hashes, and expired reviews',async()=>{
  const {svc}=setupReady();
  const reviewed=await svc.review('alice','bot-1',{body:requestBody} as any);
  const base={...requestBody,reviewId:reviewed.reviewId,expectedCodeHash:reviewed.codeHash,confirm:auth};
  await expect(svc.deploy('alice','bot-1',{body:{...base,riskUsd:3}} as any)).rejects.toThrow(/changed since review/);
  await expect(svc.deploy('alice','bot-1',{body:{...base,expectedCodeHash:'a'.repeat(64)}} as any)).rejects.toThrow(/changed since review/);
  vi.useFakeTimers();
  try{
   vi.setSystemTime(reviewed.expiresAt+1);
   await expect(svc.deploy('alice','bot-1',{body:base} as any)).rejects.toThrow(/expired/);
  }finally{vi.useRealTimers()}
 });
});
