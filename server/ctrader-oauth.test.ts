import {afterEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {CTraderService,ctraderRoutes} from './ctrader';

afterEach(()=>vi.unstubAllEnvs());
function configure(){
 vi.stubEnv('VERCEL_ENV','test');vi.stubEnv('CTRADER_CLIENT_ID','test-client');vi.stubEnv('CTRADER_SECRET_KEY','test-secret');
 vi.stubEnv('CTRADER_REDIRECT_URI','https://app.example/api/brokers/ctrader/callback');
 vi.stubEnv('CTRADER_GATEWAY_URL','https://gateway.example');vi.stubEnv('CTRADER_GATEWAY_SECRET','g'.repeat(40));
 vi.stubEnv('CTRADER_CREDENTIAL_ENCRYPTION_KEY',Buffer.alloc(32,7).toString('base64'));
}
describe('cTrader OAuth boundary',()=>{
 it('requires a ready gateway and binds a one-time state to encrypted owner credentials',async()=>{
  configure();
  const stored=new Map<string,string>();
  const storage={read:async(k:string)=>stored.get(k)??null,write:async(k:string,v:string)=>{stored.set(k,v)},remove:async(k:string)=>{stored.delete(k)}};
  const fetcher=vi.fn(async(url:string|URL)=>{
   const address=String(url);
   if(address.endsWith('/health'))return Response.json({ready:true});
   if(address.includes('/apps/token'))return Response.json({accessToken:'access-secret',refreshToken:'refresh-secret',expiresIn:3600});
   if(address.endsWith('/rpc'))return Response.json({payload:{ctidTraderAccount:[{ctidTraderAccountId:'12345',isLive:false}]}});
   throw Error('unexpected request');
  });
  const service=new CTraderService(storage,fetcher as typeof fetch);
  const start=await service.oauthStart('alice','accounts');
  expect(new URL(start.url).searchParams.get('state')).toBe(start.nonce);
  await service.oauthCallback(start.nonce,'one-time-code');
  expect((await service.list('alice')).connected).toBe(true);
  expect((await service.list('bob')).connected).toBe(false);
  expect([...stored.values()].join('')).not.toContain('access-secret');
  await expect(service.oauthCallback(start.nonce,'one-time-code')).rejects.toThrow(/expired/);
 });
 it('rejects a callback whose state does not match its browser cookie',async()=>{
  const callback=vi.fn(async()=>{});
  const service={oauthCallback:callback} as unknown as CTraderService;
  const storage={read:async()=>null,write:async()=>{},remove:async()=>{}};
  const app=express();ctraderRoutes(app,storage,async()=> 'alice',{service});
  let server:Server;await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve())});
  try{
   const base='http://127.0.0.1:'+(server!.address() as any).port;
   const nonce='a'.repeat(32);
   const bad=await fetch(base+'/api/brokers/ctrader/callback?code=code&state='+('b'.repeat(32)),{headers:{cookie:'tv_ctrader_oauth='+nonce},redirect:'manual'});
   expect(bad.headers.get('location')).toContain('ctrader=failed');expect(callback).not.toHaveBeenCalled();
   const good=await fetch(base+'/api/brokers/ctrader/callback?code=code&state='+nonce,{headers:{cookie:'tv_ctrader_oauth='+nonce},redirect:'manual'});
   expect(good.headers.get('location')).toContain('ctrader=connected');expect(callback).toHaveBeenCalledWith(nonce,'code');
  }finally{await new Promise<void>(resolve=>server!.close(()=>resolve()))}
 });
});
