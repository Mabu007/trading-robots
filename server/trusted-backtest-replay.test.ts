import {describe,it,expect,vi} from 'vitest';
import {gzipSync} from 'node:zlib';
import {simulate} from '../src/engine.ts';
import {runTrustedBacktestReplay,ReplayMismatch,ReplayUnavailable} from './trusted-backtest-replay.ts';

const code='export const config = { timeframes: ["m1"], executionTimeframe: "m1", riskPercent: 1, riskReward: 2 }; export function onCandle(ctx) { return { action: "WAIT" }; }';
const uid='alice',botId='gold-demo',asset='GOLDUSDC',providerSymbol='xyz:GOLD';
const day=Date.parse('2026-11-01T00:00:00Z');
const ms=60000,from=day-200*ms,end=Date.parse('2026-11-03T00:00:00Z');
const candles=Array.from({length:(end-from)/ms},(_,i)=>({time:(from+i*ms)/1000,open:100,high:101,low:99,close:100,volume:1}));
const trading=candles.filter(c=>c.time*1000>=day);
const snapshot=()=>({strategyCode:code,asset,venue:'propdao',from:'2026-11-01',to:'2026-11-02',
 result:{...simulate(trading.map(c=>({...c})),trading.map(()=>({action:'WAIT'}))),source:'test independent data',timeframe:'m1'}});
const pack=(value:unknown)=>{const data=Buffer.from(JSON.stringify(value));return JSON.stringify({format:'gzip-base64',version:2,userId:uid,botId,uncompressedBytes:data.length,payload:gzipSync(data).toString('base64')})};
const feed=()=>({asset:providerSymbol,timeframe:'m1',source:'R2 / public Hyperliquid independent fixture',candles,expectedCandles:candles.length,missingCandles:0,observedGaps:0,coverageComplete:true});
const args=(saved=snapshot(),load=vi.fn(async()=>feed()))=>({raw:pack(saved),uid,botId,code,asset,providerSymbol,load,now:()=>Date.parse('2026-11-08T00:00:00Z')});
describe('trusted server-produced reference backtest receipt',()=>{
 it('independently evaluates the complete exact revision and matches recorded trades and equity',async()=>{
  const receipt=await runTrustedBacktestReplay(args());
  expect(receipt).toMatchObject({provenance:'server-replayed-reference',providerSymbol:'xyz:GOLD',candleCount:2880,assumptions:{nextCandleFills:true}});
  expect(receipt.replayHash).toMatch(/^[0-9a-f]{64}$/);
 });
 it('fails closed on browser OHLC differing from independently loaded source',async()=>{
  const forged=snapshot();forged.result.candles[0].high=999;
  await expect(runTrustedBacktestReplay(args(forged))).rejects.toBeInstanceOf(ReplayMismatch);
 });
 it('fails closed on fabricated browser trade metrics when replay disagrees',async()=>{
  const forged=snapshot();forged.result.metrics.netReturn=8;
  await expect(runTrustedBacktestReplay(args(forged))).rejects.toBeInstanceOf(ReplayMismatch);
 });
 it('marks incomplete or unreachable history as unavailable, not verified',async()=>{
  const incomplete=vi.fn(async()=>({...feed(),missingCandles:1,coverageComplete:false}));
  await expect(runTrustedBacktestReplay(args(snapshot(),incomplete))).rejects.toBeInstanceOf(ReplayUnavailable);
  const unreachable=vi.fn(async():Promise<ReturnType<typeof feed>>=>{throw Error('provider offline')});
  await expect(runTrustedBacktestReplay(args(snapshot(),unreachable))).rejects.toBeInstanceOf(ReplayUnavailable);
 });
});
