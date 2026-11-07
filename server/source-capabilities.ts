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
export type Selection={status:'selected'|'unavailable';chosen:SourceOption|null;considered:Array<SourceOption&{eligible:boolean;reason:string;score:number}>};
export function resolveDataSource(args:{instrument:CanonicalInstrument;capability:DataCapability;purpose:DataPurpose;
 candidates:SourceOption[];now?:number;allowRelated?:boolean;from?:number;to?:number}):Selection{
 const now=args.now??Date.now();
 const considered=args.candidates.map(c=>{
  const exact=c.role==='exact'&&c.instrumentId===args.instrument.id&&c.venue===args.instrument.venue;
  const related=args.allowRelated===true&&(args.purpose==='research'||args.purpose==='display')&&c.role!=='exact';
  let reason='eligible';
  if(!c.capabilities.includes(args.capability))reason='capability missing';
  else if(!c.allowed||!c.entitled)reason='permission or entitlement missing';
  else if(c.health==='down')reason='source unhealthy';
  else if(!exact&&!related)reason='not exact instrument data';
  else if((args.purpose==='execution'||args.purpose==='backtest')&&!exact)reason='proxy forbidden for execution/backtest';
  else if(c.maxAgeMs!==null&&(c.asOf===null||now-c.asOf>c.maxAgeMs||c.asOf>now+5000))reason='stale or missing source timestamp';
  else if(args.from!==undefined&&args.to!==undefined&&(c.historicalFrom===null||c.historicalTo===null||c.historicalFrom>args.from||c.historicalTo<args.to))reason='insufficient historical coverage';
  else if(c.rateLimitRemaining!==null&&c.rateLimitRemaining<=0)reason='provider rate limit exhausted';
  const eligible=reason==='eligible';
  const age=c.asOf==null?0:Math.max(0,now-c.asOf);
  const score=(exact?10000:c.role==='related'?100:10)+(c.health==='healthy'?300:c.health==='degraded'?50:0)
   +Math.round(Math.min(1,Math.max(0,c.completeness))*100)-Math.min(100,Math.floor(age/1000))
   -Math.max(0,c.costRank)*10+(c.rateLimitRemaining===null?0:Math.min(50,c.rateLimitRemaining));
  return {...c,eligible,reason,score};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score||a.source.localeCompare(b.source));
 return {status:considered[0]?.eligible?'selected':'unavailable',chosen:considered.find(c=>c.eligible)??null,considered};
}

