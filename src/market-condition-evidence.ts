/** Fresh completed-candle indicators are context, NEVER deployed robot checks. */
type Candle={time:number;open:number;high:number;low:number;close:number;volume?:number};
const durations:Record<string,number>={m1:60,m5:300,m15:900,h1:3600,h4:14400};
const mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
const round=(x:number)=>Number(x.toFixed(6));
function ema(x:number[],n:number){
 if(x.length<n)return null;
 let v=mean(x.slice(0,n));for(let i=n;i<x.length;i++)v=v*(1-2/(n+1))+x[i]*2/(n+1);
 return round(v);
}
function rsi(x:number[],n=14){
 if(x.length<=n)return null;
 const changes=x.slice(1).map((v,i)=>v-x[i]);
 let g=mean(changes.slice(0,n).map(v=>Math.max(0,v))),l=mean(changes.slice(0,n).map(v=>Math.max(0,-v)));
 for(const change of changes.slice(n)){g=(g*(n-1)+Math.max(0,change))/n;l=(l*(n-1)+Math.max(0,-change))/n}
 return g===0&&l===0?50:l===0?100:round(100-100/(1+g/l));
}
export function completedMarketEvidence(input:{symbol:string;source:string;timeframe:string;bars:Candle[];nowSeconds:number}){
 const period=durations[input.timeframe];if(!period||!Array.isArray(input.bars)||!Number.isFinite(input.nowSeconds))return {available:false,reason:'Invalid timeframe or market evidence'};
 const sorted=input.bars.filter(c=>c&&Number.isInteger(c.time)&&c.time>0&&c.time+period<=input.nowSeconds&&
  [c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0)&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close))
  .sort((a,b)=>a.time-b.time);
 const bars=sorted.filter((c,i)=>i===0||c.time!==sorted[i-1].time).slice(-120);
 if(bars.length<22)return {available:false,reason:'Insufficient verified completed candles',source:input.source,completedBars:bars.length};
 const last=bars.at(-1)!;
 const closes=bars.map(c=>c.close),tr=bars.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-bars[i].close),Math.abs(c.low-bars[i].close)));
 const atr=mean(tr.slice(-14)),sample=tr.length>=56?Array.from({length:tr.length-13},(_,i)=>mean(tr.slice(i,i+14))).slice(-50):[];
 const p=sample.length?sample.filter(v=>v<=atr).length/sample.length:null;
 return {available:true,source:input.source,symbol:input.symbol,timeframe:input.timeframe,
  marketType:'Reference candles; NOT broker fills or strategy filter checks',
  asOf:new Date((last.time+period)*1000).toISOString(),ageSeconds:Math.max(0,Math.floor(input.nowSeconds-last.time-period)),
  completedBars:bars.length,gaps:bars.slice(1).filter((c,i)=>c.time-bars[i].time>period*1.5).length,
  close:last.close,volume:last.volume??null,atr14:round(atr),atrPercent:round(100*atr/last.close),
  ema9:ema(closes,9),ema21:ema(closes,21),rsi14:rsi(closes),
  volatility:p===null?'insufficient comparative history':p>=.8?'high':p<=.2?'low':'normal',
  limitation:'Indicators are from independently completed candles, not the deployed robot execution. Do not assume any specific filter has passed.'};
}
