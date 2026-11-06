import type {Express,Request,Response} from 'express';
import {z} from 'zod';

const topicQueries={
 gold:'(gold OR bullion) (price OR market OR "central bank")',
 forex:'(forex OR "foreign exchange" OR currencies) (market OR dollar OR rates)',
 crypto:'(bitcoin OR ethereum OR cryptocurrency) (price OR market OR regulation)',
 equities:'("stock market" OR equities OR Nasdaq OR "S&P 500")',
 macro:'("Federal Reserve" OR inflation OR "interest rates" OR "central bank")',
 energy:'(oil OR crude OR OPEC) (prices OR supply OR markets)',
 global:'("financial markets" OR "global economy" OR "central banks")'
} as const;
export const newsTopicSchema=z.enum(['gold','forex','crypto','equities','macro','energy','global']);
export const newsSpanSchema=z.enum(['24h','3d','7d']);
export type NewsTopic=z.infer<typeof newsTopicSchema>;
export type NewsSpan=z.infer<typeof newsSpanSchema>;
export type NewsArticle={title:string;url:string;domain:string;language:string;sourceCountry:string;seenAt:string|null};
export type NewsSnapshot={provider:'GDELT DOC 2.0';kind:'headlines';topic:NewsTopic;span:NewsSpan;query:string;fetchedAt:string;articles:NewsArticle[];note:string};
export type NewsTrend={provider:'GDELT DOC 2.0';kind:'coverage-volume';topic:NewsTopic;span:NewsSpan;fetchedAt:string;points:{at:string;articles:number}[];note:string};

export class GdeltUnavailable extends Error {
 readonly code:'rate_limited'|'upstream_error'|'invalid_response'|'network_error';
 readonly retryAfter:number;
 constructor(code:'rate_limited'|'upstream_error'|'invalid_response'|'network_error',retryAfter=0){
  super(code==='rate_limited'?'GDELT is rate-limiting news requests. Please retry later.':'GDELT news could not be verified right now.');
  this.code=code;this.retryAfter=retryAfter;
 }
}
export function parseGdeltSeenDate(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const m=value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
 if(!m)return null;
 const iso=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
 const time=Date.parse(iso);
 return Number.isFinite(time)&&new Date(time).toISOString()===iso.replace('Z','.000Z')?new Date(time).toISOString():null;
}
export function normalizeGdeltArticles(input:unknown,limit=12):NewsArticle[]{
 if(!Array.isArray(input))throw new GdeltUnavailable('invalid_response');
 const out:NewsArticle[]=[],seen=new Set<string>();
 for(const row of input){
  if(!row||typeof row!=='object')continue;
  const title=typeof row.title==='string'?row.title.replace(/\s+/g,' ').trim().slice(0,260):'';
  let parsed:URL;
  try{parsed=new URL(String(row.url||''));}catch{continue;}
  if(!title||parsed.protocol!=='https:'&&parsed.protocol!=='http:'||parsed.username||parsed.password||!parsed.hostname.includes('.'))continue;
  if(parsed.hostname==='localhost'||/^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(parsed.hostname))continue;
  parsed.hash='';
  for(const key of [...parsed.searchParams.keys()])if(/^utm_|^fbclid$|^gclid$/i.test(key))parsed.searchParams.delete(key);
  const url=parsed.toString(),id=parsed.hostname+parsed.pathname;
  if(seen.has(id))continue;
  seen.add(id);
  const domain=typeof row.domain==='string'&&/^[a-z0-9.-]{1,150}$/i.test(row.domain)?row.domain:parsed.hostname;
  out.push({title,url,domain,language:typeof row.language==='string'?row.language.slice(0,48):'',sourceCountry:typeof row.sourcecountry==='string'?row.sourcecountry.slice(0,60):'',seenAt:parseGdeltSeenDate(row.seendate)});
  if(out.length>=limit)break;
 }
 return out;
}
const cacheTtl=5*60*1000;
export class GdeltNews {
 private cache=new Map<string,{value:NewsSnapshot|NewsTrend;expires:number}>();
 private running=new Map<string,Promise<NewsSnapshot|NewsTrend>>();
 private nextRequest=0;
 private blockedUntil=0;
 private readonly request:typeof fetch;private readonly now:()=>number;
 constructor(request:typeof fetch=fetch,now:()=>number=Date.now){this.request=request;this.now=now;}
 private async load(topic:NewsTopic,span:NewsSpan,kind:'headlines'|'coverage-volume'):Promise<NewsSnapshot|NewsTrend>{
  const key=`${kind}:${topic}:${span}`,now=this.now();
  const cached=this.cache.get(key);
  if(cached&&cached.expires>now)return cached.value;
  const ongoing=this.running.get(key);if(ongoing)return ongoing;
  if(now<this.blockedUntil||now<this.nextRequest)throw new GdeltUnavailable('rate_limited',Math.ceil((Math.max(this.nextRequest,this.blockedUntil)-now)/1000));
  this.nextRequest=now+6000; // respectful pacing for a public service
  const promise=(async()=>{
   const params=new URLSearchParams({query:topicQueries[topic],mode:kind==='headlines'?'artlist':'timelinevolraw',format:'json',timespan:span,...(kind==='headlines'?{sort:'datedesc',maxrecords:'24'}:{})});
   let resp:globalThis.Response;
   try{resp=await this.request('https://api.gdeltproject.org/api/v2/doc/doc?'+params.toString(),{headers:{Accept:'application/json','User-Agent':'TradingVibes/1.0'},signal:AbortSignal.timeout(12000)});}
   catch{throw new GdeltUnavailable('network_error');}
   if(resp.status===429){this.blockedUntil=this.now()+60000;throw new GdeltUnavailable('rate_limited',60);}
   if(!resp.ok)throw new GdeltUnavailable('upstream_error');
   const len=Number(resp.headers.get('content-length')||0);if(len>1_500_000)throw new GdeltUnavailable('invalid_response');
   let body:any;
   try{const raw=await resp.text();if(raw.length>1_500_000)throw Error('Too large');body=JSON.parse(raw);}catch{throw new GdeltUnavailable('invalid_response');}
   const fetchedAt=new Date(this.now()).toISOString();
   let value:NewsSnapshot|NewsTrend;
   if(kind==='headlines'){
    if(!body||!Array.isArray(body.articles))throw new GdeltUnavailable('invalid_response');
    value={provider:'GDELT DOC 2.0',kind,topic,span,query:topicQueries[topic],fetchedAt,articles:normalizeGdeltArticles(body.articles),note:'GDELT indexes external headlines; seenAt is the indexing time, not a verified publication time. Headlines are not market quotes or evidence of causation.'};
   }else{
    if(!body||!Array.isArray(body.timeline))throw new GdeltUnavailable('invalid_response');
    const series=body.timeline.find((item:any)=>item?.series==='Article Count')||body.timeline[0];
    if(!Array.isArray(series?.data))throw new GdeltUnavailable('invalid_response');
    const points=series.data.slice(-120).flatMap((p:any)=>{const rawDate=String(p?.date||'');const date=Date.parse(parseGdeltSeenDate(rawDate)||rawDate),volume=Number(p?.value);return Number.isFinite(date)&&Number.isFinite(volume)&&volume>=0?[{at:new Date(date).toISOString(),articles:volume}]:[];});
    value={provider:'GDELT DOC 2.0',kind,topic,span,fetchedAt,points,note:'News article-count coverage, not price volume, market volume, or a trading signal.'};
   }
   this.cache.set(key,{value,expires:this.now()+cacheTtl});
   if(this.cache.size>40)for(const [k,v] of this.cache)if(v.expires<=this.now())this.cache.delete(k);
   return value;
  })();
  this.running.set(key,promise);
  try{return await promise;}finally{this.running.delete(key);}
 }
 getSnapshot(topic:NewsTopic,span:NewsSpan='24h'):Promise<NewsSnapshot>{return this.load(topic,span,'headlines') as Promise<NewsSnapshot>;}
 getTrend(topic:NewsTopic,span:NewsSpan='24h'):Promise<NewsTrend>{return this.load(topic,span,'coverage-volume') as Promise<NewsTrend>;}
}
const quota=new Map<string,{since:number,count:number}>();
export function registerGdeltNews(app:Express,deps:{uid:(req:Request,res:Response)=>Promise<string|null>;news:GdeltNews}){
 async function handle(req:Request,res:Response,kind:'headlines'|'coverage-volume'){
  const uid=await deps.uid(req,res);if(!uid)return;
  res.setHeader('Cache-Control','private, no-store');
  const topic=newsTopicSchema.safeParse(req.query.topic||'gold'),span=newsSpanSchema.safeParse(req.query.span||'24h');
  if(!topic.success||!span.success)return res.status(400).json({error:'Use a supported topic and time window.'});
  const now=Date.now(),old=quota.get(uid),current=old&&now-old.since<60000?old:{since:now,count:0};
  if(++current.count>18)return res.status(429).json({error:'News request limit reached.'});
  quota.set(uid,current);
  if(quota.size>2000)for(const [key,value]of quota)if(now-value.since>=60000)quota.delete(key);
  try{
   const result=kind==='headlines'?await deps.news.getSnapshot(topic.data,span.data):await deps.news.getTrend(topic.data,span.data);
   return res.json(result);
  }catch(e){
   const error=e instanceof GdeltUnavailable?e:new GdeltUnavailable('upstream_error');
   if(error.retryAfter)res.setHeader('Retry-After',String(error.retryAfter));
   return res.status(error.code==='rate_limited'?429:503).json({error:error.message,provider:'GDELT DOC 2.0',code:error.code,retryAfter:error.retryAfter});
  }
 }
 app.get('/api/news/snapshot',(req,res)=>void handle(req,res,'headlines'));
 app.get('/api/news/trend',(req,res)=>void handle(req,res,'coverage-volume'));
}
