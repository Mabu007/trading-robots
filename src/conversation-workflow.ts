import type {Venue} from '../shared/venues';
export type TradingPreferences={
 preferredAsset:string;preferredVenue:Venue;preferredTimeframe:'m1'|'m5'|'m15'|'h1';
 defaultBacktestDays:7|30;useDefaults:boolean;
};
export const defaultTradingPreferences:TradingPreferences={
 preferredAsset:'GOLDUSDC',preferredVenue:'propdao',preferredTimeframe:'m1',defaultBacktestDays:7,useDefaults:true
};
export type ConversationTask=
 |{kind:'create';seed:string;asset?:string;venue?:Venue;name?:string}
 |{kind:'backtest';botId:string;botName:string}
 |{kind:'choose-robot';action:'edit'|'backtest'|'deploy'|'status'|'stop';robotIds:string[]};
const venues:Venue[]=['propdao','hyperliquid','valr','ctrader'];
export function verifiedPreferences(raw:unknown):TradingPreferences{
 const o=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
 return {
  preferredAsset:typeof o.preferredAsset==='string'&&/^[A-Z0-9_:.@-]{2,64}$/.test(o.preferredAsset)?o.preferredAsset:defaultTradingPreferences.preferredAsset,
  preferredVenue:venues.includes(o.preferredVenue as Venue)?o.preferredVenue as Venue:defaultTradingPreferences.preferredVenue,
  preferredTimeframe:['m1','m5','m15','h1'].includes(String(o.preferredTimeframe))?o.preferredTimeframe as TradingPreferences['preferredTimeframe']:'m1',
  defaultBacktestDays:o.defaultBacktestDays===30?30:7,
  useDefaults:o.useDefaults!==false
 };
}
export function parseMarket(text:string):string|null{
 const symbol=text.match(/\b([a-z]{2,15}(?:usdc|usdt|zar|usd))\b/i)?.[1];
 if(symbol)return symbol.toUpperCase();
 if(/\b(gold|xauusd|xau)\b/i.test(text))return 'GOLDUSDC';
 if(/\b(bitcoin|btc)\b/i.test(text))return 'BTCUSDC';
 if(/\b(ethereum|eth)\b/i.test(text))return 'ETHUSDC';
 return null;
}
export function parseVenue(text:string):Venue|null{
 const m=text.match(/\b(propdao|hyperliquid|valr|ctrader)\b/i)?.[1]?.toLowerCase();
 return m&&venues.includes(m as Venue)?m as Venue:null;
}
export function parseRobotName(text:string):string|null{
 const m=text.match(/\b(?:named|called|name (?:it|the robot))\s+["“]?([a-z][a-z0-9 -]{2,45})["”]?\s*$/i)
 ||text.match(/^\s*([a-z][a-z0-9 -]{2,42})\s+is\s+the\s+new\s+name\b/i);
 if(!m)return null;
 const candidate=(m[1]||'').replace(/[\"“”]+$/,'').trim();
 return /^(?:gold|new robot|create bot|make a new robot)$/i.test(candidate)?null:candidate.slice(0,64);
}
export function isNewRobotRequest(message:string):boolean{
 if(/^\s*(?:how|why|what|which|when|where|would|should|is)\b/i.test(message))return false;
 return /\b(?:build|create|generate|write|make)\b.{0,85}\b(?:robot|bot|strategy)\b/i.test(message)
  && !/\b(?:edit|update|improve|modify|fix|better)\b.{0,50}\b(?:robot|bot|strategy)\b/i.test(message)
  && !/\b(?:robot|bot|strategy)\b.{0,30}\b(?:better|improved|fixed|edited|updated)\b/i.test(message);
}
export function isEditFollowup(message:string):boolean{
 if(/\b(personality|profile|settings|skills)\b/i.test(message))return false;
 return /^(?:(?:yes|yeah|yep|sure|okay|ok|please|go ahead|nah)[,\s!]+)*(?:edit|update|modify|improve|rewrite|change|fix|make (?:it|this|the robot|a) (?:a )?better(?: version)?|make .* (?:dope|better))\b/i.test(message.trim());
}
export function createTaskFromMessage(message:string,previous:ConversationTask|null,prefs:TradingPreferences,history:{role:string;content:string}[]=[]):ConversationTask&{kind:'create'}{
 const prior=previous?.kind==='create'?previous:null;
 const descriptive=/\b(liquidity|sweep|scalp|trend|ema|rsi|breakout|reversal|momentum|strategy)\b/i.test(message);
 const seed=prior?.seed||(descriptive?message:[...history].reverse().find(t=>t.role==='user'&&/\b(liquidity|sweep|strategy|scalp|trend|ema|rsi|breakout)\b/i.test(t.content))?.content)||message;
 const combined=seed+'\n'+message;
 const asset=parseMarket(message)||prior?.asset||parseMarket(seed)||(prefs.useDefaults?prefs.preferredAsset:undefined);
 const venue=parseVenue(message)||prior?.venue||parseVenue(seed)||(prefs.useDefaults?prefs.preferredVenue:undefined)||(asset==='GOLDUSDC'?'propdao':undefined);
 const name=parseRobotName(message)||prior?.name||parseRobotName(seed)||undefined;
 return {kind:'create',seed:seed.slice(0,1700),asset,venue,name};
}
export function createReady(task:ConversationTask&{kind:'create'}):boolean{return Boolean(task.asset&&task.venue)}
export function completeCreatePrompt(task:ConversationTask&{kind:'create'},prefs:TradingPreferences):string{
 const name=task.name||((task.asset||'Market')+' Liquidity Sweeper');
 return `Create a ${task.asset} trading strategy on ${task.venue} named "${name}". Use ${prefs.preferredTimeframe.toUpperCase()} execution. Original user requirements: ${task.seed}. Return complete, valid strategy.js with config and onCandle. Stage code for review, do not deploy automatically.`;
}
export function backtestPreset(days:7|30,now=new Date()):{from:string;to:string}{
 const to=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-1));
 const from=new Date(to.getTime()-(days-1)*86400000);
 return {from:from.toISOString().slice(0,10),to:to.toISOString().slice(0,10)};
}
export function saneTask(raw:unknown):ConversationTask|null{
 if(!raw||typeof raw!=='object')return null;
 const o=raw as Record<string,unknown>;
 if(o.kind==='backtest'&&typeof o.botId==='string'&&typeof o.botName==='string')
  return {kind:'backtest',botId:o.botId.slice(0,150),botName:o.botName.slice(0,80)};
 if(o.kind==='create'&&typeof o.seed==='string'&&o.seed.length<=1700)
  return {kind:'create',seed:o.seed,asset:typeof o.asset==='string'?o.asset:undefined,venue:venues.includes(o.venue as Venue)?o.venue as Venue:undefined,name:typeof o.name==='string'?o.name:undefined};
 if(o.kind==='choose-robot'&&['edit','backtest','deploy','status','stop'].includes(String(o.action))&&Array.isArray(o.robotIds))
  return {kind:'choose-robot',action:o.action as 'edit'|'backtest'|'deploy'|'status'|'stop',robotIds:o.robotIds.filter(x=>typeof x==='string').slice(0,8)};
 return null;
}
