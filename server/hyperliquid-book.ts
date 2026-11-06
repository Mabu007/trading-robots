import {z} from 'zod';

// These are Hyperliquid identifiers, not broker symbols. No alias substitution.
export const hyperliquidCoinSchema=z.string().min(1).max(64).regex(/^[A-Za-z0-9@._:/-]+$/);
const positive=z.string().refine(v=>v.trim()!=='' && Number.isFinite(Number(v)) && Number(v)>0);
const level=z.object({px:positive,sz:positive,n:z.number().int().nonnegative()});
const bookSchema=z.object({coin:hyperliquidCoinSchema,time:z.number().int().positive(),levels:z.tuple([z.array(level).max(20),z.array(level).max(20)])});

export async function getHyperliquidBook(coin:string,fetcher:typeof fetch=fetch){
 const symbol=hyperliquidCoinSchema.parse(coin);
 const response=await fetcher('https://api.hyperliquid.xyz/info',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({type:'l2Book',coin:symbol}),signal:AbortSignal.timeout(8000)
 });
 if(!response.ok)throw new Error('Hyperliquid order book unavailable');
 const raw:unknown=await response.json();
 const parsed=bookSchema.safeParse(raw);
 if(!parsed.success || parsed.data.coin!==symbol)throw new Error('Invalid Hyperliquid order book response');
 const b=parsed.data;
 const bids=b.levels[0].map(x=>({price:Number(x.px),size:Number(x.sz),orders:x.n}));
 const asks=b.levels[1].map(x=>({price:Number(x.px),size:Number(x.sz),orders:x.n}));
 if(bids.some((x,i)=>i>0 && bids[i-1].price<=x.price) || asks.some((x,i)=>i>0 && asks[i-1].price>=x.price))
  throw new Error('Invalid Hyperliquid order book orderin¶»§q«^