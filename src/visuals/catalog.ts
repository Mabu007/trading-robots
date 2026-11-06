import {defineCatalog} from '@json-render/core';
import {schema} from '@json-render/react/schema';
import {z} from 'zod';

// Only source-backed record references are model-selectable. The model cannot
// invent balances, PnL, fills, candles, headlines, trade actions or URLs.
const reference=z.object({recordId:z.string().min(1).max(160)}).strict();
export const tradingCatalog=defineCatalog(schema,{
 components:{
  TradeInspection:{props:reference,description:'Inspect a verified, read-only broker trade record with fees, timestamps, and missing evidence.'},
  CandlestickChart:{props:reference,description:'Render genuine supplied time-ordered OHLC candles. Never draw synthetic candles.'},
  BacktestSummary:{props:reference,description:'Display a saved, verified strategy backtest and simulation disclaimers.'},
  EquityCurve:{props:reference,description:'Chart actual supplied backtest equity or R progression, not a fabricated profit curve.'},
  BrokerAccounts:{props:reference,description:'List signed-in user-owned and verified broker account balances and their venues.'},
  StrategyCard:{props:reference,description:'Display an actual saved strategy name, asset, venue, timeframe and state.'},
  RiskBreakdown:{props:reference,description:'Show available account risk, loss limits and position exposure with explicit units.'},
  MarketSnapshot:{props:reference,description:'Timestamped, symbol-specific market summary with exact source attribution.'},
  MonitorStatus:{props:reference,description:'Display real, verified Cloudflare watch runtime status and latest event.'},
  ActionApproval:{props:reference,description:'Read-only preview of an action requiring the existing authorized approval flow.'},
  NewsSnapshot:{props:reference,description:'Show real indexed GDELT headlines with publishers, indexed timestamps and article links, never invented news.'},
  NewsCoverage:{props:reference,description:'Show GDELT article count coverage over time; explicitly not trading volume or price sentiment.'}
 },
 actions:{} // Generated UI never directly authorizes a broker, monitor or strategy mutation.
});
export const tradingComponentNames=['TradeInspection','CandlestickChart','BacktestSummary','EquityCurve','BrokerAccounts','StrategyCard','RiskBreakdown','MarketSnapshot','MonitorStatus','ActionApproval','NewsSnapshot','NewsCoverage'] as const;
export type TradingComponentName=typeof tradingComponentNames[number];
export function visualSpec(type:TradingComponentName,recordId:string){
 if(!tradingComponentNames.includes(type)||typeof recordId!=='string'||recordId.length>160||!recordId)return null;
 return {root:'root',elements:{root:{type,props:{recordId},children:[]}}};
}
