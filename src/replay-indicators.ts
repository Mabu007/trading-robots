import type {ReplayBar} from './market-replay-engine';
export type IndicatorType='EMA'|'SMA'|'Bollinger Bands'|'RSI'|'MACD'|'Stochastic'|'ATR'|'ADX'|'Ichimoku';
export type IndicatorSpec={id:string;type:IndicatorType;period:number;color:string};
type Point={time:number;value:number};
export type IndicatorLine={label:string;points:Point[];pane:'price'|'oscillator'};
const point=(b:ReplayBar,value:number):Point=>({time:b.time,value});
function ema(values:number[],period:number){const out:number[]=[];let current=values[0]??0;for(const value of values){current+=2/(period+1)*(value-current);out.push(current)}return out;}
export function calculateIndicator(bars:ReplayBar[],spec:IndicatorSpec):IndicatorLine[]{
 const n=Math.max(2,Math.min(200,Math.round(spec.period))),closes=bars.map(b=>b.close),out:Point[]=[],second:Point[]=[],third:Point[]=[],fourth:Point[]=[];
 const add=(arr:Point[],i:number,v:number)=>{if(Number.isFinite(v))arr.push(point(bars[i],v))};
 if(spec.type==='EMA'){const values=ema(closes,n);bars.forEach((_,i)=>{if(i>=n-1)add(out,i,values[i])});}
 if(spec.type==='SMA'||spec.type==='Bollinger Bands'){for(let i=n-1;i<bars.length;i++){const slice=closes.slice(i-n+1,i+1),mean=slice.reduce((a,b)=>a+b,0)/n;add(out,i,mean);if(spec.type==='Bollinger Bands'){const deviation=Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/n);add(second,i,mean+2*deviation);add(third,i,mean-2*deviation)}}}
 if(spec.type==='RSI'){let gain=0,loss=0;for(let i=1;i<bars.length;i++){const change=closes[i]-closes[i-1],up=Math.max(0,change),down=Math.max(0,-change);if(i<=n){gain+=up/n;loss+=down/n}else{gain=(gain*(n-1)+up)/n;loss=(loss*(n-1)+down)/n}if(i>=n)add(out,i,loss===0?(gain===0?50:100):100-100/(1+gain/loss));}}
 if(spec.type==='MACD'){const fast=ema(closes,12),slow=ema(closes,26),macd=fast.map((v,i)=>v-slow[i]),signal=ema(macd,9);bars.forEach((_,i)=>{if(i>=33){add(out,i,macd[i]);add(second,i,signal[i])}})}
 if(spec.type==='Stochastic'){const kvals:number[]=[];for(let i=n-1;i<bars.length;i++){const sample=bars.slice(i-n+1,i+1),high=Math.max(...sample.map(x=>x.high)),low=Math.min(...sample.map(x=>x.low)),v=high===low?50:(bars[i].close-low)/(high-low)*100;kvals.push(v);add(out,i,v);if(kvals.length>=3)add(second,i,kvals.slice(-3).reduce((a,b)=>a+b,0)/3)}}
 if(spec.type==='ATR'||spec.type==='ADX'){let tr=0,plus=0,minus=0,adx=0,dxCount=0;for(let i=1;i<bars.length;i++){const b=bars[i],prev=bars[i-1],range=Math.max(b.high-b.low,Math.abs(b.high-prev.close),Math.abs(b.low-prev.close)),up=b.high-prev.high,down=prev.low-b.low,positive=up>down&&up>0?up:0,negative=down>up&&down>0?down:0;if(i<=n){tr+=range;plus+=positive;minus+=negative}else{tr=tr-tr/n+range;plus=plus-plus/n+positive;minus=minus-minus/n+negative}if(i>=n){if(spec.type==='ATR')add(out,i,tr/n);else{const p=tr?100*plus/tr:0,m=tr?100*minus/tr:0,dx=p+m?100*Math.abs(p-m)/(p+m):0;dxCount++;adx=dxCount<=n?adx+dx/n:(adx*(n-1)+dx)/n;if(dxCount>=n)add(out,i,adx)}}}}
 if(spec.type==='Ichimoku'){const midpoint=(i:number,length:number)=>{const slice=bars.slice(i-length+1,i+1);return (Math.max(...slice.map(b=>b.high))+Math.min(...slice.map(b=>b.low)))/2};for(let i=8;i<bars.length;i++){const tenkan=midpoint(i,9);add(out,i,tenkan);if(i>=25){const kijun=midpoint(i,26);add(second,i,kijun);add(third,i,(tenkan+kijun)/2)}if(i>=51)add(fourth,i,midpoint(i,52));}}
 const pane=spec.type==='EMA'||spec.type==='SMA'||spec.type==='Bollinger Bands'||spec.type==='Ichimoku'?'price':'oscillator';
 return [out,second,third,fourth].map((points,i)=>({label:spec.type+(i?` ${i+1}`:''),points,pane}));
}
