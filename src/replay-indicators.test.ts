import {expect,it} from 'vitest';
import {calculateIndicator,type IndicatorType} from './replay-indicators';
import type {ReplayBar} from './market-replay-engine';
it('calculates studies from revealed candles only',()=>{
 const start=Date.parse('2026-11-13T00:00:00Z')/1000;
 const bars:ReplayBar[]=Array.from({length:100},(_,i)=>({time:start+i*60,open:100+i,high:102+i,low:99+i,close:101+i}));
 const revealed=bars.slice(0,80);bars[90].high=100000;
 const types:IndicatorType[]=['EMA','SMA','Bollinger Bands','RSI','MACD','Stochastic','ATR','ADX','Ichimoku'];
 for(const type of types){const lines=calculateIndicator(revealed,{id:type,type,period:14,color:'#123456'});expect(lines.some(x=>x.points.length)).toBe(true);for(const line of lines)for(const p of line.points){expect(p.time).toBeLessThanOrEqual(revealed.at(-1)!.time);expect(Number.isFinite(p.value)).toBe(true)}}
});
