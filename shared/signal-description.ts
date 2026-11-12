import {ALERT_TF,validateAlertRule,type AlertRule,type Condition} from './market-alerts.ts';
export type SignalKind='above'|'below'|'touch'|'rsi_above'|'rsi_below'|'sweep_high'|'sweep_low'|'break_high'|'break_low';
export function readSignalDescription(text:string):{kind:SignalKind;value:number|null;timeframe:keyof typeof ALERT_TF;lookback:number}|null{
 const t=text.toLowerCase();
 if(!/\b(?:gold|xauusd|price|rsi|sweep|break|high|low)\b/.test(t))return null;
 const tf=(t.match(/\b(m1|m5|m15|m30|h1|h4|d1)\b/i)?.[1]?.toLowerCase()||'m5') as keyof typeof ALERT_TF;
 const lookback=Math.min(200,Math.max(2,Number(t.match(/(?:previous|last)\s+(\d{1,3})\s+(?:candles?|bars?)/)?.[1]||5)));
 if(/\bsweep(?:s|ing)?\b/.test(t))return {kind:/\b(?:low|lows|sellside|sell-side)\b/.test(t)?'sweep_low':'sweep_high',value:null,timeframe:tf,lookback};
 if(/\bbreak(?:s|out)?\b/.test(t)&&/\b(?:high|low|range)\b/.test(t))return {kind:/\b(?:low|lows|below)\b/.test(t)?'break_low':'break_high',value:null,timeframe:tf,lookback};
 const numeric=t.match(/\b(?:above|over|below|under|touch|touches|reaches|cross(?:es)?|at)\s+(?:price\s+)?(\d+(?:[.,]\d+)?)/);
 const rsi=/\brsi\b/.test(t),rsiNumber=t.match(/\brsi\s*(?:14)?\s*(?:above|below|over|under|cross(?:es)?|at|[<>])\s*(\d+(?:\.\d+)?)/);
 const value=Number((rsiNumber?.[1]||numeric?.[1]||'').replace(',','.'));
 if(!Number.isFinite(value)||value<=0)return null;
 const below=/\b(?:below|under|drops?|falls?|down)\b/.test(t);
 return {kind:rsi?(below?'rsi_below':'rsi_above'):/\btouch(?:es)?\b/.test(t)?'touch':below?'below':'above',value,timeframe:tf,lookback};
}
export function signalRuleFromText(text:string,now=Date.now()):AlertRule{
 if(typeof text!=='string'||text.trim().length<5||text.length>1200)throw Error('Describe your Gold condition in under 1,200 characters.');
 if(!/\b(?:gold|xauusd)\b/i.test(text))throw Error('Specify Gold/XAUUSD. Other markets are not yet supported for signal monitoring.');
 const parsed=readSignalDescription(text);
 if(!parsed)throw Error('I need a precise price level, RSI threshold, breakout or liquidity sweep. Open Signals to set the condition.');
 const {kind,value,timeframe,lookback}=parsed;
 const isPrice=['above','below','touch'].includes(kind),rsi=kind.startsWith('rsi'),range=kind.includes('sweep')||kind.includes('break');
 const condition:Condition={id:'c1',kind,...(isPrice||rsi?{value:value!}:{}),...(rsi?{period:14}:{}),...(range?{lookback}:{})};
 const label=kind.replaceAll('_',' '),name=('Gold '+label+(value!==null?' '+value:'')+' · '+timeframe.toUpperCase()).slice(0,80);
 const rule:AlertRule={name,symbol:'XAUUSD',timeframe,mode:'all',conditions:[condition],notifyStages:false,cooldownSeconds:300,sequenceSeconds:3600,expiresAt:Math.floor(now/1000)+7*86400,repeat:true,session:null,basis:kind==='touch'?'live-price':'completed-candle',strategy:null};
 validateAlertRule(rule);return rule;
}
