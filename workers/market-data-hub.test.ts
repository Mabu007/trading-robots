import {describe,it,expect,vi,afterEach} from 'vitest';
import {MarketDataHub} from './market-data-hub.ts';
const request=(body:unknown)=>new Request('https://internal/v1/info',{method:'POST',body:JSON.stringify(body)});
afterEach(()=>vi.unstubAllGlobals());
function storage(){
 const saved=new Map<string,unknown>();
 const api={
  get:async <T>(key:string):Promise<T|undefined>=>saved.get(key) as T|undefined,
  put:async <T>(key:string,value:T)=>{saved.set(key,value);},
  transaction:async <T>(callback:(tx:any)=>Promise<T>):Promise<T>=>callback(api),
  setAlarm:async()=>{}
 };
 return api;
}
function state(saved=storage()){return {getWebSockets:()=>[],storage:saved} as any;}
describe('global DO public provider budgeting',()=>{
 it('coalesces requests from distinct callers hitting one DO and caches successful snapshots',async()=>{
  const fetcher=vi.fn(async()=>Response.json({coin:'BTC',time:1700000000000,levels:[[],[]]}));
  vi.stubGlobal('fetch',fetcher);
  const hub=new MarketDataHub(state(),{} as any);
  const body={type:'l2Book',coin:'BTC'};
  const result=await Promise.all(Array.from({length:30},()=>hub.fetch(request(body))));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(((await result[0].json()) as any).coin).toBe('BTC');
  const extra=await hub.fetch(request(body));expect(extra.headers.get('x-tv-market-cache')).toBe('HIT');
 });
 it('enforces provider weighted IP budgets across many distinct application callers',async()=>{
  const fetcher=vi.fn(async()=>Response.json({ok:true}));
  vi.stubGlobal('fetch',fetcher);
  const hub=new MarketDataHub(state(),{} as any);
  for(let i=0;i<325;i++){
   const r=await hub.fetch(request({type:'l2Book',coin:'BTC'+i}));
   expect(r.status).toBe(200);
  }
  const limited=await hub.fetch(request({type:'l2Book',coin:'BTC326'}));
  expect(limited.status).toBe(429);expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(fetcher).toHaveBeenCalledTimes(325);
 });
 it('persists weighted reservations and provider backoff when the DO instance restarts',async()=>{
  const fetcher=vi.fn(async()=>Response.json({ok:true}));
  vi.stubGlobal('fetch',fetcher);
  const persisted=storage();
  const first=new MarketDataHub(state(persisted),{} as any);
  for(let i=0;i<325;i++)expect((await first.fetch(request({type:'l2Book',coin:'ETH'+i}))).status).toBe(200);
  const restarted=new MarketDataHub(state(persisted),{} as any);
  const denied=await restarted.fetch(request({type:'l2Book',coin:'ETH-after-restart'}));
  expect(denied.status).toBe(429);expect(fetcher).toHaveBeenCalledTimes(325);
 });
 it('recovers from a transient fetch error without caching failure state',async()=>{
  let count=0;const fetcher=vi.fn(async()=>++count===1?new Response('{}',{status:502}):Response.json({available:true}));
  vi.stubGlobal('fetch',fetcher);
  const hub=new MarketDataHub(state(),{} as any);
  const body={type:'l2Book',coin:'ETH'};
  expect((await hub.fetch(request(body))).status).toBe(502);
  expect((await hub.fetch(request(body))).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('rejects invalid paths, unbounded historical ranges and network faults without caching errors',async()=>{
  const fetcher=vi.fn(async()=>new Response('{}',{status:429,headers:{'Retry-After':'3'}}));
  vi.stubGlobal('fetch',fetcher);
  const hub=new MarketDataHub(state(),{} as any);
  expect((await hub.fetch(request({type:'exchange',coin:'BTC'}))).status).toBe(400);
  expect((await hub.fetch(request({type:'candleSnapshot',req:{coin:'BTC',interval:'1m',startTime:0,endTime:999999999}}))).status).toBe(400);
  expect((await hub.fetch(request({type:'l2Book',coin:'BTC'}))).status).toBe(429);
  expect((await hub.fetch(request({type:'l2Book',coin:'BTC'}))).status).toBe(429);
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
});

