import {z} from 'zod';
import {hyperliquidCoinSchema} from './hyperliquid-book.ts';

// The public REST recentTrades endpoint exposes a SMALL SAMPLE, not a complete tape.
// No user addresses, transaction hashes or raw trades are returned to the assistant.
const trade=z.object({
  coin:hyperliquidCoinSchema,side:z.enum(['A','B']),px:z.coerce.number().positive(),
  sz:z.coerce.number().positive(),time:z.number().int().positive()
}).passthrough();
export type TradeSummary=Awaited<ReturnType<typeof fetchSummary>>;
async function fetchSummary(coin:string,fetcher:typeof fetch,now:number){
  const symbol=hyperliquidCoinSchema.parse(coin);
  const response=await fetcher('https://api.hyperliquid.xyz/info',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'recentTrades',coin:symbol}),signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)throw Error('Hyperliquid recent trades unavailable');
  const data:unknown=await response.json();
  if(!Array.isArray(data)||data.length>100)throw Error('Unexpected recent trades response');
  const valid=data.map(value=>trade.safeParse(value));
  if(valid.some(x=>!x.success))throw Error('Invalid recent trade data');
  const rows=valid.map(x=>x.data!).filter(x=>x.coin===symbol&&x.time<=now+5000&&now-x.time<=90_000);
  const buySize=rows.filter(x=>x.side==='B').reduce((sum,x)=>sum+x.sz,0);
  const sellSize=rows.filter(x=>x.side==='A').reduce((sum,x)=>sum+x.sz,0);
  const tradedSize=buySize+sellSize;
  return {
    provider:'Hyperliquid',coin:symbol,source:'public recentTrades REST sample',
    retrievedAt:new Date(now).toISOString(),tradeCount:rows.length,
    sampleFirstAt:rows.length?new Date(Math.min(...rows.map(x=>x.time))).toISOString():null,
    sampleLastAt:rows.length?new Date(Math.max(...rows.map(x=>x.time))).toISOString():null,
    buyAggressorSize:buySize,sellAggressorSize:sellSize,
    totalSampleSize:tradedSize,
    sampleBuyFraction:tradedSize>0?buySize/tradedSize:null,
    sampleVwap:tradedSize>0?rows.reduce((sum,x)=>sum+x.px*x.sz,0)/tradedSize:null,
    limitations:'Recent REST sample only; NOT complete traded volume, continuous tape or a representative order-flow measure. B means buyer-initiated, A means seller-initiated on Hyperliquid only.'
  };
}
const cache=new Map<string,{until:number;value:TradeSummary}>();
export async function getHyperliquidTradeSummary(coin:string,fetcher:typeof fetch=fetch,now=Date.now()):Promise<TradeSummary>{
  if(fetcher!==fetch)return fetchSummary(coin,fetcher,now);
  const existing=cache.get(coin);
  if(existing&&existing.until>now)return existing.value;
  const value=await fetchSummary(coin,fetcher,now);
  cache.set(coin,{until:now+6000,value});
  if(cache.size>30)cache.delete(cache.keys().next().value!);
  return value;
}
