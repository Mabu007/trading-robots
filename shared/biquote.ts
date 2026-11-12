import {ALERT_TF,checkedBars,type AlertBar} from './market-alerts.ts';
export async function biquoteSnapshot(symbol:string,timeframe:keyof typeof ALERT_TF,request:typeof fetch=fetch,now=Date.now()){
 if(symbol!=='XAUUSD'||!Object.hasOwn(ALERT_TF,timeframe))throw Error('This release supports Gold/XAUUSD completed candles.');
 const interval=({m1:'1m',m5:'5m',m15:'15m',m30:'30m',h1:'1h',h4:'4h',d1:'1d'} as const)[timeframe];
 const read=async(url:string)=>{const r=await request(url,{signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw Error('BiQuote unavailable (HTTP '+r.status+'); monitoring will retry.');return r.json() as Promise<any>};
 const [quote,history]=await Promise.all([read('https://biquote.io/api/'+symbol),read(`https://biquote.io/api/${symbol}/ohlc?interval=${interval}&limit=300`)]);
 const timestamp=Date.parse(quote.timestamp),seconds=ALERT_TF[timeframe],end=Math.floor(now/1000/seconds)*seconds;
 if(quote.symbol!==symbol||quote.marketState!=='open'||quote.stale!==false||!Number.isFinite(timestamp)||now-timestamp>90000||timestamp>now+5000||!(quote.bid>0&&quote.ask>=quote.bid))throw Error('BiQuote market closed or quote stale; alerts suspended.');
 if(history.symbol!==symbol||history.interval!==interval||!Array.isArray(history.bars))throw Error('Invalid BiQuote candle response.');
 const bars:AlertBar[]=history.bars.filter((b:any)=>b.isOpen===false).map((b:any)=>({time:Date.parse(b.openTime)/1000,open:b.open,high:b.high,low:b.low,close:b.close,volume:0})).filter((b:AlertBar)=>b.time+seconds<=end).sort((a:AlertBar,b:AlertBar)=>a.time-b.time);
 checkedBars(bars,seconds);
 if(!bars.length||bars.at(-1)!.time+seconds!==end)throw Error('Latest completed BiQuote candle unavailable.');
 return {source:'BiQuote',symbol,timeframe,bars,quote:{bid:quote.bid,ask:quote.ask,mid:(quote.bid+quote.ask)/2,timestamp},checkedAt:now};
}
