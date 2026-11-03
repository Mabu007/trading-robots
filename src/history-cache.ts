import {postApiJson,readApiJson} from './api';
import {TF_SECONDS} from '../shared/trading';
import type {Venue} from '../shared/venues';
import {valrHistory} from './valr-history';
const cache=new Map<string,{at:number;value:Awaited<ReturnType<typeof valrHistory>>}>();
// Cache completed venue responses locally; long-range PropDAO weeks persist in server-side R2.
export async function historicalData(body:{venue?:Venue;asset:string;timeframe:string;from:string;to:string},signal?:AbortSignal,onRetry?:()=>void,getAuthToken?:()=>Promise<string>){
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const accountId=body.venue==='ctrader'?localStorage.getItem('trading-vibes:ctrader:selected-account'):undefined;
 const key=JSON.stringify({...body,accountId}),entry=cache.get(key);
 if(entry&&Date.now()-entry.at<600000){cache.delete(key);cache.set(key,entry);return entry.value;}
 const duration=TF_SECONDS[body.timeframe]*1000;
 const range={...body,from:new Date(Math.floor(Date.parse(body.from)/duration)*duration).toISOString(),to:new Date(Math.min(Math.ceil(Date.parse(body.to)/duration)*duration,Math.floor(Date.now()/duration)*duration)).toISOString()};
 if(body.venue==='ctrader'&&(!accountId||!getAuthToken))throw Error('Connect and select your cTrader broker account first.');
 const value=body.venue==='ctrader'?await (async()=>{const response=await fetch('/api/venues/ctrader/candles',{method:'POST',headers:{Authorization:'Bearer '+await getAuthToken!(),'Content-Type':'application/json'},body:JSON.stringify({...range,accountId}),signal});return readApiJson<Awaited<ReturnType<typeof valrHistory>>>(response,'cTrader broker history')})():body.venue&&body.venue!=='valr'?await postApiJson<Awaited<ReturnType<typeof valrHistory>>>(`/api/venues/${body.venue}/candles`,range,'Market history',signal):await valrHistory(body,signal,onRetry);
 if(!value.candles.length)throw Error(body.venue==='propdao'?'No finalized Dwellir candles exist for this PropDAO market and date range.':'No history returned for the selected range.');cache.delete(key);cache.set(key,{at:Date.now(),value});while(cache.size>4)cache.delete(cache.keys().next().value!);return value;
}
