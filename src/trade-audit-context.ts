import type {Trade,Result,Candle} from './types';
import type {StrategyRun} from './strategy-workbench';

export type TradeAuditData={
 source:string;asset:string;venue:string;timeframe:string;tradeId:string;
 trade:Trade;entryTime:string;exitTime:string;strategy:string;backtestMetrics:Result['metrics'];
 backtestFrom:string;backtestTo:string;contextCandles:{beforeEntry:Candle[];duringTrade:Candle[];afterExit:Candle[]};
 contextLimit:string;chartAvailable:boolean;historySource:string;
};
/** Build auditable context exclusively from the saved exact strategy run.
 * Always disclose when history was truncated or is missing.
 */
export function createBacktestTradeAudit(run:StrategyRun,tradeId:number):TradeAuditData {
 if(!run||!run.result||!Array.isArray(run.result.trades)||!Array.isArray(run.result.candles)||
    typeof run.strategyCode!=='string')throw Error('No complete saved robot backtest is available for inspection.');
 const trade=run.result.trades.find(t=>t.id===tradeId);
 if(!trade||!Number.isFinite(trade.entryTime)||!Number.isFinite(trade.exitTime))throw Error('Selected trade was not found in the saved backtest.');
 const candles=run.result.candles;
 const entryIndex=candles.findIndex(c=>c.time>=trade.entryTime);
 const exitIndex=candles.findIndex(c=>c.time>=trade.exitTime);
 const beforeEntry=entryIndex>=0?candles.slice(Math.max(0,entryIndex-30),entryIndex):[];
 const duringTrade=entryIndex>=0&&exitIndex>=entryIndex?candles.slice(entryIndex,Math.min(exitIndex+1,entryIndex+181)):[];
 const afterExit=exitIndex>=0?candles.slice(exitIndex+1,exitIndex+21):[];
 const totalDuring=entryIndex>=0&&exitIndex>=entryIndex?exitIndex-entryIndex+1:0;
 const limitations=[
  'This is historical research from the saved exact robot revision, not actual broker fills.',
  'OHLC candles cannot establish the sequence of prices within each candle.',
  (entryIndex<0||exitIndex<0)?'Entry or exit candles are unavailable in the saved history.':null,
  totalDuring>duringTrade.length?'Only the first 180 in-trade candles are attached; do not infer omitted price movement.':null,
  run.strategyCode.length>18_000?'Only the first 18,000 characters of the saved strategy source are attached.':null,
 ].filter(Boolean).join(' ');
 return {
  source:'Saved robot backtest and exact saved strategy source',
  asset:run.asset,venue:run.venue,timeframe:String(run.result.timeframe||'m1'),
  tradeId:String(trade.id),trade,entryTime:new Date(trade.entryTime*1000).toISOString(),
  exitTime:new Date(trade.exitTime*1000).toISOString(),
  strategy:run.strategyCode.slice(0,18_000),backtestMetrics:run.result.metrics,
  backtestFrom:run.from,backtestTo:run.to,
  contextCandles:{beforeEntry,duringTrade,afterExit},
  contextLimit:limitations,chartAvailable:entryIndex>=0&&exitIndex>=0,
  historySource:String(run.result.source||'Saved historical market candles')
 };
}
