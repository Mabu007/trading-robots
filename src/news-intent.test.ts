import {describe,it,expect} from 'vitest';import {newsIntent} from './news-intent';
describe('news intent routing',()=>{
 it('routes a Gold headline request',()=>expect(newsIntent('Latest Gold headlines')).toEqual({topic:'gold',span:'24h'}));
 it('routes the requested timeframe',()=>expect(newsIntent('Show me crypto news from the past week')).toEqual({topic:'crypto',span:'7d'}));
 it('routes article coverage separately from headlines',()=>expect(newsIntent('Show me Gold news coverage trend')).toEqual({topic:'gold',span:'24h',coverage:true}));
 it('does not hijack a strategy backtest',()=>expect(newsIntent('Backtest my Gold news strategy')).toBeNull());
 it('does not hijack ordinary market requests',()=>expect(newsIntent('How is GOLDUSDC today?')).toBeNull());
});