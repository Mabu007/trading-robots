import {describe,it,expect} from 'vitest';
import {safeExecutionEvents,oldWorkerEvents} from '../shared/propdao-execution-journal.ts';
describe('account-scoped execution receipts',()=>{
 const e={id:'event_123456789',time:Date.now(),accountId:'prop-a',botId:'bot-1',
  grantId:'grant-1',symbol:'GOLDUSDC',stage:'SIGNAL',side:'SELL'};
 it('never interprets signals as fills or leaks a different account',()=>{
  expect(safeExecutionEvents([e,{...e,accountId:'prop-b'}],'prop-a')).toMatchObject([{stage:'SIGNAL',side:'SELL'}]);
 });
 it('retains only safe provider identity, code revision, time and prices from protected fills',()=>{
  const fill={...e,stage:'PROTECTED_FILL' as const,positionId:'position-012345',
   intentId:'intent-012345',brokerOrderId:'order-012345',entryPrice:4044.75,
   quantity:.1859,filledAt:Date.now()-120000,stopPrice:4051.87,
   targetPrice:4025,riskBudgetUsd:2,decisionCandleClose:1794384000,
   codeHash:'a'.repeat(64)};
  expect(safeExecutionEvents([fill],'prop-a')[0]).toMatchObject(fill);
  const bad=safeExecutionEvents([{...fill,entryPrice:NaN,stopPrice:-5,
   positionId:'no space\nallowed',codeHash:'unverified'}],'prop-a')[0];
  expect(bad.entryPrice).toBeUndefined();
  expect(bad.stopPrice).toBeUndefined();
  expect(bad.positionId).toBeUndefined();
  expect(bad.codeHash).toBeUndefined();
 });
 it('marks legacy worker events unattributed',()=>{
  const events=oldWorkerEvents(['2026-11-10T07:45:08.000Z · Candle M1 · 2026-11-10T07:45:00.000Z · SELL'],'prop-a');
  expect(events[0]).toMatchObject({stage:'SIGNAL',botId:'unattributed'});
 });
});
