import {it,expect} from 'vitest';
import {vibesPersona,vibesResearchStyle} from '../shared/vibes-persona';
import {usePrimaryGoldResearch,primaryGoldResearch} from './primary-market-research';
it('uses BiQuote for ordinary Gold requests while honoring explicit venue requests',()=>{expect(usePrimaryGoldResearch('How is gold doing?')).toBe(true);expect(usePrimaryGoldResearch('How is Hyperliquid gold doing?')).toBe(false);expect(usePrimaryGoldResearch('How is BTC doing?')).toBe(false)});
it('reports an unavailable BiQuote feed without fabricating another source',async()=>{const result=await primaryGoldResearch(async()=>({available:false,source:'BiQuote',reason:'stale'}));expect(result.hasCandles).toBe(false);expect(result.context).toContain('stale');expect(result.context).not.toContain('Hyperliquid');expect(result.context).not.toContain('BiQuote')});

it('gives VIBES a natural research voice without exposing backend feed names',()=>{
 expect(vibesPersona).not.toContain('BiQuote');
 expect(vibesPersona).not.toContain('Put routine source/provenance');
 expect(vibesPersona).toContain('Do not append a routine');
 expect(vibesResearchStyle).toContain('exact market/instrument');
});
it('keeps market levels and data-quality warnings while hiding the vendor from chat context',async()=>{
 const result=await primaryGoldResearch(async()=>({available:true,source:'BiQuote',symbol:'XAUUSD',timeframe:'m1',lastCompletedCandle:{close:3953.961},rsi14:61.8,atr14:1.06,volume:0}));
 expect(result.hasCandles).toBe(true);
 expect(result.context).toContain('3953.961');
 expect(result.context).toContain('61.8');
 expect(result.context).not.toMatch(/BiQuote|Primary live source:/i);
 expect(result.context).not.toContain('broker-executable quote');
 expect(result.context).toContain('Gold market intelligence');
});
