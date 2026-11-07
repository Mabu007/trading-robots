import {describe,it,expect,vi,afterEach} from 'vitest';
import {MarketDataHub} from './market-data-hub.ts';
const request=(body:unknown)=>new Request('https://internal/v1/info',{method:'POST',body:JSON.stringify(body)});
afterEach(()=>vi.unstubAllGlobals());
describe('global DO public provider budgeting',()=>{
 it('coalesces requests from distinct callers hitting one DO and caches successful snapshots',async()=>{
  const fetcher=vi.fn(async()=>Response.json({coin:'BTC',time:1700000000000,levels:[[],[]]}));
  vi.stubGlobal('fetch',fetcher);
  const hub=new MarketDataHub({getWebSockets:()=>[],storage:{setAlarm:async()=>{}}} as any,{} as any);
  const body={type:'l2Book',coin:'BTC'};
  const result=await Promise.all(Array.from({length:30},()=>hub.fetch(request(body))));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(((await result[0].json()) as any).coin).toBe('BTC');
  const extra=await hub.fetch(request(body));expect(extra.headers.get('x-tv-market-cache')).toBe('HIT');
 });
 it('enforces provider weighted IP budgets across many distinct application callers',async()=>{
  const fetcher=vi.fn(async()=>Response.json({ok:true}));
  vi.stubGlobal('fetch',fetcher);
  const hub=new MarketDataHub({getWebSockets:()=>[],storage:{setAlarm:async()=>{}}} as any,{} as any);
  for(let i=0;i<325;i++){
   const r=await hub.fetch(request({type:'l2Book',coin:'BTC'+i}));
   expect(r.status).toBe(200);
  }
  const limited=await hub.fetch(request({type:'l2Book',coin:'BTC326'}));
  expect(limit¶»§q«^