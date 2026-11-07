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
  const dex=kin¶»§q«^