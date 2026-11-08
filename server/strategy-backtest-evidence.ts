import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

/**
 * Inspect the existing saved browser backtest. This proves a byte-for-byte
 * source match to a stored result, NOT that the browser's calculations or
 * fills were independently verified by a trusted runner.
 */
export type StrategyBacktestEvidence={
 codeHash:string;receiptHash:string;asset:string;venue:string;from:string;to:string;
 source:string;savedAt:string;timeframe:string;provenance:'client-produced-research';
 observedCandles:number;calendarIntervals:number;
};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
/** Reject malformed or internally inconsistent CLIENT-PRODUCED simulations.
 * This is a defensive integrity check, NOT independent market-data or strategy
 * execution verification. A trusted server-run receipt is a separate gate.
 */
function validateClientBacktestResult(state:any){
 const candles=state.result.candles as any[],trades=state.result.trades as any[],m=state.result.metrics;
 const intervals:Record<string,number>={m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400,d1:86400};
 const interval=intervals[state.result.timeframe];
 if(!interval||candles.length<2||candles.length>50000||trades.length>candles.length||!Array.isArray(state.result.equity)||state.result.equity.length!==candles.length)
  throw Error('Saved backtest has invalid candle coverage or missing equity evidence. Run a new test.');
 let last=-Infinity;
 const start=Date.parse(state.from+'T00:00:00Z')/1000,end=Date.parse(state.to+'T00:00:00Z')/1000+86400;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw Error('Saved backtest has invalid date coverage.');
 for(const c of candles){
  if(!c||!Number.isSafeInteger(c.time)||c.time%interval!==0||c.time<=last||c.time<start||c.time>=end||
    ![c.open,c.high,c.low,c.close,c.volume].every((v:unknown)=>typeof v==='number'&&Number.isFinite(v))||
    c.open<=0||c.low<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0)
   throw Error('Saved backtest contains malformed or out-of-order candles; cannot authorize from this result.');
  last=c.time;
 }
 const validTimes=new Set(candles.map(c=>c.time));
 let wins=0,net=0;
 for(const t of trades){
  if(!t||!['LONG','SHORT'].includes(t.side)||!['stop','target','signal','end'].includes(t.reason)||
    ![t.entryTime,t.exitTime].every((v:unknown)=>Number.isSafeInteger(v))||t.entryTime>t.exitTime||
    !validTimes.has(t.entryTime)||!validTimes.has(t.exitTime)||
    ![t.entry,t.exit,t.stop,t.target,t.pnl].every((v:unknown)=>typeof v==='number'&&Number.isFinite(v))||
    t.entry<=0||t.exit<=0||t.stop<=0||t.target<=0||t.entry===t.stop)
   throw Error('Saved backtest contains an invalid simulated trade.');
  if(t.pnl>0)wins++;
  net+=t.pnl;
 }
 const approx=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
 if(!Number.isSafeInteger(m.trades)||m.trades!==trades.length||m.wins!==wins||m.losses!==trades.length-wins||
  !approx(m.winRate,trades.length?wins/trades.length:0)||!approx(m.netReturn,net)||!approx(m.endingBalance,net))
  throw Error('Saved backtest metrics do not match the recorded trades. Run a new test.');
 let peak=0,drawdown=0;
 for(let i=0;i<candles.length;i++){
  const point=state.result.equity[i];
  if(!point||point.time!==candles[i].time||typeof point.value!=='number'||!Number.isFinite(point.value))
   throw Error('Saved backtest has invalid simulated equity data.');
  peak=Math.max(peak,point.value);drawdown=Math.max(drawdown,Math.max(0,peak-point.value));
 }
 if(!approx(m.maxDrawdown,drawdown)||!approx(state.result.equity.at(-1).value,net))
  throw Error('Saved backtest drawdown or ending equity is inconsistent with the result.');
}

export function inspectBacktestEvidence(raw:string,uid:string,botId:string,expected:{code:string;asset:string;venue:string;executionTimeframe:string}):StrategyBacktestEvidence{
 if(!raw||raw.length>3_200_000)throw Error('Saved backtest is unavailable or exceeds the supported size. Run a new test.');
 let file:any,state:any;
 try{
  file=JSON.parse(raw);
  if(file.format!=='gzip-base64'||file.version!==2||file.userId!==uid||file.botId!==botId||
   typeof file.payload!=='string'||file.payload.length>3_000_000||file.payload.length<1||
   !Number.isInteger(file.uncompressedBytes)||file.uncompressedBytes<=0||file.uncompressedBytes>60_000_000)throw Error();
  const bytes=gunzipSync(Buffer.from(file.payload,'base64'),{maxOutputLength:60_000_000});
  if(bytes.byteLength!==file.uncompressedBytes)throw Error();
  state=JSON.parse(bytes.toString('utf8'));
 }catch{throw Error('Saved backtest evidence is incomplete or cannot be verified. Run a new test.')}
 if(!state||typeof state!=='object'||typeof state.strategyCode!=='string'||typeof state.asset!=='string'||
  typeof state.venue!=='string'||!date(state.from)||!date(state.to)||!state.result||
  !Array.isArray(state.result.candles)||!Array.isArray(state.result.trades)||
  state.result.candles.length<1||!state.result.metrics||typeof state.result.metrics!=='object')
  throw Error('Saved backtest lacks a complete strategy revision and result. Run a new test.');
 if(state.strategyCode!==expected.code||state.asset!==expected.asset||state.venue!==expected.venue||
  state.result.timeframe!==expected.executionTimeframe)
  throw Error('Saved backtest belongs to a different strategy revision, instrument or timeframe. Run a new backtest before deploying.');
 validateClientBacktestResult(state);
 if(typeof state.riskPercent==='number'&&state.riskPercent!==undefined&&state.riskPercent!==null){
  // Risk percent is tested and displayed separately from the live riskUsd setting.
  if(!Number.isFinite(state.riskPercent))throw Error('Saved backtest risk metadata is invalid.');
 }
 const intervalSeconds:Record<string,number>={m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400,d1:86400};
 const dateSpanSeconds=(Date.parse(state.to+'T00:00:00Z')-Date.parse(state.from+'T00:00:00Z'))/1000+86400;
 const calendarIntervals=Math.round(dateSpanSeconds/intervalSeconds[state.result.timeframe]);
 return {codeHash:hash(state.strategyCode),receiptHash:hash(raw),asset:state.asset,venue:state.venue,
  from:state.from,to:state.to,source:typeof state.result.source==='string'?state.result.source:'Historical data',
  savedAt:typeof file.savedAt==='string'?file.savedAt:'',
  timeframe:state.result.timeframe,provenance:'client-produced-research',
  observedCandles:state.result.candles.length,calendarIntervals};
}
