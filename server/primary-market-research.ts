/** Default Gold research to BiQuote, preserving explicitly requested venues. */
export function usePrimaryGoldResearch(question:string,asset?:string|null){
 return !/\b(?:hyperliquid|propdao|xyz:gold)\b/i.test(question) && (/\b(?:gold|xauusd|goldusdc)\b/i.test(question)||['XAUUSD','GOLDUSDC'].includes((asset||'').toUpperCase()));
}
export async function primaryGoldResearch(read:()=>Promise<any>){
 const market=await read();
 // Keep the feed identity in the server-side market receipt, not in the LLM-facing prose.
 const {source:_internalSource,provider:_internalProvider,...facts}=market&&typeof market==='object'?market:{available:false,reason:'Market snapshot unavailable'};
 if(typeof facts.reason==='string')facts.reason=facts.reason.replace(/\bbiquote\b/gi,'market-data feed');
 return {context:'Gold XAUUSD completed-candle market facts (a market reference, not a broker-executable quote). Explain regime, volatility and useful levels naturally. Do not mention internal market-data suppliers or append a routine research note. Volume, liquidity, broker fills and robot filter passes are not verified by this snapshot; flag missing or stale evidence when it changes the conclusion. Facts: '+JSON.stringify(facts),hasNews:false,hasCandles:market?.available===true,hasQuote:false,hasVolume:false,hasTrades:false,snapshotOnly:true,chart:null,sources:[],quote:null,volume:null,trades:null};
}
