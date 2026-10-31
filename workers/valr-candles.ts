import { TF_SECONDS } from '../shared/trading';
import type { PaperCandle } from './valr-paper';

type Row={currencyPairSymbol:string;bucketPeriodInSeconds:number;startTime:string;open:string;high:string;low:string;close:string;volume:string};
const inFlight=new Map<string,Promise<Row[]>>();
const completed=new Map<string,{at:number;rows:Row[]}>();
async function page(url:string,request:typeof fetch):Promise<Row[]>{
 const cached=completed.get(url);if(cached&&Date.now()-cached.at<15_000)return cached.rows;
 const existing=inFlight.get(url);if(existing)return existing;
 const task=(async()=>{const res=await request(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10_000)});if(res.status===429)throw Error('VALR rate limit reached');if(!res.ok)throw Error(`VALR candle request failed (HTTP ${res.status})`);const rows:unknown=await res.json();if(!Array.isArray(rows))throw Error('Invalid VALR candle response');completed.set(url,{at:Date.now(),rows});while(completed.size>128)completed.delete(completed.keys().next().value!);return rows as Row[]})();
 inFlight.set(url,task);try{return await task}finally{inFlight.delete(url)}
}

// Fetches a closed, UTC-aligned interval. Never fills missing bars locally.
// The caller can deliberately retry later if VALR returns incomplete history.
export async function fetchValrCandles(pair:string,timeframe:string,start:number,end:number,request:typeof fetch=fetch,baseUrl='https://api.valr.com'):Promise<PaperCandle[]>{
 const duration=TF_SECONDS[timeframe];if(!/^[A-Z0-9]{3,30}$/.test(pair)||!duration||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<=0||start>=end||start%duration!==0||end%duration!==0)throw Error('Invalid VALR candle range');
 const base=timeframe==='h4'?3600:duration;
 if((end-start)/base>5000)throw Error('VALR request exceeds the 5,000 source-candle limit');
 const rows=new Map<number,PaperCandle>();
 for(let from=start;from<end;from+=100*base){
  const to=Math.min(end,from+100*base),params=new URLSearchParams({periodSeconds:String(base),startTime:String(from),endTime:String(to-1),skip:'0',limit:'100',includeEmpty:'true'});
  const result=await page(`${baseUrl}/v1/public/${pair}/buckets?${params}`,request);
  for(const row of result){
   const time=Date.parse(row.startTime)/1000,c={time,open:Number(row.open),high:Number(row.high),low:Number(row.low),close:Number(row.close),volume:Number(row.volume)};
   if(row.currencyPairSymbol!==pair||Number(row.bucketPeriodInSeconds)!==base||!Number.isSafeInteger(time)||time%base||![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||c.open<=0||c.low<=0||c.volume<0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.high<c.low)throw Error('Invalid VALR candle');
   if(time<from||time>=to)continue;
   const previous=rows.get(time);if(previous&&JSON.stringify(previous)!==JSON.stringify(c))throw Error('Conflicting VALR candles');rows.set(time,c);
  }
 }
 const candles:PaperCandle[]=[];
 for(let time=start;time<end;time+=duration){
  const group=Array.from({length:duration/base},(_,i)=>rows.get(time+i*base));
  if(group.some(c=>!c))throw Error(`Missing VALR candles at ${new Date(time*1000).toISOString()}`);
  const [first,...rest]=group as PaperCandle[];
  candles.push({time,open:first.open,high:Math.max(first.high,...rest.map(c=>c.high)),low:Math.min(first.low,...rest.map(c=>c.low)),close:rest.at(-1)?.close??first.close,volume:group.reduce((sum,c)=>sum+c!.volume,0)});
 }
 return candles;
}
