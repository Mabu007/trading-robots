import {describe,it,expect,vi} from 'vitest';
import {researchRequested,topicForResearch,normaliseHeadlines,parseNewsRss,candleRegime,researchBrief} from './ai-research.ts';

const now=Date.parse('2026-11-04T13:00:00Z');
describe('read-only AI web research',()=>{
 it('identifies current regime and news questions without hijacking code edits',()=>{
  expect(researchRequested('what is gold sentiment, and the market regime right now?')).toBe(true);
  expect(researchRequested('do you have access to Google news or the internet?')).toBe(true);
  expect(researchRequested('what is the latest Fed decision?')).toBe(true);
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
  const result=await researchBrief({query:'What is the regime and sentiment of gold right now?',asset:'GOLDUSDC'},{request:fetched as typeof fetch,market,now:()=>now});
  expect(result).toMatchObject({hasNews:true,hasCandles:true});
  expect(result.context).toContain('https://example.org/gold');
  expect(result.context).toContain('Hyperliquid xyz:GOLD');
  expect(result.context).toContain('NOT spot XAUUSD');
  expect(market.hyperliquidCandles).toHaveBeenCalledWith(expect.objectContaining({asset:'xyz:GOLD',timeframe:'h1'}));
 });
 it('does not claim a live regime if public market data is unavailable',async()=>{
  const request=vi.fn(async()=>{throw Error('network offline')});
  const market={hyperliquidCandles:vi.fn(async()=>{throw Error('upstream down')})};
  const result=await researchBrief({query:'gold current sentiment',asset:'GOLDUSDC'},{request:request as typeof fetch,market,now:()=>now});
  expect(result.hasNews).toBe(false);expect(result.hasCandles).toBe(false);
  expect(result.context).toContain('No verifiable headlines');
  expect(result.context).toContain('do not assert a present technical trend');
 });
});