import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {BlockList,isIP} from 'node:net';
import {tool} from 'ai';
import {z} from 'zod';

const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(ip,bits);
blocked.addAddress('168.63.129.16');
export const isPublicResearchIp=(ip:string)=>isIP(ip)===4&&!blocked.check(ip);
const MAX_BYTES=768_000;
const MAX_TEXT=12_000;
const allowedTypes=/^(?:text\/(?:plain|html|csv|xml|tab-separated-values)|application\/(?:json|xml|[a-z0-9.+-]+\+(?:json|xml)))$/i;

function checkedUrl(value:string){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.port||url.username||url.password||isIP(url.hostname)||!url.hostname.includes('.')||/\.(?:local|internal|localhost|test|invalid)\.?$/i.test(url.hostname)||url.href.length>2000)throw Error('Use an ordinary public HTTPS address.');
 url.hash='';
 for(const key of url.searchParams.keys())if(/^(?:api[_-]?key|access[_-]?token|token|password|secret|signature|authorization|credential|sig|x-amz-.+)$/i.test(key))throw Error('Public research cannot forward credential-bearing links.');
 return url;
}

async function readPinned(url:URL,signal:AbortSignal){
 const records=await lookup(url.hostname,{all:true,family:4});
 if(!records.length||records.some(({address})=>!isPublicResearchIp(address)))throw Error('The address does not resolve exclusively to public IPv4.');
 signal.throwIfAborted();
 return new Promise<{status:number;location?:string;contentType:string;body:string;truncated:boolean}>((resolve,reject)=>{
  const req=request(url,{agent:false,family:4,signal,
   lookup:(_hostname,_options,callback)=>callback(null,records[0].address,4),
   headers:{Accept:'application/json, text/csv, text/html, text/plain, application/xml;q=0.8','Accept-Encoding':'identity','User-Agent':'TradingVibes-Research/1.0'}
  },response=>{
   const status=response.statusCode||0,location=response.headers.location;
   const contentType=(response.headers['content-type']||'').split(';')[0].trim();
   if(status<200||status>=300||!allowedTypes.test(contentType)){
    response.destroy();resolve({status,location,contentType,body:'',truncated:false});return;
   }
   const chunks:Buffer[]=[];let size=0;
   response.on('data',(chunk:Buffer)=>{
    if(size+chunk.length>MAX_BYTES){
     chunks.push(chunk.subarray(0,MAX_BYTES-size));
     resolve({status,contentType,body:Buffer.concat(chunks).toString('utf8'),truncated:true});response.destroy();return;
    }
    size+=chunk.length;chunks.push(chunk);
   });
   response.once('end',()=>resolve({status,contentType,body:Buffer.concat(chunks).toString('utf8'),truncated:false}));
   response.once('error',reject);
  });
  req.once('error',reject);req.end();
 });
}

export async function fetchPublicSource(input:string,parent?:AbortSignal){
 const timeout=AbortSignal.timeout(8500);
 const signal=parent?AbortSignal.any([parent,timeout]):timeout;
 let url=checkedUrl(input);
 for(let hops=0;hops<=3;hops++){
  const page=await readPinned(url,signal);
  if([301,302,303,307,308].includes(page.status)&&page.location){url=checkedUrl(new URL(page.location,url).href);continue;}
  const provenance={url:url.href,fetchedAt:new Date().toISOString(),httpStatus:page.status,contentType:page.contentType};
  if(page.status<200||page.status>=300)return {available:false,...provenance,reason:'The public publisher refused or could not serve this request.'};
  if(!allowedTypes.test(page.contentType))return {available:false,...provenance,reason:'This response format is unsupported. Find a public HTML, JSON, CSV or XML endpoint.'};
  const content=page.contentType==='text/html'?page.body
   .replace(/<!--[\s\S]*?-->/g,' ')
   .replace(/<(script|style|noscript|svg|nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
   .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim():page.body.trim();
  return {available:Boolean(content),...provenance,truncated:page.truncated||content.length>MAX_TEXT,content:content.slice(0,MAX_TEXT)};
 }
 throw Error('Too many public redirects.');
}

const sources=[
 {name:'IMF Data',topics:'world economic outlook fiscal monitor deficit debt gdp reserves cofer currency composition sovereign',url:'https://data.imf.org/',series:'https://data.imf.org/Datasets/COFER',access:'Use the IMF dataset and release vintage. COFER is aggregated, not country reserve disclosure.'},
 {name:'EconData',topics:'south africa sarb rand zar stats sa quarterly bulletin budget bonds rates fiscal',url:'https://econdata.co.za/user-guide/available-data/',access:'The public catalogue identifies series. Verify access for the underlying data; some services require a connection or entitlement.'},
 {name:'Trading Economics',topics:'economic calendar global macro government debt fiscal deficit financials forecasts',url:'https://tradingeconomics.com/api/financials.aspx',access:'Public documentation is accessible separately from the credentialed API. Do not infer entitlement or fabricate returned data.'},
 {name:'CFTC Commitments of Traders',topics:'cftc cot treasury gilt futures positioning leveraged dealers asset managers open interest speculative commercial',url:'https://publicreporting.cftc.gov/',series:'https://publicreporting.cftc.gov/resource/6dca-aqww.json?$limit=5&$order=report_date_as_yyyy_mm_dd%20DESC',access:'Use Traders in Financial Futures for financial-contract participant categories; the legacy example uses commercial/noncommercial categories. Check contract, as-of date and report type.'},
 {name:'OECD Public Finance',topics:'oecd government fiscal public spending taxation revenue debt gdp national accounts comparable',url:'https://www.oecd.org/en/topics/sub-issues/public-finance.html',series:'https://sdmx.oecd.org/public',access:'Use Data Explorer to construct a filtered SDMX query; confirm units and government perimeter.'},
];
export const publicFinanceRequested=(query:string)=>/https:\/\/|\b(imf|weo|cofer|econdata|sarb|cftc|cot report|oecd|trading economics|fiscal deficit|debt.to.gdp|public finance|foreign exchange reserves|positioning)\b/i.test(query);
export function publicFinanceTools(signal:AbortSignal){
 return {
  findPublicFinanceSources:tool({description:'Choose official public publishers for fiscal indicators, debt, reserves or futures positioning. This lists sources; fetch a source before citing observations.',inputSchema:z.object({topic:z.string().min(2).max(240)}),execute:async({topic})=>{
   const words=topic.toLowerCase().match(/[a-z]{3,}/g)||[];
   return sources.map(source=>({source,score:new Set(words.filter(word=>source.topics.includes(word))).size})).sort((a,b)=>b.score-a.score).slice(0,3).map(({source:{topics:_,...source}})=>source);
  }}),
  fetchPublicSource:tool({description:'Read public HTTPS HTML, JSON, CSV or XML without credentials. Use a link supplied by the user, an official source directory or a discovered search result. Cite the returned URL and observation date; fetchedAt is retrieval time. Never send account data or private inputs to a public URL.',inputSchema:z.object({url:z.url().max(2000)}),execute:async({url})=>{
   try{return await fetchPublicSource(url,signal)}catch(error){return {available:false,reason:error instanceof Error?error.message:'Public source unavailable.'}}
  }})
 };
}
