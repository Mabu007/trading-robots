import type {Express,Request,Response} from 'express';
import {HyperliquidPublicService} from './hyperliquid-public.ts';
import {instrumentFromHyperPerp,instrumentsFromHyperSpot,type CanonicalInstrument} from './instrument-registry.ts';
import {R2MarketHistory} from './r2-market-history.ts';
import {sourceCatalog,resolveDataSource,type SourceOption} from './source-capabilities.ts';
import {marketHubScope,marketHubConfigured} from './market-hub-client.ts';
import {mintMarketStreamProtocol} from './market-stream-auth.ts';
import {isTimeframe} from './market-data.ts';

type Auth=(request:Request,response:Response)=>Promise<string|null>;
export function marketV3Routes(app:Express,auth:Auth,service=new HyperliquidPublicService(),history=new R2MarketHistory()){
 async function resolveExact(raw:unknown):Promise<CanonicalInstrument>{
  if(typeof raw!=='string'||raw.length>120)throw Error('Exact instrument ID required');
  const prefix='hyperliquid:',i=raw.startsWith(prefix)?raw.slice(prefix.length):'';
  const pos=i.indexOf(':'),kind=i.slice(0,pos),symbol=i.slice(pos+1);
  if(!['perpetual','hip3-perpetual','spot'].includes(kind)||!symbol||!/^[A-Za-z0-9@._:/-]{1,64}$/.test(symbol)||symbol.includes('..'))throw Error('Unsupported or ambiguous market identity');
  if(kind==='spot'){
   const data=await service.info({type:'spotMeta'});
   const found=instrumentsFromHyperSpot(data).find(x=>x.id===raw);
   if(!found)throw Error('Spot instrument not listed');return found;
  }
  const dex=kind==='hip3-perpetual'?symbol.split(':')[0]:'';
  if(kind==='hip3-perpetual'&&(!symbol.includes(':')||!dex))throw Error('HIP-3 DEX namespace required');
  if(kind==='perpetual'&&symbol.includes(':'))throw Error('Core perpetual cannot contain a DEX namespace');
  const data=await service.info({type:'meta',dex});
  if(!Array.isArray(data?.universe))throw Error('Invalid provider metadata');
  const index=data.universe.findIndex((x:any)=>x.name===symbol&&x.isDelisted!==true);
  if(index<0)throw Error('Exact instrument is not listed on this DEX');
  const instrument=instrumentFromHyperPerp(data.universe[index],dex);
  if(instrument.id!==raw)throw Error('Instrument identity mismatch');
  return {...instrument,providerIds:{...instrument.providerIds,index}};
 }
 function unavailable(err:unknown,res:Response){
  const message=err instanceof Error?err.message:'Market data unavailable';
  const invalid=/required|Unsupported|not listed|mismatch|Invalid|ambiguous|Choose|cannot|namespace|Unknown/i.test(message);
  return res.status(invalid?422:502).json({error:message,source:'Hyperliquid public',cacheScope:marketHubScope()});
 }
 app.get('/api/market/v3/sources',(_req,res)=>res.json({sourceCatalog:sourceCatalog(),cacheScope:marketHubScope(),note:'Only exact venue/market/symbol data may be used for backtesting or execution. Related market and historical proxy data are never silently substituted.'}));
 app.get('/api/market/v3/discover',async(req,res)=>{
  try{
   const dexLimit=Math.max(1,Math.min(100,Number(req.query.dexLimit)||10));
   res.json(await service.discover({dexLimit,includeSpot:req.query.spot!=='false'}));
  }catch(error){unavailable(error,res);}
 });
 app.get('/api/market/v3/instrument',async(req,res)=>{try{res.json(await resolveExact(req.query.id));}catch(error){unavailable(error,res);}});
 app.get('/api/market/v3/snapshot',async(req,res)=>{
  try{
   const instrument=await resolveExact(req.query.id);
   const [context,book]=await Promise.all([service.context(instrument),service.book(instrument)]);
   const sourceOption:SourceOption={
    source:'Hyperliquid public',venue:'hyperliquid',instrumentId:instrument.id,
    capabilities:['snapshot','book','mark','oracle','funding','open-interest','volume'],role:'exact',
    asOf:Date.parse(book.asOf),health:'healthy',completeness:1,allowed:true,entitled:true,
    costRank:0,rateLimitRemaining:null,maxAgeMs:20000,historicalFrom:null,historicalTo:null,
    provenance:'Provider timestamp from l2Book; contexts have no event timestamp'
   };
   const choice=resolveDataSource({instrument,capability:'book',purpose:'display',candidates:[sourceOption]});
   if(choice.status!=='selected')throw Error('Order book is stale or unavailable');
   res.json({instrument,context,book,selection:{role:'exact',source:'Hyperliquid public',asOf:book.asOf},
    warning:'Context fields are provider values with fetch timestamps, not tick-time provenance. No broker equivalence or execution readiness is asserted.'});
  }catch(error){unavailable(error,res);}
 });
 app.get('/api/market/v3/trades',async(req,res)=>{try{const instrument=await resolveExact(req.query.id);res.json(await service.trades(instrument));}catch(error){unavailable(error,res);}});
 app.get('/api/market/v3/mids',async(req,res)=>{try{res.json(await service.mids(typeof req.query.dex==='string'?req.query.dex:''));}catch(error){unavailable(error,res);}});
 app.post('/api/market/v3/stream-token',async(req,res)=>{
  const uid=await auth(req,res);if(!uid)return;
  if(!marketHubConfigured())return res.status(503).json({error:'Shared market stream not configured'});
  const base=new URL(process.env.MARKET_DATA_HUB_URL!);
  if(base.protocol!=='https:')return res.status(503).json({error:'Shared market stream requires HTTPS'});
  base.protocol='wss:';base.pathname='/v1/ws';base.search='';base.hash='';
  res.json({url:base.toString(),protocols:['tv-market-v1',mintMarketStreamProtocol(uid,process.env.MARKET_DATA_HUB_SECRET!)],
   expiresAt:new Date(Date.now()+60000).toISOString(),scope:'public-market-only',message:'Subscribe to an exact Hyperliquid coin; no account or execution permissions are granted.'});
 });
 app.post('/api/market/v3/history',async(req,res)=>{
  if(!await auth(req,res))return;
  try{
   const {instrumentId,timeframe,from,to,fetchMissing}=req.body??{};
   if(!isTimeframe(timeframe)||typeof from!=='string'||typeof to!=='string'||typeof fetchMissing!=='boolean')throw Error('Choose timeframe, exact dates and fetchMissing boolean');
   const instrument=await resolveExact(instrumentId);
   res.json(await history.get({instrument,timeframe,from,to,fetchMissing}));
  }catch(error){unavailable(error,res);}
 });
}

