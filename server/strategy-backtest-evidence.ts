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
};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
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
 if(typeof state.riskPercent==='number'&&state.riskPercent!==undefined&&state.riskPercent!==null){
  // Risk percent is tested and displayed separately from the live riskUsd setting.
  if(!Number.isFinite(state.riskPercent))throw Error('Saved backtest risk metadata is invalid.');
 }
 return {codeHash:hash(state.strategyCode),receiptHash:hash(raw),asset:state.asset,venue:state.venue,
  from:state.from,to:state.to,source:typeof state.result.source==='string'?state.result.source:'Historical data',
  savedAt:typeof file.savedAt==='string'?file.savedAt:'',
  timeframe:state.result.timeframe,provenance:'client-produced-research'};
}
