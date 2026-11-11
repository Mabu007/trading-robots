import {describe,it,expect} from 'vitest';
import {starterCode} from '../src/strategy.ts';
import {createHash} from 'node:crypto';
import {uniqueCodeReplacement,sourceLines,requestedStrategyMutation} from './robot-source-operations.ts';
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
describe('exact, code-hash-bound source edits',()=>{
 it('replaces only one intended line then validates the complete strategy',()=>{
  const patch=uniqueCodeReplacement(starterCode,'riskReward: 2','riskReward: 3',sha(starterCode));
  expect(patch.previousHash).toBe(sha(starterCode));
  expect(patch.proposedHash).toBe(sha(patch.proposed));
  expect(patch.proposed).toContain('riskReward: 3');
  expect(starterCode).toContain('riskReward: 2');
 });
 it('refuses stale code hash, duplicate snippet, missing text, invalid JavaScript and no-op',()=>{
  expect(()=>uniqueCodeReplacement(starterCode,'riskReward: 2','riskReward: 3','0'.repeat(64))).toThrow(/changed/);
  expect(()=>uniqueCodeReplacement(starterCode,'return','exit',sha(starterCode))).toThrow(/not unique/);
  expect(()=>uniqueCodeReplacement(starterCode,'does not exist','x',sha(starterCode))).toThrow(/not found/);
  expect(()=>uniqueCodeReplacement(starterCode,'riskReward: 2','riskReward: ;',sha(starterCode))).toThrow();
  expect(()=>uniqueCodeReplacement(starterCode,'riskReward: 2','riskReward: 2',sha(starterCode))).toThrow(/No source/);
 });
 it('paginates complete source by exact lines without falsely reporting complete',()=>{
  const first=sourceLines(starterCode,1,10);
  const second=sourceLines(starterCode,11,140);
  expect(first.codeHash).toBe(sha(starterCode));
  expect(first.complete).toBe(false);
  expect(second.code.startsWith(starterCode.split('\n')[10])).toBe(true);
  expect(second.nextLine).toBeNull();
 });
});
describe('model tool activation requires the user to request the operation',()=>{
 it("recognizes the user's real failure case and source edits",()=>{
  expect(requestedStrategyMutation('Can we edit the robot stop loss?').edit).toBe(true);
  expect(requestedStrategyMutation('Please change its SL logic').edit).toBe(true);
  expect(requestedStrategyMutation('delete the saved Gold robot').delete).toBe(true);
  expect(requestedStrategyMutation('create a new PropDAO bot').create).toBe(true);
 });
 it('does not expose mutation tools for ordinary market or loss analysis',()=>{
  expect(requestedStrategyMutation('How did the robot trade today?')).toEqual({create:false,edit:false,delete:false});
  expect(requestedStrategyMutation('Read the GOLDUSDC candles')).toEqual({create:false,edit:false,delete:false});
 });
});
