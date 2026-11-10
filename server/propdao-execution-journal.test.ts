import {describe,it,expect} from 'vitest';
import {safeExecutionEvents,oldWorkerEvents} from '../shared/propdao-execution-journal.ts';
describe('account-scoped execution receipts',()=>{
 const e={id:'event_123456789',time:Date.now(),accountId:'prop-a',botId:'bot-1',
  grantId:'grant-1',symbol:'GOLDUSDC',stage:'SIGNAL',side:'SELL'};
 it('never interprets signals as fills or leaks a different account',()=>{
  expect(safeExecutionEvents([e,{...e,accountId:'prop-b'}],'prop-a')).toMatchObject([{stage:'SIGNAL',side:'SELL'}]);
 });
 it('marks legacy worker events unattributed',()=>{
  const events=oldWorkerEvents(['2026-11-10T07:45:08.000Z · Candle M1 · 2026-11-10T07:45:00.000Z · SELL'],'prop-a');
  expect(events[0]).toMatchObject({stage:'SIGNAL',botId:'unattributed'});
 });
});
