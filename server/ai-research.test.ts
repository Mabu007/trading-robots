import {describe,it,expect,vi} from 'vitest';
import {researchRequested,topicForResearch,normaliseHeadlines,parseNewsRss,candleRegime,researchBrief} from './ai-research.ts';

const now=Date.parse('2026-11-04T13:00:00Z');
describe('read-only AI web research',()=>{
 it('identifies current regime and news questions without hijacking code edits',()=>{
  expect(researchRequested('what is gold sentiment, and the market regime right now?')).toBe(true);
  expect(researchRequested('do you have access to Google news or the internet?')).toBe(true);
  expect(researchRequested('what is the latest Fed decision?')).toBe(true);
  expect(researchRequested('why did gold fall after inflation data?')).toBe(true);
  expect(researchRequested('how is DXY affecting gold?')).toBe(true);
  expect(researchRequested('rewrite the strategy.js breakout detection logic')).toBe(false);
 });
 it('does not send strategy code, API keys, URLs or personal emails in a public news query',()=>{
  const topic=topicForResearch('search latest news https://secret.example/sk-or-v1-AAA me@test.com');
  expect(topic.newsQuery).not.toContain('https');
  expect(topic.newsQuery).not.toContain('me@test');
  expect(topic.newsQuery).not.toContain('sk-or');
  expect(topicForResearch('gold market regime','GOLDUSDC').coin).toBe('xyz:GOLD');
 });
 it('rejects malicious links, future news, duplicates, and old articles',()=>{
  const valid={title:'Gold edges higher on Fed comments',url:'https://example.com/gold',domain:'example.com',seendate:'20261104T120000Z'};
  const entries=[valid,valid,{...valid,title:'Fake javascript link',url:'javascript:alert(1)'},{...valid,title:'Future gold article',seendate:'20270104T120000Z'},{...valid,title:'Ancient gold article',seendate:'20260104T120000Z'}];
  expect(normaliseHeadlines(entries,now)).toMatchObject([{title:valid.title,url:valid.url}]);
 });
 it('parses provider RSS fallback as a dated clickable citation',()=>{
  const rss='<rss><channel><item><title><![CDATA[Gold price rises &amp; Fed outlook]]></title><link>https://news.google.com/rss/articles/abc</link><pubDate>Wed, 04 Nov 2026 12:00:00 GMT</pubDate><source>Example News</source></item></channel></rss>';
  expect(parseNewsRss(rss,now)).toMatchObject([{source:'Example News',title:'Gold price rises & Fed outlook'}]);
 });
 it('recognizes a verified recent H1 directional trend and rejects stale candles',()=>{
  const end=Math.floor(now/3600000)*3600000;
  const bars=Array.from({length:96},(_,i)=>{const n=100+i*.25;return {time:(end-96*3600000+i*3600000)/1000,open:n,close:n+.1,high:n+.4,low:n-.2}});
  expect(candleRegime(bars,now)).toContain('uptrend');
  expect(candleRegime(bars,now+12*3600000)).toBeNull();
  expect(candleRegime(bars.slice(0,30),now)).toBeNull();
 });
 it('delivers verifiable sources and gold-reference regime without an OpenRouter web tool',async()=>{
  const fetched=vi.fn(async(url:string)=>{
   expect(url).toContain('api.gdeltproject.org');
   return Response.json({articles:[{title:'Gold price volatility amid Fed debate',url:'https://example.org/gold',domain:'example.org',seendate:'20261104T113000Z'}]});
  });
  const end=Math.floor(now/3600000)*3600000;
  const market={hyperliquidCandles:vi.fn(async()=>({candles:Array.from({length:96},(_,i)=>{const n=110+i*.15;return {time:(end-96*3600000+i*3600000)/1000,open:n,high:n+.3,low:n-.1,close:n+.2}})}))};
  const result=await researchBrief({query:'What is the regime and sentiment of PropDAO GOLDUSDC right now?',asset:'GOLDUSDC'},{request:fetched as typeof fetch,market,now:()=>now});
  expect(result).toMatchObject({hasNews:true,hasCandles:true});
  expect(result.context).toContain('https://example.org/gold');
  expect(result.context).toContain('Hyperliquid xyz:GOLD');
  expect(result.context).toContain('does not establish a spot or broker fill');
  expect(market.hyperliquidCandles).toHaveBeenCalledWith(expect.objectContaining({asset:'xyz:GOLD',timeframe:'h1'}));
 });
 it('uses a fresh public Hyperliquid book and completed H4 candles for a quick check',async()=>{
  const period=4*3600000,end=Math.floor(now/period)*period;
  const candles=Array.from({length:96},(_,i)=>({time:(end-(96-i)*period)/1000,open:100+i,close:101+i,high:102+i,low:99+i}));
  const request=vi.fn();
  const book=vi.fn(async()=>({bestBid:195,bestAsk:197,asOf:new Date(now-5000).toISOString()}));
  const result=await researchBrief({query:'How is BTC doing on the 4H chart?'},{request,market:{hyperliquidCandles:async()=>({candles})},book:book as any,now:()=>now});
  expect(request).not.toHaveBeenCalled();
  expect(result).toMatchObject({hasQuote:true,hasCandles:true,snapshotOnly:true,quote:{mid:196},chart:{coin:'BTC',timeframe:'h4',trend:'uptrend'}});
  expect(result.chart?.candles).toHaveLength(72);
  expect(result.sources[0].url).toBe('https://app.hyperliquid.xyz/trade/BTC');
  const stale=await researchBrief({query:'How is BTC doing?'},{book:book as any,now:()=>now+120000});
  expect(stale.hasQuote).toBe(false);
 });
 it('includes actual venue L2 spread, traded M1 volume and limited recent-trade sample for gold scalping',async()=>{
  const end=Math.floor(now/60000)*60000;
  const m1=Array.from({length:30},(_,i)=>({time:(end-(30-i)*60000)/1000,open:4100,high:4101,low:4099,close:4100,volume:i<15?2:3}));
  const h1=Array.from({length:96},(_,i)=>({time:(end-(96-i)*3600000)/1000,open:4090,high:4100,low:4080,close:4095}));
  const market={hyperliquidCandles:vi.fn(async({timeframe}:{timeframe:string})=>({candles:timeframe==='m1'?m1:h1}))};
  const book=vi.fn(async()=>({bestBid:4113.9,bestAsk:4114,spread:0.1,bidSize:391,askSize:723,imbalance:-0.298,asOf:new Date(now-2500).toISOString()}));
  const trades=vi.fn(async()=>({tradeCount:4,buyAggressorSize:2,sellAggressorSize:3,totalSampleSize:5,sampleVwap:4114,sampleLastAt:new Date(now-2000).toISOString(),retrievedAt:new Date(now).toISOString()}));
  const result=await researchBrief({query:'How is Gold doing today and any scalping opportunities?'},{market,book:book as any,trades:trades as any,now:()=>now});
  expect(result).toMatchObject({hasQuote:true,hasVolume:true,hasTrades:true,quote:{spread:0.1},volume:{baseVolume15m:45,previousBaseVolume15m:30,volumeRatio:1.5},trades:{tradeCount:4}});
  expect(result.context).toContain('spread 0.1 price points');
  expect(result.context).toContain('base units');
  expect(result.context).toContain('buyer-initiated size 2');
  expect(result.context).toContain('LIMITED sample');
  expect(market.hyperliquidCandles).toHaveBeenCalledWith(expect.objectContaining({timeframe:'m1'}));
 });
 it('does not infer recent traded volume when M1 coverage is stale or incomplete',async()=>{
  const market={hyperliquidCandles:vi.fn(async()=>({candles:[{time:100,open:1,high:1,low:1,close:1,volume:99}]}))};
  const result=await researchBrief({query:'Gold scalping today?'},{market,now:()=>now});
  expect(result.hasVolume).toBe(false);
  expect(result.context).toContain('volume');
 });
 it('does not claim a live regime if public market data is unavailable',async()=>{
  const request=vi.fn(async()=>{throw Error('network offline')});
  const market={hyperliquidCandles:vi.fn(async()=>{throw Error('upstream down')})};
  const result=await researchBrief({query:'gold current sentiment',asset:'GOLDUSDC'},{request:request as typeof fetch,market,now:()=>now+3*60_000});
  expect(result.hasNews).toBe(false);expect(result.hasCandles).toBe(false);
  expect(result.context).toContain('No verifiable headlines');
  expect(result.context).toContain('do not assert a present technical trend');
 });
});