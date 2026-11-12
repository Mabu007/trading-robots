/** Spot Gold context is composed from fresh completed candles and on-demand macro context. */
export function usePrimaryGoldResearch(question:string,asset?:string|null){
 return !/\b(?:hyperliquid|propdao|xyz:gold)\b/i.test(question) && (/\b(?:gold|xauusd|goldusdc)\b/i.test(question)||['XAUUSD','GOLDUSDC'].includes((asset||'').toUpperCase()));
}
export async function primaryGoldResearch(read:()=>Promise<any>,readMacro?:()=>Promise<any>){
 const [market,macro]=await Promise.all([read().catch((error:unknown)=>({available:false,reason:error instanceof Error?error.message:'Gold market unavailable'})),readMacro?readMacro().catch(()=>null):Promise.resolve(null)]);
 const {source:_internalSource,provider:_internalProvider,...facts}=market&&typeof market==='object'?market:{available:false,reason:'Market snapshot unavailable'};
 if(typeof facts.reason==='string')facts.reason=facts.reason.replace(/\bbiquote\b/gi,'market feed');
 const news=macro?.news?.available?macro.news.items:null,calendar=macro?.calendar?.available?macro.calendar.items:null;
 const evidence={asOf:new Date().toISOString(),market:facts,
  ...(news?{newsHeadlines:news,newsAsOf:macro.news.asOf}:{}),
  ...(calendar?{macroEvents:calendar,calendarAsOf:macro.calendar.asOf}:{})};
 return {context:'Gold market intelligence. Explain price structure, momentum, volatility, important headlines and coming macro releases naturally. Distinguish observed movement from possible drivers; headlines alone cannot establish causality. Mention data gaps only when material and never append a standard disclaimer or vendor label. Give source links and UTC event/news times when helpful. Evidence: '+JSON.stringify(evidence),
  hasNews:!!news?.length,hasCandles:market?.available===true,hasQuote:false,hasVolume:false,hasTrades:false,snapshotOnly:true,chart:null,
  sources:news?.map((x:any)=>({url:x.url,title:x.title,publishedAt:x.publishedAt}))||[],quote:null,volume:null,trades:null};
}
