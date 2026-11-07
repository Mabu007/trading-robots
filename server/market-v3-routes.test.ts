import {describe,it,expect} from 'vitest';
import express from 'express';
import {marketV3Routes} from './market-v3-routes.ts';
import type {CanonicalInstrument} from './instrument-registry.ts';
describe('market v3 HTTP identity boundary',()=>{
 it('rejects ambiguous provider identity and unauthenticated R2 ingestion',async()=>{
  const api=express();api.use(express.json());
  const auth=async(_req:any,res:any)=>{res.status(401).json({error:'Sign-in required'});return null;};
  const svc={info:async()=>({universe:[{name:'BTC',szDecimals:5}]}),
   discover:async()=>({instruments:[],errors:[],truncated:false}),
   mids:async()=>({}),context:async()=>({}),book:async()=>({})};
  marketV3Routes(api,auth,svc as any);
  const http=api.listen(0);
  try{
   const addr=http.address();if(!addr||typeof addr==='string')throw Error('missing listener');
   const url='http://127.0.0.1:'+addr.port;
   const invalid=await fetch(url+'/api/market/v3/instrument?id=BTC');expect(invalid.status).toBe(422);
   const exact=await fetch(url+'/api/market/v3/instrument?id=hyperliquid:perpetual:BTC');
   expect((await exact.json() as CanonicalInstrument).id).toBe('hyperliquid:perpetual:BTC');
   const write=await fetch(url+'/api/market/v3/history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instrumentId:'hyperliquid:perpetual:BTC',timeframe:'m1',from:'2026-11-01T00:00:00Z',to:'2026-11-01T01:00:00Z',fetchMissing:true})});
   expect(write.status).toBe(401);
  }finally{http.close();}
 });
});

