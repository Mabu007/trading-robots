import {describe,it,expect} from 'vitest';
import {savedBacktestCard} from './saved-backtest-card';
const bot={id:'bot-123',name:'Gemini',asset:'GOLDUSDC',venue:'propdao' as const,prompt:'',lastBacktest:{from:'2026-01-01',to:'2026-01-02',candleCount:1,metrics:{}}};
describe('saved backtest chat results',()=>{
 it('uses the actual saved run rather than catalogue dates or invented metrics',()=>{
  const result=savedBacktestCard(bot,{from:'2026-10-26',to:'2026-10-31',asset:'GOLDUSDC',savedAt:'2026-11-01T00:00:00Z',result:{candles:[{},{}],trades:[{id:1,pnl:-1}],metrics:{netReturn:-1},source:'PropDAO history'}});
  expect(result).toMatchObject({name:'Gemini',from:'2026-10-26',to:'2026-10-31',candleCount:2,metrics:{netReturn:-1},source:'PropDAO history'});
  expect(savedBacktestCard(bot,{result:{candles:[],trades:[],metrics:{}}})?.from).toBe('Unknown');
 });
 it('does not manufacture a card from catalogue metadata or a partial result',()=>{
  expect(savedBacktestCard(bot,null)).toBeNull();
  expect(savedBacktestCard(bot,{result:{candles:[],metrics:{}}})).toBeNull();
 });
});
