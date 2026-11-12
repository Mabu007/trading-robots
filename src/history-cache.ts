import {postApiJson} from './api';
import {TF_SECONDS} from '../shared/trading';
import type {Venue} from '../shared/venues';
import {valrHistory} from './valr-history';
let researchToken:(()=>Promise<string>)|null=null;
export function setResearchHistoryToken(provider:(()=>Promise<string>)|null){researchToken=provider;}
const cache=new Map<string,{at:number;value:Awaited<ReturnType<typeof valrHistory>>}>();
// Cache completed venue responses locally; long-range PropDAO weeks persist in server-side R2.
export async function historicalData(body:{venue?:Venue;asset:string;timeframe:string;from:string;to:string},signal?:AbortSignal,onRetry?:()=>void):Promise<Awaited<ReturnType<typeof valrHistory>>>{
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const key=JSON.stringify(body),entry=cache.get(key);
 if(entry&&Date.now()-entry.at<600000){cache.delete(key);cache.set(key,entry);return entry.value;}
 const duration=TF_SECONDS[body.timeframe]*1000;
 const range={...body,from:new Date(Math.floor(Date.parse(body.from)/duration)*duration).toISOString(),to:new Date(Math.min(Math.ceil(Date.parse(body.to)/duration)*duration,Math.floor(Date.now()/duration)*duration)).toISOString()};
 if(body.venue==='research'){
 if(!researchToken)throw Error('Sign in to load Dukascopy history');const token=await researchToken();const candles:any[]=[];let missing=0;const start=Date.parse(range.from),end=Date.parse(range.to);if(end-start>36*86400000)throw Error('Choose up to 36 days per timeframe');
 for(let t=Math.floor(start/86400000)*86400000;t<end;t+=86400000){const response=await fetch('/api/market-alert-history',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({day:new Date(t).toISOString().slice(0,10),timeframe:body.timeframe}),signal});const page=await response.json();if(!response.ok)throw Error(page.error||'Dukascopy history unavailable');candles.push(...page.candles.filter((b:any)=>b.time*1000>=start&&b.time*1000<end));missing+=page.missingIntervals;}
 if(!candles.length)throw Error('No completed Dukascopy candles in this range');return {asset:body.asset,timeframe:body.timeframe,candles,source:'Dukascopy bid · R2 cached · estimated backtest',missingCandles:missing,observedGaps:0,expectedCandles:Math.ceil((end-start)/duration),coverageComplete:missing===0} as any;
 }
 if(body.venue==='ctrader')throw Error('Connect a cTrader broker account to load broker history.');
 const value=body.venue&&body.venue!=='valr'?await postApiJson<Awaited<ReturnType<typeof valrHistory>>>(`/api/venues/${body.venue}/candles`,range,'Market history',signal):await valrHistory(body,signal,onRetry);
 if(!value.candles.length)throw Error(body.venue==='propdao'?'No finalized Dwellir candles exist for this PropDAO market and date range.':'No history returned for the selected range.');cache.delete(key);cache.set(key,{at:Date.now(),value});while(cache.size>4)cache.delete(cache.keys().next().value!);return value;
}
