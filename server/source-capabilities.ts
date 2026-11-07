import type {CanonicalInstrument} from './instrument-registry.ts';
export type SourceRole='exact'|'related'|'historical-proxy';
export type DataPurpose='display'|'research'|'backtest'|'execution';
export type DataCapability='discovery'|'snapshot'|'book'|'trades'|'candles'|'funding'|'open-interest'|'mark'|'oracle'|'volume';
export type SourceOption={
  source:string;venue:string;instrumentId:string;capabilities:DataCapability[];role:SourceRole;
  asOf:number|null;health:'healthy'|'degraded'|'unknown'|'down';completeness:number;
  allowed:boolean;entitled:boolean;costRank:number;rateLimitRemaining:number|null;
  provenance:string;maxAgeMs:number|null;historicalFrom:number|null;historicalTo:number|null;
};
export function sourceCatalog():Record<string,{capabilities:DataCapability[];requiresConnection:boolean}>{
 return {
  hyperliquid:{capabilities:['discovery','snapshot','book','trades','candles','funding','open-interest','mark','oracle','volume'],requiresConnection:false},
  propdao:{capabilities:['discovery','snapshot','candles'],requiresConnection:true},
  ctrader:{capabilities:['discovery','snapshot','candles'],requiresConnection:true},
  valr:{capabilities:['discovery','snapshot','book','trades','candles'],requiresConnection:true},
  r2:{capabilities:['candles'],requiresConnection:false},
  connected:{capabilities:['snapshot','candles'],requiresConnection:true}
 };
}
export type Selection={status:'selected'|'unavailable';chosen:SourceOption|null;considered:Array<SourceOpti¶»§q«^