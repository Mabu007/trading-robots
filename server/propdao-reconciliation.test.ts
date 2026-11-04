import {afterEach,describe,expect,it,vi} from 'vitest';
import {PropDAOAccounts} from './propdao-account';

afterEach(()=>vi.restoreAllMocks());

const setup=(orders:any[]=[])=>{
 const stored=new Map<string,string>();
 const storage={read:async(k:string)=>stored.get(k)||null,write:async(k:string,v:string)=>{stored.set(k,v)},remove:async(k:string)=>{stored.delete(k)}};
 const fetcher=vi.fn(async(request:RequestInfo|URL)=>{
  const url=String(request);
  if(url.endsWith('/accounts'))return Response.json({accounts:[{account_id:'prop-1',status:'active'}]});
  if(url.endsWith('/accounts/prop-1/risk'))return Response.json({equity:1000,roomUsd:40,breached:false});
  if(url.endsWith('/accounts/prop-1/positions'))return Response.json({data:[]});
  if(url.endsWith('/accounts/prop-1/orders'))return Response.json({data:orders});
  if(url.endsWith('/accounts/prop-1'))return Response.json({openPositions:[],pendingOrders:orders,twapOrders:[],tradeHistory:[]});
  throw Error('Unexpected account API: '+url);
 });
 const secret=Buffer.alloc(32,7).toString('base64');
 const account=new PropDAOAccounts(storage,fetcher as unknown as typeof fetch,()=>secret);
 return {account,fetcher};
};
const oldIntent=()=>({intentId:'tv-grant-1700000000',symbol:'BTCUSDC',side:'BUY',createdAt:Date.now()-5*60_000});

describe('PropDAO operator reconciliation',()=>{
 it('confirms two flat provider snapshots and never submits an order',async()=>{
  const {account,fetcher}=setup();
  await account.connect('alice','pd_live_test_key_1234');
  const proof=await account.verifyFlatReconciliation('alice','prop-1',oldIntent());
  expect(proof).toMatchObject({verified:true,openPositions:0,restingOrders:0,twapOrders:0,snapshots:2,verification:'OPERATOR_CONFIRMED_ACCOUNT_FLAT'});
  expect(fetcher.mock.calls.every(([,init])=>init?.method===undefined||init?.method==='GET')).toBe(true);
 });
 it('refuses to clear a lock when a resting order still exists',async()=>{
  const {account}=setup([{id:'ord-1',status:'PENDING',symbol:'BTCUSDC'}]);
  await account.connect('alice','pd_live_test_key_1234');
  await expect(account.verifyFlatReconciliation('alice','prop-1',oldIntent())).rejects.toThrow(/open position|order/);
 });
 it('refuses a too-recent intent even on an apparently flat account',async()=>{
  const {account}=setup();
  await account.connect('alice','pd_live_test_key_1234');
  await expect(account.verifyFlatReconciliation('alice','prop-1',{...oldIntent(),createdAt:Date.now()-5_000})).rejects.toThrow(/too recent/);
 });
});
