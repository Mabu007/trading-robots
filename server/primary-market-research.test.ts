import {it,expect} from 'vitest';
import {usePrimaryGoldResearch,primaryGoldResearch} from './primary-market-research';
it('uses BiQuote for ordinary Gold requests while honoring explicit venue requests',()=>{expect(usePrimaryGoldResearch('How is gold doing?')).toBe(true);expect(usePrimaryGoldResearch('How is Hyperliquid gold doing?')).toBe(false);expect(usePrimaryGoldResearch('How is BTC doing?')).toBe(false)});
it('reports an unavailable BiQuote feed without fabricating another source',async()=>{const result=await primaryGoldResearch(async()=>({available:false,source:'BiQuote',reason:'stale'}));expect(result.hasCandles).toBe(false);expect(result.context).toContain('stale');expect(result.context).not.toContain('Hyperliquid')});
