import {describe,it,expect,vi} from 'vitest';
import {GdeltNews,GdeltUnavailable,normalizeGdeltArticles,parseGdeltSeenDate} from './gdelt-news';

describe('GDELT adapter',()=>{
 it('parses UTC indexing times, never fabricates invalid dates',()=>{
  expect(parseGdeltSeenDate('20261106T090000Z')).toBe('2026-11-06T09:00:00.000Z');
  expect(parseGdeltSeenDate('20261306T090000Z')).toBeNull();
  expect(parseGdeltSeenDate('20261106')).toBeNull();
 });
 it('normalizes safely and removes duplicate publisher URLs',()=>{
  const data=normalizeGdeltArticles([
   {title:'  Gold  rises ',url:'https://news.example.com/a?utm_source=spam',domain:'news.example.com',seendate:'20261106T090000Z'},
   {title:'Gold rises duplicate',url:'https://news.example.com/a?utm_source=news'},
   {title:'blocked',url:'javascript:alert(1)'},
   {title:'private',url:'http://127.0.0.1/test'}
  ]);
  expect(data).toHaveLength(1);
  expect(data[0].title).toBe('Gold rises');
  expect(data[0].url).toBe('https://news.example.com/a');
 });
 it('fetches once and caches with timestamp and source without inventing a price',async()=>{
  let now=Date.parse('2026-11-06T13:00:00Z');
  const request=vi.fn(async(_url:string)=>new Response(JSON.stringify({articles:[{title:'Actual indexed article',url:'https://example.org/gold',seendate:'20261106T130000Z'}]}),{status:200,headers:{'content-type':'application/json'}}));
  const news=new GdeltNews(request as typeof fetch,()=>now);
  const first=await news.getSnapshot('gold');
  const second=await news.getSnapshot('gold');
  expect(first).toEqual(second);
  expect(first.articles).toHaveLength(1);
  expect(first.articles[0].title).toBe('Actual indexed article');
  expect(first.provider).toBe('GDELT DOC 2.0');
  expect(first.kind).toBe('headlines');
  expect(request).toHaveBeenCalledTimes(1);
  const u=new URL(String(request.mock.lastCall?.[0]||''));
  expect(u.hostname).toBe('api.gdeltproject.org');
  expect(u.searchParams.get('mode')).toBe('artlist');
  expect(u.searchParams.get('timespan')).toBe('24h');
 });
 it('refuses HTML upstream errors instead of displaying fake headlines',async()=>{
  const news=new GdeltNews((async()=>new Response('<html>Rate limited</html>',{status:200})) as typeof fetch);
  await expect(news.getSnapshot('macro')).rejects.toMatchObject({code:'invalid_response'});
 });
 it('honors GDELT rate limit with bounded backoff',async()=>{
  const news=new GdeltNews((async()=>new Response('slow down',{status:429})) as typeof fetch);
  await expect(news.getSnapshot('gold')).rejects.toMatchObject({code:'rate_limited'});
  await expect(news.getSnapshot('gold')).rejects.toBeInstanceOf(GdeltUnavailable);
 });
 it('normalizes article volume timelines without claiming price volume',async()=>{
  const news=new GdeltNews((async()=>new Response(JSON.stringify({timeline:[{series:'Article Count',data:[{date:'20261106T120000Z',value:5}]}]}),{status:200})) as typeof fetch);
  const trend=await news.getTrend('energy','3d');
  expect(trend.kind).toBe('coverage-volume');
  expect(trend.points[0].articles).toBe(5);
  expect(trend.note).toContain('not price volume');
 });
});
