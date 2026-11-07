/* Immutable exact-market OHLC shards. No synthetic candles and no cross-venue conversion. */
import {randomUUID} from 'node:crypto';
import {intervalMs,isTimeframe,isValidCandle,type MarketTimeframe,type MarketCandle} from './market-data.ts';
import {listR2Objects,readR2Object,writeR2Object} from './r2.ts';
import type {CanonicalInstrument} from './instrument-registry.ts';
import {VenueMarketData} from './venue-market-data.ts';
type Store={list:(prefix:string,maxKeys:number)=>Promise<string[]>;read:(key:string)=>Promise<string|null>;write:(key:string,data:string)=>Promise<void>};
type Provider={hyperliquidCandles:(input:{asset:string;timeframe:MarketTimeframe;from:string;to:string})=>Promise<{candles:MarketCandle[];source:string}>};
type Shard={version:3;instrumentId:string;timeframe:MarketTimeframe;source:string;sourceVenue:'hyperliquid';ingestedAt:string;from:number;to:number;kind:'exact';candles:MarketCandle[]};
type HistoryInput={instrument:CanonicalInstrument;timeframe:MarketTimeframe;from:string;to:string;fetchMissing?:boolean};
const day=86_400_000;
const storage:Store={list:listR2Objects,read:readR2Object,write:writeR2Object};
function datePart(ms:number){return new Date(ms).toISOString().slice(0,10);}
function safePath(instrument:CanonicalInstrument,tf:string,d:number){
 return 'market-history/v3/'+instrument.venue+'/'+instrument.kind+'/'+encodeURIComponent(instrument.symbol)+'/'+tf+'/'+datePart(d)+'/';
}
function validStored(v:any,i:CanonicalInstrument,tf:MarketTim¶»§q«^