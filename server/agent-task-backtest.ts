import {createHash} from 'node:crypto';
import {getQuickJSWASMModule} from '@cf-wasm/quickjs/node';
import {evaluateStrategyInSandbox} from '../workers/strategy-sandbox.ts';
import {parseStrategyConfig,validateCandles} from '../src/strategy.ts';
import {simulate} from '../src/engine.ts';
import {simulatePropDAO} from '../src/propdao-evaluation.ts';
import {intervalMs,isTimeframe} from './market-data.ts';
import type {VenueMarketData} from './venue-market-data.ts';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
/** No broker orders, no host-bound code execution, no simulated account balances. */
export async function evaluateAgentDraft(input:{
 source:string;coin:string;lookbackCandles:number;market:Pick<VenueMarketData,'hyperliquidCandles'>;now?:number;windowIndex?:number
}){
 const {source,coin,lookbackCandles,market}=input,now=input.now??Date.now(),windowIndex=input.windowIndex??0;
 if(!/^[A-Za-z0-9:@._-]{1,64}$/.test(coin)||!Number.isInteger(lookbackCandles)||lookbackCandles<120||lookbackCandles>3000||!Number.isInteger(windowIndex)||windowIndex<0||windowIndex>3)throw Error('Invalid reference backtest request');
 const config=parseStrategyConfig(source);
 if(config.timeframes.length>4||config.timeframes.some((tf:string)=>!isTimeframe(tf))||!config.timeframes.includes(config.executionTimeframe))throw Error('Unsupported strategy timeframe set');
 const datasets:Record<string,ReturnType<typeof validateCandles>>={},coverage=[];
 const longest=Math.max(...config.timeframes.map((tf:string)=>intervalMs[tf as keyof typeof intervalMs]));
 const asOf=now-windowIndex*lookbackCandles*longest;
 for(const timeframe of config.timeframes as string[]){
  const period=intervalMs[timeframe as keyof typeof intervalMs],end=Math.floor(asOf/period)*period;
  const from=end-lookbackCandles*period;
  const bars=await market.hyperliquidCandles({asset:coin,timeframe,from:new Date(from).toISOString(),to:new Date(end).toISOString()});
  if(bars.source!=='Hyperliquid'||bars.asset!==coin||bars.timeframe!==timeframe||bars.missingCandles>0||bars.observedGaps>0)throw Error('Missing or mismatched public '+timeframe+' candle coverage');
  const candles=validateCandles(bars.candles);
  if(candles.length!==lookbackCandles)throw Error('Incomplete '+timeframe+' candle interval');
  datasets[timeframe]=candles;
  coverage.push({timeframe,count:candles.length,from:new Date(from).toISOString(),toExclusive:new Date(end).toISOString()});
 }
 const vm=await getQuickJSWASMModule();
 const decisions=evaluateStrategyInSandbox(vm,source,datasets,config);
 const execution=datasets[config.executionTimeframe];
 if(!execution||decisions.length!==execution.length)throw Error('Incomplete strategy decisions');
 const simulated=simulate(execution,decisions,0,{
  spread:config.backtestSpread||0,slippage:config.backtestSlippage||0,commissionR:config.backtestCommissionR||0
 },config.riskReward);
 // Challenge check is computed by deterministic QuickJS decisions and a
 // separate prop-firm equity path. This is still a reference, not a broker fill.
 const challenge=simulatePropDAO(execution,decisions,Math.min(config.riskPercent,0.5),{
  spread:config.backtestSpread||0,slippage:config.backtestSlippage||0,commissionR:config.backtestCommissionR||0
 },config.riskReward);
 const challengeSummary={status:challenge.status,completedTrades:challenge.completedTrades,
  maxObservedDrawdown:challenge.maxObservedDrawdown,maxObservedDailyLoss:challenge.maxObservedDailyLoss,
  endingEquity:challenge.equity,endingBalance:challenge.balance,profit:challenge.profit,
  benchmark:'Iron 1K reference simulation (starting $1,000, daily $20, static $50, profit target $100); not real broker fill parity'};
 const tradeSample=simulated.trades.slice(-15).map(t=>({id:t.id,time:t.exitTime,pnlR:t.pnl,reason:t.reason}));
 const worstLossR=Math.min(0,...simulated.trades.map(t=>t.pnl));
 return {codeHash:digest(source),venue:'hyperliquid-reference',source:'Hyperliquid public completed candles',coin,coverage,windowIndex,dataGaps:0,
  tradeCount:simulated.trades.length,worstLossR,metrics:simulated.metrics,tradeSample,challengeSummary,
  assumptions:{spread:config.backtestSpread||0,slippage:config.backtestSlippage||0,commissionR:config.backtestCommissionR||0},
  quality:'reference' as const,
  limitations:'Public Hyperliquid candles only; no actual PropDAO broker spread, fill, equity, challenge daily reset, open-order or intrabar path certification. No out-of-sample validation in this run.'};
}
