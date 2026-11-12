import {describe,it,expect,vi} from 'vitest';
import {getMarketNews,getEconomicCalendar,goldMacroSnapshot} from './market-intelligence.ts';
import {marketIntelligenceTools} from './market-intelligence-tools.ts';
const now=Date.parse('2026-11-12T12:00:00Z');
const mk=(news:any[],calendar:any[])=>vi.fn(async(url:string)=>{
 const pathname=new URL(String(url)).pathname;
 return Response.json(pathname.includes('/api/calendar')?calendar:news);
});
describe('fresh on-demand news and calendar intelligence',()=>{
 it('ranks and deduplicates Gold articles, honors UTC window, returns credible links and preserves dates',async()=>{
  const make=(title:string,url:string,publishedDate:string,publisher='Reuters')=>({title,url,publishedDate,publisher,description:'Gold and dollar market updates',country:'US'});
  const fetcher=mk([
   make('Gold rises as dollar retreats','https://news.example/gold?utm_source=site','2026-11-12T11:45:00Z'),
   make('Gold rises as dollar retreats','https://news.example/duplicate','2026-11-12T11:30:00Z'),
   make('Dollar and Fed news','https://news.example/usd','2026-11-12T10:00:00Z','Bloomberg'),
   make('Old gold report','https://news.example/old','2026-09-01T10:00:00Z')
  ],[]);
  const result=await getMarketNews({symbol:'GOLDUSDC',topic:'gold',from:'2026-11-11',to:'2026-11-13',limit:8},fetcher as any,now);
  expect(result.available).toBe(true);
  if(!result.available)throw Error('unavailable');
  expect(result.items).toHaveLength(2);
  expect(result.items[0].title).toContain('Gold rises');
  expect(result.items[0].url).not.toContain('utm_');
  expect(result.items[0].publishedAt).toContain('2026-11-12');
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('keeps unpublished releases null, applies country/high-importance filters and exact dates',async()=>{
  const rows=[
   {id:'nfp',name:'Nonfarm Payrolls',countryCode:'US',currency:'USD',time:'2026-11-13T13:30:00Z',importance:'high',actual:null,forecast:170000,previous:150000,sourceUrl:'https://bls.gov/'},
   {id:'minor',name:'Treasury Bill Auction',countryCode:'US',currency:'USD',time:'2026-11-13T13:30:00Z',importance:'low'},
   {id:'euro',name:'EU CPI',countryCode:'EU',currency:'EUR',time:'2026-11-13T13:30:00Z',importance:'high'}
  ];
  const fetcher=mk([],rows);
  const result=await getEconomicCalendar({country:'US',importance:'high',from:'2026-11-12',to:'2026-11-14',limit:8},fetcher as any,now);
  expect(result.available).toBe(true);
  if(!result.available)throw Error('unavailable');
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({id:'nfp',actual:null,forecast:170000,countryCode:'US'});
  const url=String(fetcher.mock.calls[0][0]);
  expect(url).toContain('/api/calendar?');
  expect(url).toContain('importance=high');
  expect(url).toContain('countries=US');
 });
 it('fails gracefully with no invented articles on a provider error',async()=>{
  const fetcher=vi.fn(async()=>Response.json({error:'unavailable'},{status:503}));
  const result=await getMarketNews({topic:'unique-error-test'},fetcher as any,now);
  expect(result.available).toBe(false);
  expect(result.items).toEqual([]);
 });
 it('exposes exactly the required named tools',()=>{
  const tools=marketIntelligenceTools();
  expect(Object.keys(tools).sort()).toEqual(['getEconomicCalendar','getMarketNews']);
 });
 it('combines independent news and calendar failures without blocking other signals',async()=>{
  const fetcher=vi.fn(async(url:string)=>new Response('down',{status:503}));
  const snapshot=await goldMacroSnapshot(fetcher as any,now);
  expect(snapshot.news.available).toBe(false);
  expect(snapshot.calendar.available).toBe(false);
 });
});
