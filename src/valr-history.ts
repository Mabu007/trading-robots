import { postApiJson } from './api';
import type { Candle } from './types';

const periods:Record<string,number> = {m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400,d1:86400};
type Page = { candles:Candle[]; missingCandles:number; observedGaps:number };
function waitForRetry(signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{
 if(signal?.aborted)return reject(new DOMException('Cancelled','AbortError'));
 const timer=globalThis.setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},60_000);
 const abort=()=>{globalThis.clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('Cancelled','AbortError'))};
 signal?.addEventListener('abort',abort,{once:true});
})}

// Fetch successive bounded pages. A failure ends the run rather than silently
// using an incomplete subset of the requested historical period.
export async function valrHistory(body:{asset:string;timeframe:string;from:string;to:string},signal?:AbortSignal,onRetry?:()=>void){
 const duration=periods[body.timeframe];
 const from=Date.parse(body.from)/1000,to=Date.parse(body.to)/1000;
 if(!duration||!Number.isFinite(from)||!Number.isFinite(to))throw Error('Choose a valid VALR market, timeframe and date range.');
 const start=Math.floor(from/duration)*duration;
 const end=Math.min(Math.ceil(to/duration)*duration,Math.floor(Date.now()/1000/duration)*duration);
 if(start>=end)throw Error('No completed candles exist in this date range yet.');
 const sourceSeconds=body.timeframe==='h4'?3600:duration;
 if((end-start)/sourceSeconds>5000)throw Error('This VALR range exceeds 5,000 source candles per timeframe. Choose a shorter range.');
 const pageSpan=100*sourceSeconds;
 const candles:Candle[]=[];let missingCandles=0;
 for(let cursor=start;cursor<end;cursor+=pageSpan){
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const pageEnd=Math.min(cursor+pageSpan,end);
  let page:Page|undefined;
  for(let attempt=0;attempt<3;attempt++){
   try{page=await postApiJson<Page>('/api/valr/candles',{asset:body.asset,timeframe:body.timeframe,from:new Date(cursor*1000).toISOString(),to:new Date(pageEnd*1000).toISOString()},'VALR market data',signal);break}
   catch(error){if(!(error instanceof Error)||!/rate limit/i.test(error.message)||attempt===2)throw error;onRetry?.();await waitForRetry(signal)}
  }
  if(!page)throw Error('VALR market data is unavailable.');
  if(!Array.isArray(page.candles)||!Number.isFinite(page.missingCandles)||page.missingCandles<0)throw Error('VALR returned an invalid historical page.');
  candles.push(...page.candles);missingCandles+=page.missingCandles;
 }
 if(!candles.length)throw Error('VALR returned no candles for this range. Try a more recent range or another market.');
 let observedGaps=0;for(let i=1;i<candles.length;i++)if(candles[i].time-candles[i-1].time>duration)observedGaps++;
 return {candles,source:'VALR',observedGaps:Math.max(observedGaps,missingCandles),missingCandles};
}
