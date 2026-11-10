import {afterEach,describe,expect,it,vi} from 'vitest';
import {PropDAOLiveService} from './propdao-live-routes.ts';
import {starterCode} from '../src/strategy.ts';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {simulate} from '../src/engine.ts';
import type {PropDAOAccounts} from './propdao-account.ts';

afterEach(()=>vi.unstubAllEnvs());
const setup=(strictReviews=false)=>{
 const saved=new Map<string,string>();
 if(strictReviews){
  const body={venue:'propdao',asset:'BTCUSDC',strategyCode:starterCode,riskPercent:1,from:'2026-11-01',to:'2026-11-02',
   result:{...simulate([{time:Date.parse('2026-11-01T00:00:00Z')/1000,open:100,high:101,low:99,close:100,volume:1},{time:Date.parse('2026-11-01T00:01:00Z')/1000,open:100,high:102,low:99,close:100,volume:1}],[{action:'WAIT'},{action:'WAIT'}]),timeframe:'m1',source:'test fixture candles'}};
  const bytes=Buffer.from(JSON.stringify(body)),payload=gzipSync(bytes).toString('base64');
  saved.set(`user-bots/${Buffer.from('alice').toString('base64url')}/bot-1/backtest.json`,JSON.stringify({format:'gzip-base64',version:2,payload,uncompressedBytes:bytes.length,userId:'alice',botId:'bot-1',savedAt:'2026-11-03T00:00:00.000Z'}));
 }
 const storage={read:vi.fn(async(k:string)=>saved.get(k)??null),write:vi.fn(async(k:string,v:string)=>{saved.set(k,v)}),remove:vi.fn(async(k:string)=>{saved.delete(k)}),list:vi.fn(async(prefix:string)=>[...saved.keys()].filter(k=>k.startsWith(prefix)))};
 const accounts={
  list:vi.fn(async()=>({connected:true,accounts:[{accountId:'prop-1',status:'active'}]})),
  accountRisk:vi.fn(async()=>({account:{status:'active'},risk:{equity:1000,roomUsd:50,breached:false},positions:[],orders:[]})),
  getPublicMarkets:vi.fn(async()=>({data:[{symbol:'BTCUSDC',coin:'BTC',dex:null,lotStep:0.00001,maxLeverage:2}],fees:{taker:0.00045}})),
  executeOrder:vi.fn(async()=>({intentId:'test',protected:true})),
  recentTrades:vi.fn(async()=>[]),
 };
 const fetcher=vi.fn(async(url:string,_init?:RequestInit)=>String(url).endsWith('/health')?Response.json({ready:true}):Response.json({grant:null,running:false,paused:false,pendingIntent:null,events:['authorized']}));
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
 it('combines two owned robot Workers and does not mix other accounts',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');
  vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');
  vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved}=setup();
  const prefix='propdao-live/v1/'+(process.env.VERCEL_ENV||'development')+'/'+Buffer.from('alice').toString('base64url')+'/';
  const grant=(botId:string,accountId:string)=>({id:'grant_'+botId,uid:'alice',botId,accountId,symbol:'GOLDUSDC',
   runtimeScope:'bot',issuedAt:Date.now()-1000,expiresAt:Date.now()+60000});
  for(const [bot,account] of [['bot-1','prop-1'],['bot-2','prop-1'],['bot-3','prop-other']])
   saved.set(prefix+bot+'.json',JSON.stringify(grant(bot,account)));
  const key=(bot:string,account:string)=>createHash('sha256').update('alice:'+account+':'+bot).digest('hex');
  fetcher.mockImplementation(async(url:string)=>{
   if(String(url).endsWith('/health'))return Response.json({ready:true});
   const scope=new URL(String(url)).pathname.split('/')[2];
   const bot=scope===key('bot-1','prop-1')?'bot-1':
     scope===key('bot-2','prop-1')?'bot-2':null;
   if(!bot)return Response.json({grant:null,running:false,events:[],executionEvents:[]});
   return Response.json({grant:{botId:bot,accountId:'prop-1'},
    executionEvents:[{id:'event_'+bot+'_1234',time:Date.now(),accountId:'prop-1',
     botId:bot,grantId:'grant_'+bot,symbol:'GOLDUSDC',stage:'SIGNAL',side:'SELL'}],
    events:[]});
  });
  const result=await svc.executionHistory('alice','prop-1');
  expect(result.available).toBe(true);
  expect(result.events?.map(e=>e.botId).sort()).toEqual(['bot-1','bot-2']);
  expect(fetcher.mock.calls.some(([url])=>String(url).includes(key('bot-3','prop-other')))).toBe(false);
 });
 it('reports old Worker signals as limited historical evidence, not a complete journal',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');
  vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');
  vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved}=setup();
  const prefix='propdao-live/v1/'+(process.env.VERCEL_ENV||'development')+'/'+Buffer.from('alice').toString('base64url')+'/';
  saved.set(prefix+'bot-old.json',JSON.stringify({id:'grant-old',uid:'alice',botId:'bot-old',accountId:'prop-1'}));
  fetcher.mockImplementation(async(url:string)=>String(url).endsWith('/health')?Response.json({ready:true}):
   Response.json({grant:{botId:'bot-old',accountId:'prop-1'},
    events:['2026-11-10T07:45:08.000Z · Candle M1 · 2026-11-10T07:45:00.000Z · SELL']}));
  const result=await svc.executionHistory('alice','prop-1');
  expect(result).toMatchObject({available:false,partial:true});
  expect(result.events).toMatchObject([{stage:'SIGNAL',side:'SELL',botId:'unattributed'}]);
  expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/status'))).toHaveLength(1);
 });
 it('does not interpret an absent bot Worker grant as a complete empty activity log',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');
  vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');
  vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved}=setup();
  const prefix='propdao-live/v1/'+(process.env.VERCEL_ENV||'development')+'/'+Buffer.from('alice').toString('base64url')+'/';
  saved.set(prefix+'bot-1.json',JSON.stringify({id:'grant-1',uid:'alice',botId:'bot-1',accountId:'prop-1',runtimeScope:'bot'}));
  fetcher.mockImplementation(async(url:string)=>String(url).endsWith('/health')?Response.json({ready:true}):
   Response.json({grant:null,events:[],executionEvents:[]}));
  const result=await svc.executionHistory('alice','prop-1');
  expect(result).toMatchObject({available:false,partial:true});
  expect(result).toHaveProperty('unverifiedScopes',['bot-1']);
 });
 it('reports unverified scope rather than asserting that no trading took place',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');
  vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');
  vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved}=setup();
  const prefix='propdao-live/v1/'+(process.env.VERCEL_ENV||'development')+'/'+Buffer.from('alice').toString('base64url')+'/';
  saved.set(prefix+'bot-1.json',JSON.stringify({id:'grant-1',uid:'alice',botId:'bot-1',accountId:'prop-1',runtimeScope:'bot'}));
  fetcher.mockImplementation(async(url:string)=>String(url).endsWith('/health')?Response.json({ready:true}):
   Promise.reject(Error('Cloudflare unreachable')));
  const result=await svc.executionHistory('alice','prop-1');
  expect(result).toMatchObject({available:false,partial:true});
  expect(result.error).toContain('incomplete');
 });
 it('bounds historical per-bot Worker reads instead of creating unbounded dashboard work',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');
  vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');
  vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,saved}=setup();
  const prefix='propdao-live/v1/'+(process.env.VERCEL_ENV||'development')+'/'+Buffer.from('alice').toString('base64url')+'/';
  for(let n=0;n<19;n++){
   const botId='bot-'+n;
   saved.set(prefix+botId+'.json',JSON.stringify({id:'grant_'+n,uid:'alice',botId,accountId:'prop-1',
    runtimeScope:'bot'}));
  }
  fetcher.mockResolvedValue(Response.json({ready:true}));
  const activity=await svc.executionHistory('alice','prop-1');
  expect(activity.available).toBe(false);
  expect(activity.events).toBeNull();
  expect(activity.error).toMatch(/more than 18/i);
  expect(fetcher).toHaveBeenCalledTimes(1); // health only; no 19 remote status calls
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
 it('reports unknown exposure instead of zero positions when broker read fails but Worker is reachable',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,accounts,saved,fetcher}=setup();
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const grant=JSON.parse([...saved.values()][0]);
  fetcher.mockImplementation(async(url:string)=>String(url).endsWith('/health')?Response.json({ready:true}):Response.json({grant:{id:grant.id},running:true,paused:false,events:[]}));
  accounts.accountRisk.mockRejectedValueOnce(Error('broker temporarily unavailable'));
  const status=await svc.status('alice','bot-1');
  expect(status).toMatchObject({deployed:true,running:true,brokerExposureVerified:false,brokerExposure:'unknown'});
  expect(status.positions).toBeNull();
  expect(status.pendingOrders).toBeNull();
  expect(status.accountError).toContain('broker temporarily unavailable');
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
 it('Stop preserves its revoked grant for audit and redeploy creates a new identity',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,saved}=setup();
  await svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any);
  const previous=JSON.parse([...saved.values()][0]);
  const stopped=await svc.stop('alice','bot-1');
  expect(stopped).toMatchObject({running:false,deployed:false,stopped:true});
  expect(saved.size).toBe(1);
  expect(JSON.parse([...saved.values()][0]).revokedAt).toBeGreaterThan(0);
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
  const lingering=await svc.status('alice','bot-1');
  expect(lingering.activeAuthorization).toBe(true);
  await expect(svc.review('alice','bot-1',{body:requestBody} as any)).rejects.toThrow(/prior server authorization/i);
  await svc.stop('alice','bot-1');
  await expect(svc.deploy('alice','bot-1',{body} as any)).rejects.toThrow(/already used/);
 });
 it('rejects preparing a deployment for a source different from the open workspace',async()=>{
  const {svc,storage}=setupReady();
  await expect(svc.review('alice','bot-1',{body:{...requestBody,expectedCodeHash:'a'.repeat(64)}} as any)).rejects.toThrow(/saved strategy changed/);
  expect(storage.write).not.toHaveBeenCalled();
 });
 it.each([true,false])('checks the exact running grant after the Worker acknowledgement (match: %s)',async(matched)=>{
  const {svc,fetcher,accounts}=setupReady();
  let activeGrant:string|null=null;
  fetcher.mockImplementation(async(url:string,init?:RequestInit)=>{
   const path=String(url);
   if(path.endsWith('/health'))return Response.json({ready:true});
   if(path.endsWith('/deploy')){
    activeGrant=JSON.parse(String(init?.body)).id;
    return Response.json({running:true,events:['scheduled']});
   }
   return Response.json({running:Boolean(activeGrant),grant:activeGrant?{id:matched?activeGrant:'different-grant'}:null});
  });
  const reviewed=await svc.review('alice','bot-1',{body:requestBody} as any);
  const body={...requestBody,reviewId:reviewed.reviewId,expectedCodeHash:reviewed.codeHash,confirm:auth};
  const result=await svc.deploy('alice','bot-1',{body} as any);
  expect(result).toMatchObject({running:matched,uncertain:!matched,grant:matched?{id:activeGrant}:null});
  await expect(svc.deploy('alice','bot-1',{body} as any)).rejects.toThrow(/Existing deployment authorization/);
  const lingering=await svc.status('alice','bot-1');
  expect(lingering.activeAuthorization).toBe(true);
  expect(accounts.executeOrder).not.toHaveBeenCalled();
 });
 it('binds R:R 1:3 to the exact review and rejects changing it to 1:2',async()=>{
  const {svc,saved}=setupReady();
  const reviewed=await svc.review('alice','bot-1',{body:{...requestBody,riskReward:3}} as any);
  expect(reviewed.riskReward).toBe(3);
  const body={...requestBody,riskReward:3,reviewId:reviewed.reviewId,expectedCodeHash:reviewed.codeHash,confirm:auth};
  await expect(svc.deploy('alice','bot-1',{body:{...body,riskReward:2}} as any)).rejects.toThrow(/changed since review/);
  await svc.deploy('alice','bot-1',{body} as any);
  const grant=[...saved.entries()].find(([key])=>key.includes('propdao-live/v1/'));
  expect(grant).toBeDefined();
  expect(JSON.parse(grant![1])).toMatchObject({riskUsd:2,riskReward:3,leverage:1});
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

it('reads owned recent PropDAO broker history even if the Cloudflare Worker is unreachable',async()=>{
 const {svc,accounts,saved,fetcher}=setup();
 vi.stubEnv('PROPDAO_LIVE_ENABLED','false');
 const prefix='propdao-live/v1/'+(process.env.VERCEL_ENV||'development')+'/'+Buffer.from('alice').toString('base64url')+'/';
 saved.set(prefix+'bot-1.json',JSON.stringify({id:'grant-1',uid:'alice',botId:'bot-1',accountId:'prop-1',symbol:'BTCUSDC'}));
 accounts.recentTrades.mockResolvedValueOnce([{id:'trade-one',symbol:'BTCUSDC',side:'BUY',qty:1,entry:100,exit:99,pnl:-1}] as never);
 fetcher.mockRejectedValue(Error('Worker unreachable'));
 const report=await svc.accountTradeHistory('alice','bot-1');
 expect(report).toMatchObject({available:true,accountId:'prop-1',botId:'bot-1'});
 expect(report.trades).toHaveLength(1);
 expect(accounts.accountRisk).toHaveBeenCalledWith('alice','prop-1');
 expect(accounts.recentTrades).toHaveBeenCalledWith('alice','prop-1');
 expect(fetcher).not.toHaveBeenCalled();
});
it('denies another user access to a prior deployment trade history',async()=>{
 const {svc,saved,accounts}=setup();
 const prefix='propdao-live/v1/'+(process.env.VERCEL_ENV||'development')+'/'+Buffer.from('alice').toString('base64url')+'/';
 saved.set(prefix+'bot-1.json',JSON.stringify({id:'grant-1',uid:'alice',botId:'bot-1',accountId:'prop-1'}));
 const report=await svc.accountTradeHistory('bob','bot-1');
 expect(report).toMatchObject({available:false,accountId:null});
 expect(accounts.recentTrades).not.toHaveBeenCalled();
});

it('permits authenticated read-only broker history after robot authorization is revoked',async()=>{
 const {svc,saved,accounts}=setup();
 const prefix='propdao-live/v1/'+(process.env.VERCEL_ENV||'development')+'/'+Buffer.from('alice').toString('base64url')+'/';
 saved.set(prefix+'bot-1.json',JSON.stringify({id:'grant-stop-1',uid:'alice',botId:'bot-1',
  accountId:'prop-1',symbol:'BTCUSDC',expiresAt:Date.now()-1000,revokedAt:Date.now()-2000}));
 accounts.recentTrades.mockResolvedValueOnce([{id:'close-001',symbol:'BTCUSDC',side:'BUY',
  qty:1,entry:100,exit:98,pnl:-2,fee:.1,openedAt:Date.now()-1000,closedAt:Date.now(),reason:'SL'}] as never);
 const observed=await svc.provider({uid:'alice',botId:'bot-1',grantId:'grant-stop-1',action:'history'});
 expect(observed).toMatchObject({source:'owner-verified-propdao',trades:[{id:'close-001',pnl:-2}],
  exposure:{verified:true,positions:0,orders:0}});
 expect(accounts.executeOrder).not.toHaveBeenCalled();
 await expect(svc.provider({uid:'alice',botId:'bot-1',grantId:'grant-stop-1',action:'execute',payload:{}}))
  .rejects.toThrow(/expired/i);
});
