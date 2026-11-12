/** Default Gold research to BiQuote, preserving explicitly requested venues. */
export function usePrimaryGoldResearch(question:string,asset?:string|null){
 return !/\b(?:hyperliquid|propdao|xyz:gold)\b/i.test(question) && (/\b(?:gold|xauusd|goldusdc)\b/i.test(question)||['XAUUSD','GOLDUSDC'].includes((asset||'').toUpperCase()));
}
export async function primaryGoldResearch(read:()=>Promise<any>){
 const market=await read();
 return {context:'Primary live source: BiQuote XAUUSD. Use only these verified completed-candle facts; do not invent order book, volume, trade flow or a current quote. '+JSON.stringify(market),hasNews:false,hasCandles:market.available===true,hasQuote:false,hasVolume:false,hasTrades:false,snapshotOnly:true,chart:null,sources:[],quote:null,volume:null,trades:null};
}
