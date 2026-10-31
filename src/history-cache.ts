import {postApiJson} from './api';
import {valrHistory} from './valr-history';
const cache=new Map<string,{at:number;value:any}>();
// Completed responses only: cancelling one run must never abort another request.
export async function historicalData<T>(path:string,body:unknown,label:string,signal?:AbortSignal):Promise<T>{
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const key=JSON.stringify([path,body]),entry=cache.get(key);
 if(entry&&Date.now()-entry.at<600000){cache.delete(key);cache.set(key,entry);return entry.value;}
 const value=path==='/api/market-data'?await valrHistory(body as {asset:string;timeframe:string;from:string;to:string},signal) as T:await postApiJson<T>(path,body,label,signal);cache.delete(key);cache.set(key,{at:Date.now(),value});while(cache.size>4)cache.delete(cache.keys().next().value!);return value;
}
