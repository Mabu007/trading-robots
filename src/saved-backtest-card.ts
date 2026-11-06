import type {CloudBot} from './firebase';
import type {BacktestCardData} from './components/BacktestChatCard';
import {venueOf} from '../shared/venues';

export function savedBacktestCard(bot:CloudBot,state:any):BacktestCardData|null {
 const result=state?.result;
 if(!result||!Array.isArray(result.candles)||!Array.isArray(result.trades)||!result.metrics||typeof result.metrics!=='object')return null;
 const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'Unknown';
 const savedAt=typeof state.savedAt==='string'&&Number.isFinite(Date.parse(state.savedAt))?state.savedAt:'';
 return {botId:bot.id,name:bot.name,asset:typeof state.asset==='string'&&state.asset?state.asset:bot.asset,venue:venueOf(bot.venue),
  from:date(state.from),to:date(state.to),completedAt:savedAt,metrics:result.metrics,
  trades:result.trades.slice(0,100).map((trade:any)=>({id:trade.id,side:trade.side,entryTime:trade.entryTime,exitTime:trade.exitTime,entry:trade.entry,exit:trade.exit,pnl:trade.pnl,reason:trade.reason})),
  candleCount:result.candles.length,source:typeof result.source==='string'?result.source:undefined};
}
