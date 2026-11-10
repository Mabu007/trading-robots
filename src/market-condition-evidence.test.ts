import {it,expect} from 'vitest';
import {completedMarketEvidence} from './market-condition-evidence';
const bars=Array.from({length:75},(_,i)=>({time:(i+1)*60,open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100+i*.1}));
it('uses only completed candles and computes fresh EMA/RSI/ATR',()=>{
 const r=completedMarketEvidence({symbol:'GOLDUSDC',source:'Hyperliquid',timeframe:'m1',bars,nowSeconds:75*60});
 expect(r).toMatchObject({available:true,completedBars:74,close:107.3});
 if(r.available){expect(r.ema9).not.toBeNull();expect(r.rsi14).toBeGreaterThan(50);expect(r.atr14).toBeGreaterThan(0);}
});
it('declines insufficient evidence',()=>{expect(completedMarketEvidence({symbol:'GOLDUSDC',source:'Hyperliquid',timeframe:'m1',bars:bars.slice(0,5),nowSeconds:1000})).toMatchObject({available:false})});
