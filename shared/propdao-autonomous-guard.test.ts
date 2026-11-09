import {describe,it,expect} from 'vitest';
import {evaluateAutonomousEquity} from './propdao-autonomous-guard.ts';
const envelope={demoOnly:true as const,taskId:'x',policyFingerprint:'a'.repeat(64),startingEquity:1000,maxDailyLossPct:1,maxDrawdownPct:3};
describe('continuous PropDAO evaluation drawdown guard',()=>{
 it('passes verified equity within user and firm limits',()=>{
  expect(evaluateAutonomousEquity(envelope,999,1000,{breached:false,roomUsd:49},.25).canEnter).toBe(true);
 });
 it('rejects daily, static, broker breach, and unknown equity',()=>{
  expect(evaluateAutonomousEquity(envelope,989,1000,{breached:false,roomUsd:40},.25).canEnter).toBe(false);
  expect(evaluateAutonomousEquity(envelope,969,969,{breached:false,roomUsd:40},.25).canEnter).toBe(false);
  expect(evaluateAutonomousEquity(envelope,990,null,{breached:false,roomUsd:40},.25).canEnter).toBe(false);
  expect(evaluateAutonomousEquity(envelope,999,1000,{breached:true,roomUsd:40},.25).canEnter).toBe(false);
 });
});
