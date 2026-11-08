import {describe,it,expect} from 'vitest';
import {gzipSync} from 'node:zlib';
import {inspectBacktestEvidence} from './strategy-backtest-evidence';

const uid='alice',botId='gold-1',source='export const config = {timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2}; export function onCandle(ctx) {return {action:"WAIT"}}';
const sample=()=>({strategyCode:source,venue:'propdao',asset:'GOLDUSDC',from:'2026-11-01',to:'2026-11-02',riskPercent:1,
 result:{timeframe:'m1',candles:[{time:1,open:1,high:1,low:1,close:1,volume:1}],trades:[],metrics:{trades:0},source:'historical candles'}});
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
 it('rejects missing or tampered simulation data instead of manufacturing a verified test',()=>{
  expect(()=>inspectBacktestEvidence(encode({...sample(),result:{trades:[],metrics:{}}}),uid,botId,expected)).toThrow(/lacks a complete/);
  expect(()=>inspectBacktestEvidence('not-json',uid,botId,expected)).toThrow(/incomplete/);
 });
});
