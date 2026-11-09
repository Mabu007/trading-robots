import {describe,it,expect} from 'vitest';
import {substantialReturnQuestion,validTaskAnswer} from '../shared/agent-task-question.ts';
describe('goal risk clarification, without execution approval',()=>{
 it('asks before pursuing a 233% same-day trading objective',()=>{
  const q=substantialReturnQuestion('Here is R300 make it R1000 by end of day',12345);
  expect(q?.prompt).toContain('233%');expect(q?.options).toHaveLength(2);
  expect(validTaskAnswer(q!,q!.options[1])).toContain('DEMO');
  expect(validTaskAnswer(q!,'Other: I need a lesson on the probabilities')).toContain('Other:');
 });
 it('does not interrupt ordinary questions or make up risk for longer goals',()=>{
  expect(substantialReturnQuestion('Research gold patterns for a week',123)).toBeNull();
  expect(substantialReturnQuestion('Show me returns for R300 invested 10 years',123)).toBeNull();
 });
 it('refuses a guessed or empty answer',()=>{
  const q=substantialReturnQuestion('R200 turn to R700 trading today',0)!;
  expect(()=>validTaskAnswer(q,'yes deploy now')).toThrow();
  expect(()=>validTaskAnswer(q,'Other: ')).toThrow();
 });
});
