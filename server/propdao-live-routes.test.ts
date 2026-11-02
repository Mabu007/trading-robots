import {afterEach,describe,expect,it,vi} from 'vitest';
import {PropDAOLiveService} from './propdao-live-routes.ts';
import {starterCode} from '../src/strategy.ts';
import type {PropDAOAccounts} from './propdao-account.ts';

afterEach(()=>vi.unstubAllEnvs());
const setup=()=>{
 const saved=new Map<string,string>();
 const storage={read:vi.fn(async(k:string)=>saved.get(k)??null),write:vi.fn(async(k:string,v:string)=>{saved.set(k,v)}),list:vi.fn(async(prefix:string)=>[...saved.keys()].filter(k=>k.startsWith(prefix)))};
 const accounts={
  accountRisk:vi.fn(async()=>({account:{status:'active'},risk:{equity:1000,roomUsd:50,breached:false},positions:[],orders:[]})),
  getPublicMarkets:vi.fn(async()=>({data:[{symbol:'BTCUSDC',coin:'BTC',dex:null,lotStep:0.00001,maxLeverage:2}],fees:{taker:0.00045}})),
  executeOrder:vi.fn(async()=>({intentId:'test',protected:true})),
 };
 const fetcher=vi.fn(async(url:string)=>String(url).endsWith('/health')?Response.json({ready:true}):Response.json({running:String(url).endsWith('/status'),events:['authorized']}));
 const svc=new PropDAOLiveService({...storage,uid:async()=> 'alice',bot:async()=>({asset:'BTCUSDC',venue:'propdao',code:starterCode}),accounts:accounts as unknown as PropDAOAccounts,request:fetcher as unknown as typeof fetch});
 return {svc,fetcher,accounts,saved,storage};
};
describe('PropDAO live execution authorization',()=>{
 it('is fail-closed without a verified Cloudflare Worker and secret',async()=>{
  const {svc,fetcher}=setup();
  vi.stubEnv('PROPDAO_LIVE_ENABLED','false');
  const state=await svc.status('alice','bot-1');
  expect(state.configured).toBe(false);
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any)).rejects.toThrow(/not ready/);
  expect(fetcher).not.toHaveBeenCalled();
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
  await expect(svc.stop('alice','bot-1')).rejects.toThrow('Worker offline');
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
});
