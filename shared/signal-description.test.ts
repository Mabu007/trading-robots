import {describe,it,expect} from 'vitest';
import {readSignalDescription,signalRuleFromText} from './signal-description';
import {validateAlertRule} from './market-alerts';
const now=Date.parse('2026-11-12T12:00:00Z');
describe('chat to precise Gold signals',()=>{
 it('creates validated Gold price signals without an AI tool-selection dependency',()=>{
  const rule=signalRuleFromText('Notify me when Gold closes above 4000 on M5',now);
  expect(rule).toMatchObject({symbol:'XAUUSD',timeframe:'m5',basis:'completed-candle',strategy:null,conditions:[{id:'c1',kind:'above',value:4000}]});
  expect(rule.expiresAt).toBe(Math.floor(now/1000)+7*86400);
  expect(()=>validateAlertRule(rule)).not.toThrow();
 });
 it('chooses a live tick condition only when the user explicitly says touch',()=>{
  expect(signalRuleFromText('Alert when Gold touches 3950',now).basis).toBe('live-price');
  expect(readSignalDescription('Gold RSI below 30 on M1')).toMatchObject({kind:'rsi_below',value:30,timeframe:'m1'});
  expect(signalRuleFromText('Watch Gold sweeping the previous 5 candle lows',now).conditions).toMatchObject([{kind:'sweep_low',lookback:5}]);
 });
 it('rejects vague, unsupported, or ambiguous instructions rather than inventing a trigger',()=>{
  expect(()=>signalRuleFromText('How is Gold doing?',now)).toThrow(/precise/);
  expect(()=>signalRuleFromText('Notify me when BTC breaks out',now)).toThrow(/Specify Gold/);
 });
});
