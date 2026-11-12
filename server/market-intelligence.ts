/** On-demand macro context from the documented public news and calendar APIs.
 * Shared by VIBES' market research and typed chat tools. No schedulers or webhooks.
 */
export type IntelligenceFilter={
 symbol?:string;topic?:string;from?:string;to?:string;country?:string;
 countries?:string[];importance?:'low'|'medium'|'high';relevance?:'strict'|'balanced';
 limit?:number
};
const BASE='https://biquote.io';
const cached=new Map<string,{until:number;value:unknown}>();
const inflight=new Map<string,Promise<unknown>>();
const ttl={news:30_000,calendar:60_000};
const gold=/\b(?:gold|xauusd|goldusdc|bullion|precious metal|xau)\b/i;
const macro=/\b(?:federal reserve|fed|fomc|powell|usd|dollar|yield|treasury|interest rate|cpi|inflation|pce|jobs|nonfarm|nfp|geopolitic|central bank|tariff|recession)\b/i;
const credible=/\b(?:reuters|bloomberg|associated press|financial times|wall street journal|marketwatch|cnbc|investing.com|forexlive|kitco|fxstreet|central bank|bureau of labor statistics)\b/i;
const plain=(s:unknown,max=160)=>typeof s==='string'?s.slice(0,max).trim():'';
const date=(s:unknown)=>{const t=Date.parse(plain(s,80));return Number.isFinite(t)?new Date(t).toISOString():null};
const safeLink=(x:unknown)=>{try{const u=new URL(String(x));if(u.protocol!=='https:'||!u.hostname)return null;u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^fbclid$|^gclid$/i.test(key))u.searchParams.delete(key);return u.href}catch{return null}};
const terms=(s:string)=>s.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>2).slice(0,10);
const clamp=(n:unknown,defaultN=8,max=10)=>typeof n==='number'&&Number.isFinite(n)?Math.min(max,Math.max(1,Math.floor(n))):defaultN;
const range=(f:IntelligenceFilter,now:number,backMs:number,aheadMs:number)=>{
 const from=f.from?Date.parse(f.from):now-backMs,to=f.to?Date.parse(f.to):now+aheadMs;
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<from||to-from>1000*86400000)throw Error('Choose a valid UTC date range within 1000 days');
 return {from,to};
};
const memo=async<T>(key:string,kind:'news'|'calendar',work:()=>Promise<T>):Promise<T>=>{
 const now=Date.now(),hit=cached.get(key);
 if(hit&&hit.until>now)return hit.value as T;
 if(inflight.has(key))return inflight.get(key)! as Promise<T>;
 const pending=(async()=>{const result=await work();cached.set(key,{until:Date.now()+ttl[kind],value:result});if(cached.size>120)for(const [k,v] of cached)if(v.until<Date.now()||cached.size>120)cached.delete(k);return result})().finally(()=>inflight.delete(key));
 inflight.set(key,pending);return pending;
};
async function jsonArray(url:URL,request:typeof fetch){
 const response=await request(url.toString(),{signal:AbortSignal.timeout(9000),redirect:'error',headers:{Accept:'application/json'}});
 if(!response.ok)throw Error('Market intelligence temporarily unavailable (HTTP '+response.status+')');
 const raw=await response.json();
 if(!Array.isArray(raw))throw Error('Invalid market intelligence response');
 return raw.slice(0,500) as Record<string,unknown>[];
}
export async function getMarketNews(input:IntelligenceFilter={},request:typeof fetch=fetch,now=Date.now()){
 try{
  const {from,to}=range(input,now,30*86400000,0),limit=clamp(input.limit),symbol=plain(input.symbol,24).toUpperCase(),topic=plain(input.topic),country=plain(input.country,2).toUpperCase(),isGold=gold.test(symbol+' '+topic);
  const url=new URL('/api/news/market',BASE);
  if(symbol)url.searchParams.set('symbol',symbol);
  url.searchParams.set('maxResults','50');url.searchParams.set('language','en');
  if(country)url.searchParams.set('country',country);
  const rows=await memo('news:'+url.searchParams.toString(),'news',()=>jsonArray(url,request));
  const query=terms(topic),unique=new Set<string>();
  const items=rows.flatMap(row=>{
   const title=plain(row.title,260),description=plain(row.description,600),publisher=plain(row.publisher,100),link=safeLink(row.url),publishedAt=date(row.publishedDate);
   if(!title||!link||!publishedAt)return [];
   const time=Date.parse(publishedAt);if(time<from||time>to+60000)return [];
   if(country&&plain(row.country,2).toUpperCase()!==country)return [];
   const normalized=title.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,110),dedupe=normalized||link;
   if(unique.has(dedupe))return [];unique.add(dedupe);
   const body=title+' '+description,keywordMatches=query.filter(t=>body.toLowerCase().includes(t)).length;
   const goldMatch=gold.test(body),macroMatch=macro.test(body),brand=credible.test(publisher),freshHours=Math.max(0,(now-time)/3600000);
   let score=(keywordMatches*5)+(goldMatch?8:0)+(macroMatch?3:0)+(brand?4:0)+Math.max(0,5-Math.log2(1+freshHours));
   if(isGold&&!goldMatch&&!macroMatch)score-=16;
   if(query.length&&!keywordMatches&&!goldMatch&&!macroMatch)score-=10;
   if(input.importance==='high'&&!brand&&!goldMatch&&!keywordMatches)return [];
   if(input.relevance==='strict'&&(score<9||isGold&&!goldMatch&&!macroMatch))return [];
   return [{title,description,publisher,url:link,publishedAt,score,category:plain(row.category,50)||null}];
  }).sort((a,b)=>b.score-a.score||Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,limit)
  .map(({score,...item})=>item);
  const newest=items.reduce<string|null>((acc,x)=>!acc||x.publishedAt>acc?x.publishedAt:acc,null);
  return {available:true,asOf:new Date(now).toISOString(),newestArticleAt:newest,items,totalReturned:items.length,filters:{symbol,topic,from:new Date(from).toISOString(),to:new Date(to).toISOString()}};
 }catch(e){return {available:false,asOf:new Date(now).toISOString(),items:[],reason:e instanceof Error?e.message:'Market news unavailable'}}
}
const relevanceCountries=(input:IntelligenceFilter)=>{
 const supplied=input.countries?.length?input.countries.join(','):input.country;
 if(supplied)return supplied.toUpperCase().split(',').map(c=>c.trim()).filter(c=>/^[A-Z]{2}$/.test(c)).slice(0,15);
 return gold.test((input.symbol||'')+' '+(input.topic||''))?['US','EU','GB','CN']:[];
};
export async function getEconomicCalendar(input:IntelligenceFilter={},request:typeof fetch=fetch,now=Date.now()){
 try{
  const {from,to}=range(input,now,12*3600000,7*86400000),limit=clamp(input.limit),countries=relevanceCountries(input);
  const url=new URL('/api/calendar',BASE);url.searchParams.set('from',new Date(from).toISOString());url.searchParams.set('to',new Date(to).toISOString());
  url.searchParams.set('limit','500');
  if(countries.length)url.searchParams.set('countries',countries.join(','));
  if(input.importance)url.searchParams.set('importance',input.importance);
  const rows=await memo('calendar:'+url.searchParams.toString(),'calendar',()=>jsonArray(url,request));
  const query=terms(plain(input.topic)),isGold=gold.test((input.symbol||'')+' '+(input.topic||'')),unique=new Set<string>();
  const weight={low:1,medium:3,high:6};
  const items=rows.flatMap(row=>{
   const name=plain(row.name,240),time=date(row.time),importance=plain(row.importance,15).toLowerCase() as keyof typeof weight,countryCode=plain(row.countryCode,2).toUpperCase(),currency=plain(row.currency,4),id=plain(row.id,100);
   if(!name||!time||!(importance in weight))return [];
   const ms=Date.parse(time);if(ms<from||ms>to)return [];
   if(countries.length&&!countries.includes(countryCode))return [];
   if(input.importance&&weight[importance]<weight[input.importance])return [];
   const key=id||countryCode+':'+name+':'+time;if(unique.has(key))return [];unique.add(key);
   const matched=query.filter(t=>name.toLowerCase().includes(t)).length;
   const likelyGold=/\b(cpi|pce|inflation|rate|fomc|fed|jobs|nonfarm|payroll|unemployment|gdp|pmi|retail sales|powell|treasury|interest|central bank)\b/i.test(name);
   const relevant=!isGold||countryCode==='US'||countryCode==='EU'||countryCode==='CN'||currency==='USD';
   const score=weight[importance]*3+matched*6+(isGold&&likelyGold?8:0)+(relevant?3:0)+Math.max(0,3-Math.abs(ms-now)/86400000);
   if(input.relevance==='strict'&&isGold&&!likelyGold&&!matched)return [];
   const numberOrNull=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
   return [{id,name,time,importance,countryCode,currency,type:plain(row.type,20),timeMode:plain(row.timeMode,24),
    actual:numberOrNull(row.actual),forecast:numberOrNull(row.forecast),previous:numberOrNull(row.previous),
    unit:plain(row.unit,30),sourceUrl:safeLink(row.sourceUrl),score}];
  }).sort((a,b)=>b.score-a.score||Math.abs(Date.parse(a.time)-now)-Math.abs(Date.parse(b.time)-now)).slice(0,limit)
   .map(({score,...item})=>item);
  return {available:true,asOf:new Date(now).toISOString(),items,totalReturned:items.length,filters:{countries,from:new Date(from).toISOString(),to:new Date(to).toISOString(),importance:input.importance||'all'}};
 }catch(e){return {available:false,asOf:new Date(now).toISOString(),items:[],reason:e instanceof Error?e.message:'Economic calendar unavailable'}}
}
export async function goldMacroSnapshot(request:typeof fetch=fetch,now=Date.now()){
 const [news,calendar]=await Promise.all([getMarketNews({symbol:'XAUUSD',topic:'gold',limit:7,relevance:'balanced'},request,now),
  getEconomicCalendar({symbol:'XAUUSD',importance:'medium',limit:7},request,now)]);
 return {news,calendar};
}
