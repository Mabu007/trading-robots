import {valrHistory} from './valr-history';
const cache=new Map<string,{at:number;value:Awaited<ReturnType<typeof valrHistory>>}>();
// Cache completed VALR responses only; cancelled runs never affect other requests.
export async function historicalData(body:{asset:string;timeframe:string;from:string;to:string},signal?:AbortSignal,onRetry?:()=>void){
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const key=JSON.stringify(body),entry=cache.get(key);
 if(entry&&Date.now()-entry.at<600000){cache.delete(key);cache.set(key,entry);return entry.value;}
 const value=await valrHistory(body,signal,onRetry);cache.delete(key);cache.set(key,{at:Date.now(),value});while(cache.size>4)cache.delete(cache.keys().next().value!);return value;
}
