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
  await expect(svc.deploy('alice','bot-1',{body:{}} as any)).rejects.toThrow(/not configured/);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('requires explicit authorization and rejects unavailable account risk',async()=>{
  vi.stubEnv('PROPDAO_LIVE_ENABLED','true');vi.stubEnv('PROPDAO_LIVE_RUNTIME_URL','https://runtime.example');vi.stubEnv('PROPDAO_LIVE_INTERNAL_SECRET','t'.repeat(40));
  const {svc,fetcher,accounts}=setup();
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1}} as any)).rejects.toThrow(/Explicit/);
  accounts.accountRisk.mockResolvedValueOnce({account:{status:'active'},risk:{equity:1000,roomUsd:3,breached:false},positions:[],orders:[]});
  await expect(svc.deploy('alice','bot-1',{body:{accountId:'prop-1',riskUsd:2,leverage:1,confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'}} as any)).rejects.toThrow(/risk room/);
  expect(fetcher).not.toHaveBeenCalled();
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
});
