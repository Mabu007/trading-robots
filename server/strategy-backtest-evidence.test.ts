import {describe,it,expect} from 'vitest';
import {gzipSync} from 'node:zlib';
import {inspectBacktestEvidence} from './strategy-backtest-evidence';
import {simulate} from '../src/engine.ts';

const uid='alice',botId='gold-1',source='export const config = {timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2}; export function onCandle(ctx) {return {action:"WAIT"}}';
const sample=()=>{const base=Date.parse('2026-11-01T00:00:00Z')/1000;
 const candles=[{time:base,open:100,high:101,low:99,close:100,volume:1},{time:base+60,open:101,high:102,low:100,close:101,volume:2}];
 return {strategyCode:source,venue:'propdao',asset:'GOLDUSDC',from:'2026-11-01',to:'2026-11-02',riskPercent:1,result:{...simulate(candles,[{action:'WAIT'},{action:'WAIT'}]),timeframe:'m1',source:'historical candles'}};
};
const encode=(state:unknown,owner=uid,id=botId)=>{const bytes=Buffer.from(JSON.stringify(state));return JSON.stringify({format:'gzip-base64',version:2,userId:owner,botId:id,payload:gzipSync(bytes).toString('base64'),uncompressedBytes:bytes.length,savedAt:'2026-11-03T00:00:00Z'})};
const expected={code:source,asset:'GOLDUSDC',venue:'propdao',executionTimeframe:'m1'};
describe('exact saved backtest evidence',()=>{
 it('pins the source SHA and immutable saved run snapshot, while labeling the runner untrusted',()=>{
  const raw=encode(sample()),receipt=inspectBacktestEvidence(raw,uid,botId,expected);
  expect(receipt.codeHash).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt).toMatchObject({asset:'GOLDUSDC',from:'2026-11-01',to:'2026-11-02',provenance:'client-produced-research'});
  expect(receipt.receiptHash).not.toBe(inspectBacktestEvidence(encode({...sample(),to:'2026-11-04'}),uid,botId,expected).receiptHash);
 });
 it('rejects wrong owner, bot, code revision, market, venue and timeframe',()=>{
  const raw=encode(sample());
  expect(()=>inspectBacktestEvidence(raw,'bob',botId,expected)).toThrow(/incomplete/);
  expect(()=>inspectBacktestEvidence(raw,uid,'other-bot',expected)).toThrow(/incomplete/);
  expect(()=>inspectBacktestEvidence(raw,uid,botId,{...expected,code:source+' // changed'})).toThrow(/different strategy/);
  expect(()=>inspectBacktestEvidence(raw,uid,botId,{...expected,asset:'BTCUSDC'})).toThrow(/different strategy/);
  expect(()=>inspectBacktestEvidence(raw,uid,botId,{...expected,venue:'valr'})).toThrow(/different strategy/);
  expect(()=>inspectBacktestEvidence(raw,uid,botId,{...expected,executionTimeframe:'m5'})).toThrow(/different strategy/);
 });
 it('rejects a malformed candle and invented metrics rather than issuing a reviewable receipt',()=>{
  const malformed=sample();malformed.result.candles[0].high=90;
  expect(()=>inspectBacktestEvidence(encode(malformed),uid,botId,expected)).toThrow(/malformed or out-of-order candles/);
  const forged=sample();forged.result.metrics.netReturn=12345;
  expect(()=>inspectBacktestEvidence(encode(forged),uid,botId,expected)).toThrow(/metrics do not match/);
 });
 it('rejects missing or tampered simulation data instead of manufacturing a verified test',()=>{
  expect(()=>inspectBacktestEvidence(encode({...sample(),result:{trades:[],metrics:{}}}),uid,botId,expected)).toThrow(/lacks a complete/);
  expect(()=>inspectBacktestEvidence('not-json',uid,botId,expected)).toThrow(/incomplete/);
 });
});
