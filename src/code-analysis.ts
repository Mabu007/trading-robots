/** Auditable built-in market analysis tools. No generated JS is ever eval'd. */
export type AnalysisKind='liquidity_sweeps'|'volatility_profile';
export type CodeAnalysis={id:string;name:string;kind:AnalysisKind;asset:string;venue:'valr'|'propdao'|'hyperliquid'|'ctrader';timeframe:'m1'|'m5'|'m15'|'h1';lookback:number;source:string;updatedAt?:number};
export type MarketBar={time:number;open:number;high:number;low:number;close:number};
export type MarketFinding={time:number;kind:string;price:number;level:number};
export type MarketReport={kind:AnalysisKind;asset:string;timeframe:string;from:string;to:string;bars:number;gaps:number;findings:MarketFinding[];high:number|null;low:number|null;atr14:number|null;atrPercent:number|null;realizedVolatilityPercent:number|null;regime:string;explanation:string};
export function analysisId(kind:AnalysisKind,venue:string,asset:string,timeframe:string){
 return 'analysis-'+[kind,venue,asset,timeframe].join('-').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,120);
}
export function analysisSource(kind:AnalysisKind):string{
 if(kind==='liquidity_sweeps')return [
  '// Trusted reusable liquidity sweep scanner: descriptive source only.',
  '// Executed by Trading Vibes audited analysis engine, not eval() or a broker.',
  'export function analyze(candles, lookback = 5) {',
  ' const findings=[];',
  ' for(let i=lookback;i<candles.length;i++){',
  '  const previous=candles.slice(i-lookback,i);',
  '  const high=Math.max(...previous.map(b=>b.high));',
  '  const low=Math.min(...previous.map(b=>b.low));',
  "  if(candles[i].high>high && candles[i].close<high) findings.push({time:candles[i].time,kind:'bearish sweep',level:high});",
  "  if(candles[i].low<low && candles[i].close>low) findings.push({time:candles[i].time,kind:'bullish sweep',level:low});",
  ' } return findings;',
  '}'
 ].join('\n');
 return [
  '// Trusted read-only volatility profile: descriptive source only.',
  '// Actual execution uses Trading Vibes bounded analysis implementation.',
  'export function analyze(candles) {',
  ' const tr=[]; for(let i=1;i<candles.length;i++){',
  '  const c=candles[i],p=candles[i-1];',
  '  tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));',
  ' }',
  ' const atr14=tr.slice(-14).reduce((a,b)=>a+b,0)/14;',
  ' return {atr14,atrPercent:100*atr14/candles.at(-1).close};',
  '}'
 ].join('\n');
}
const valid=(b:MarketBar)=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.time>0&&b.close>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close);
const average=(ns:number[])=>ns.length?ns.reduce((a,b)=>a+b,0)/ns.length:0;
export function analyzeMarket(input:{kind:AnalysisKind;asset:string;timeframe:string;from:string;to:string;lookback?:number},candles:MarketBar[]):MarketReport {
 const windowMs:{[key:string]:number}={m1:60,m5:300,m15:900,h1:3600};
 const seconds=windowMs[input.timeframe];
 if(!seconds)throw Error('Analysis timeframe is unavailable.');
 const from=Date.parse(input.from),to=Date.parse(input.to);
 if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to||to-from>32*86400000)throw Error('Invalid analysis window.');
 if(candles.length>50_000)throw Error('Analysis candle limit exceeded.');
 const bars=candles.filter(valid).filter(b=>b.time*1000>=from&&b.time*1000<to).sort((a,b)=>a.time-b.time);
 const normalized=bars.filter((b,i)=>i===0||b.time!==bars[i-1].time);
 const gaps=normalized.slice(1).reduce((n,b,i)=>n+(b.time-normalized[i].time>seconds*1.5?1:0),0);
 const findings:MarketFinding[]=[];
 const lookback=Math.max(3,Math.min(25,Math.trunc(input.lookback||5)));
 if(input.kind==='liquidity_sweeps')for(let i=lookback;i<normalized.length;i++){
  const prev=normalized.slice(i-lookback,i),hi=Math.max(...prev.map(b=>b.high)),lo=Math.min(...prev.map(b=>b.low)),c=normalized[i];
  if(c.high>hi&&c.close<hi)findings.push({time:c.time,kind:'bearish sweep',price:c.close,level:hi});
  if(c.low<lo&&c.close>lo)findings.push({time:c.time,kind:'bullish sweep',price:c.close,level:lo});
 }
 const tr=normalized.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-normalized[i].close),Math.abs(c.low-normalized[i].close)));
 const atr14=tr.length>=14?average(tr.slice(-14)):null;
 const last=normalized.at(-1);
 const returns=normalized.slice(1).map((c,i)=>Math.log(c.close/normalized[i].close));
 const mean=average(returns);
 const vol=returns.length>=15?Math.sqrt(average(returns.map(r=>(r-mean)**2)))*100:null;
 const atrPercent=atr14!==null&&last?atr14/last.close*100:null;
 const samples=tr.length>=56?Array.from({length:tr.length-13},(_,i)=>average(tr.slice(i,i+14))).slice(-100):[];
 const percentile=atr14!==null&&samples.length?samples.filter(v=>v<=atr14).length/samples.length:null;
 const regime=percentile===null?'Insufficient data for a volatility percentile':percentile>=.8?'High relative volatility':percentile<=.2?'Low relative volatility':'Normal relative volatility';
 const high=normalized.length?Math.max(...normalized.map(b=>b.high)):null,low=normalized.length?Math.min(...normalized.map(b=>b.low)):null;
 const explanation=input.kind==='liquidity_sweeps'?'A sweep requires a wick beyond the preceding lookback high/low and a close back inside. This detects candidates, not confirmed reversals.':'ATR14 and standard deviation of log returns use completed requested candles; the volatility regime compares recent ATR to prior rolling samples.';
 return {kind:input.kind,asset:input.asset,timeframe:input.timeframe,from:input.from,to:input.to,bars:normalized.length,gaps,findings:findings.slice(-250),high,low,atr14,atrPercent,realizedVolatilityPercent:vol,regime,explanation};
}
