import {describe,it,expect} from 'vitest';
import {requiresDurableJournal,type ExecutionStage} from './propdao-execution-journal';

describe('critical order-chain SQL evidence',()=>{
 it('requires durable history before a signal can place an order',()=>{
  expect(requiresDurableJournal('SIGNAL')).toBe(true);
  expect(requiresDurableJournal('SUBMISSION_STARTED')).toBe(true);
 });
 it('halts new entries if outcome evidence cannot be persisted after broker response',()=>{
  expect(requiresDurableJournal('PROTECTED_FILL')).toBe(true);
  expect(requiresDurableJournal('CANCELLED_UNFILLED')).toBe(true);
 });
 it('keeps observational events best-effort without turning them into a broker fill',()=>{
  for(const stage of ['ENTRY_SKIPPED','PRE_SUBMIT_REJECTED','OUTCOME_UNKNOWN'] as ExecutionStage[])
   expect(requiresDurableJournal(stage)).toBe(false);
 });
});
