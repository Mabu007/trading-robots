import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {getQuickJSWASMModule} from '@cf-wasm/quickjs/node';
import {evaluateStrategyInSandbox} from '../workers/strategy-sandbox.ts';
import {parseStrategyConfig,validateCandles} from '../src/strategy.ts';
import {simulate} from '../src/engine.ts';
import {intervalMs} from './market-data.ts';
import type {Candle,Result} from '../src/types.ts';

/** This proves independent server-side strategy replay on independently retrieved
 * reference OHLC data. It does not certify PropDAO broker fills or future P&L.
 */
export class ReplayUnavailable extends Error {}
export class ReplayMismatch extends Error {}
type Feed={asset:string;timeframe:string;source:string;candles:Candle[];missingCandles:number;observedGaps:number;expectedCandles:number;coverageComplete?:boolean};
export type TrustedReplayReceipt={
 provenance:'server-replayed-reference';
 replayHash:string;source:string;providerSymbol:string;codeHash:string;
 from:string;to:string;timeframe:string;candleCount:number;verifiedAt:string;
 assumptions:{spread:number;slippage:number;commissionR:number;nextCandleFills:true};
};
export type TrustedReplayInput={
 raw:string;uid:string;botId:string;code:string;asset:string;providerSymbol:string;
 load:(query:{asset:string;timeframe:string;from:string;to:string})=>Promise<Feed>;
 now?:()=>number;
};

const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const approx=(a:unknown,b:unknown)=>typeof a==='number'&&typeof b==='number'&&
 (Object.is(a,b)||(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-6*Math.max(1,Math.abs(a),Math.abs(b))));
function assertSimulationParity(saved:Result,actual:Result){
 if(saved.trades.length!==actual.trades.length||saved.equity.length!==actual.equity.length)
  throw new ReplayMismatch('Saved backtest differs from independent server simulation; do not authorize this revision.');
 for(let i=0;i<saved.trades.length;i++){
  const a=saved.trades[i],b=actual.trades[i];
  if(a.side!==b.side||a.reason!==b.reason||a.entryTime!==b.entryTime||a.exitTime!==b.exitTime||
    !['entry','exit','stop','target','pnl'].every(k=>approx((a as any)[k],(b as any)[k])))
   throw new ReplayMismatch('Saved trades disagree with the independent server replay.');
 }
 for(let i=0;i<saved.equity.length;i++){
  const a=saved.equity[i],b=actual.equity[i];
  if(a.time!==b.time||!approx(a.value,b.value))throw new ReplayMismatch('Saved equity curve differs from independent server replay.');
 }
 for(const key of ['trades','wins','losses','winRate','netReturn','maxDrawdown','endingBalance'] as const){
  if(!approx(saved.metrics[key],actual.metrics[key]))throw new ReplayMismatch('Saved performance metrics differ from independent server replay.');
 }
}

/** Always use an owner-validated saved snapshot, never AI-authored metrics as input. */
export async function runTrustedBacktestReplay(input:TrustedReplayInput):Promise<TrustedReplayReceipt>{
 const {raw,uid,botId,code,asset,providerSymbol,load}=input;
 let saved:any,wrapped:any;
 try{
  wrapped=JSON.parse(raw);
  if(wrapped?.userId!==uid||wrapped?.botId!==botId||wrapped?.format!=='gzip-base64'||
    wrapped?.version!==2||typeof wrapped?.payload!=='string'||wrapped.payload.length>3_000_000||
    !Number.isInteger(wrapped.uncompressedBytes)||wrapped.uncompressedBytes>60_000_000)throw Error();
  const bytes=gunzipSync(Buffer.from(wrapped.payload,'base64'),{maxOutputLength:60_000_000});
  if(bytes.length!==wrapped.uncompressedBytes)throw Error();
  saved=JSON.parse(bytes.toString());
 }catch{throw new ReplayMismatch('Saved backtest payload cannot be independently replayed.');}
 if(saved.strategyCode!==code||saved.asset!==asset||saved.venue!=='propdao')
  throw new ReplayMismatch('The saved backtest does not match the exact authorized code and venue.');
 const cfg=parseStrategyConfig(code),tf=cfg.executionTimeframe;
 if(saved.result?.timeframe!==tf||!Array.isArray(saved.result?.candles))
  throw new ReplayMismatch('Saved backtest timeframe is different from the strategy.');
 const from=Date.parse(saved.from+'T00:00:00Z'),end=Date.parse(saved.to+'T00:00:00Z')+86_400_000;
 const now=(input.now||Date.now)();
 if(!Number.isFinite(from)||!Number.isFinite(end)||end<=from||end>now||!providerSymbol||
  cfg.timeframes.length>3)throw new ReplayUnavailable('Independent replay is unavailable for this historical range or market.');
 const datasets:Record<string,Candle[]>={},lineage:string[]=[],sourceLabels:string[]=[];
 for(const timeframe of cfg.timeframes){
  const ms=intervalMs[timeframe as keyof typeof intervalMs];
  if(!ms||!Number.isFinite(ms))throw new ReplayUnavailable('Independent replay does not support this timeframe.');
  const warmupStart=from-200*ms;
  if(warmupStart<Date.parse('2025-07-27T08:00:00Z')||(end-warmupStart)/ms>6000)
   throw new ReplayUnavailable('The saved date range exceeds bounded independent replay limits.');
  let feed:Feed;
  try{
   const query={asset:providerSymbol,timeframe,from:new Date(warmupStart).toISOString(),to:new Date(end).toISOString()};
   // Never make deployment review depend indefinitely on a slow historical provider.
   let deadline:ReturnType<typeof setTimeout>|undefined;
   try{
    feed=await Promise.race([load(query),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new ReplayUnavailable('Reference-data verification timed out.')),7000);})]);
   }finally{if(deadline)clearTimeout(deadline)}
  }catch{throw new ReplayUnavailable('Independent R2/Dwellir historical data could not be retrieved in time.');}
  const expectedCount=(end-warmupStart)/ms;
  if(!feed||feed.asset!==providerSymbol||feed.timeframe!==timeframe||!feed.source||
    !Array.isArray(feed.candles)||!feed.candles.length||feed.expectedCandles!==expectedCount||
    feed.candles.length!==expectedCount||feed.candles[0].time*1000!==warmupStart||
    feed.candles.at(-1)!.time*1000!==end-ms||
    feed.missingCandles!==0||feed.observedGaps!==0||feed.coverageComplete===false)
   throw new ReplayUnavailable('Independent reference candles are missing or incomplete.');
  const sorted=validateCandles(feed.candles);
  if(sorted.length!==feed.candles.length||sorted.some((c,i)=>c.time!==feed.candles[i].time))
   throw new ReplayUnavailable('Independent reference data failed strict candle validation.');
  datasets[timeframe]=sorted;
  sourceLabels.push(`${timeframe}: ${feed.source}`);
  lineage.push(hash(JSON.stringify({timeframe,source:feed.source,candles:sorted})));
 }
 const execution=datasets[tf];
 if(!execution)throw new ReplayUnavailable('Execution timeframe was not independently loaded.');
 const actualBars=execution.filter(c=>c.time*1000>=from&&c.time*1000<end);
 const browserBars=saved.result.candles as Candle[];
 if(actualBars.length!==browserBars.length)throw new ReplayMismatch('Saved backtest candle count differs from independent reference data.');
 for(let i=0;i<actualBars.length;i++){
  const a=actualBars[i],b=browserBars[i];
  if(a.time!==b.time||!(['open','high','low','close','volume'] as const).every(key=>approx(a[key],b[key])))
   throw new ReplayMismatch('Saved candle prices differ from independently retrieved R2/Dwellir history.');
 }
 let decisions:unknown[];
 try{
  const wasm=await getQuickJSWASMModule();
  decisions=evaluateStrategyInSandbox(wasm,code,datasets,cfg);
 }catch{throw new ReplayUnavailable('Independent QuickJS strategy replay could not complete.');}
 if(decisions.length!==execution.length)throw new ReplayUnavailable('Independent strategy decisions were incomplete.');
 const warmup=execution.length-actualBars.length;
 const costs={spread:cfg.backtestSpread||0,slippage:cfg.backtestSlippage||0,commissionR:cfg.backtestCommissionR||0};
 const run=simulate(actualBars,decisions.slice(warmup),0,costs,cfg.riskReward);
 assertSimulationParity(saved.result,run);
 const replayHash=hash(JSON.stringify({
  version:1,uid,botId,asset,providerSymbol,codeHash:hash(code),from:saved.from,to:saved.to,
  lineage,assumptions:costs,metrics:run.metrics,trades:run.trades,equity:run.equity
 }));
 return {provenance:'server-replayed-reference',replayHash,source:sourceLabels.join('; ').slice(0,320),
  providerSymbol,codeHash:hash(code),from:saved.from,to:saved.to,timeframe:tf,
  candleCount:actualBars.length,verifiedAt:new Date(now).toISOString(),
  assumptions:{...costs,nextCandleFills:true}};
}
