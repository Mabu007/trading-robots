import {describe,it,expect} from 'vitest';
import {analysisId,analysisSource,analyzeMarket,type MarketBar} from './code-analysis';

const now=Date.parse('2026-11-05T13:00:00.000Z');
const bars:MarketBar[]=Array.from({length:90},(_,i)=>({time:Math.floor(now/1000)-90*60+i*60,open:100,high:101,low:99,close:100}));
const params={kind:'liquidity_sweeps' as const,asset:'GOLDUSDC',timeframe:'m1',from:new Date(now-90*60000).toISOString(),to:new Date(now).toISOString()};
describe('audited code analytics',()=>{
 it('recognizes a bearish wick and close back inside the prior range without future candles',()=>{
  const data=bars.map(b=>({...b}));data[20]={...data[20],high:103,close:100.5};
  const report=analyzeMarket(params,data);
  expect(report.findings.some(x=>x.kind==='bearish sweep'&&x.time===data[20].time)).toBe(true);
  expect(report.bars).toBe(90);
 });
 it('recognizes a bullish wick reversal candidate',()=>{
  const data=bars.map(b=>({...b}));data[25]={...data[25],low:97,close:99.4};
  expect(analyzeMarket(params,data).findings.some(x=>x.kind==='bullish sweep'&&x.time===data[25].time)).toBe(true);
 });
 it('does not use future data to label a sweep',()=>{
  const data=bars.map(b=>({...b}));data[10].high=102;data[10].close=102;
  expect(analyzeMarket(params,data).findings.some(x=>x.time===data[10].time)).toBe(false);
 });
 it('produces ATR percentage, realized volatility and dated UTC window',()=>{
  const report=analyzeMarket({...params,kind:'volatility_profile'},bars);
  expect(report.atr14).toBeGreaterThan(0);
  expect(report.atrPercent).toBeGreaterThan(0);
  expect(report.regime).toMatch(/volatility/);
  expect(report.findings).toHaveLength(0);
 });
 it('counts gaps but never invents missing candles',()=>{
  const report=analyzeMarket(params,bars.filter((_,i)=>i<30||i>35));
  expect(report.gaps).toBe(1);expect(report.bars).toBe(84);
 });
 it('bounds date ranges and candle count before scanning',()=>{
  expect(()=>analyzeMarket({...params,to:new Date(now+45*86400000).toISOString()},bars)).toThrow(/window/);
  expect(()=>analyzeMarket(params,Array(50001).fill(bars[0]))).toThrow(/limit/);
 });
 it('has stable IDs and auditable template source',()=>{
  expect(analysisId('liquidity_sweeps','propdao','GOLDUSDC','m1')).toBe('analysis-liquidity_sweeps-propdao-goldusdc-m1');
  expect(analysisSource('liquidity_sweeps')).toContain('analyze(candles');
 });
});
