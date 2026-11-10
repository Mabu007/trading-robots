import {describe,it,expect} from 'vitest';
import {reconcileTradeIdentity} from './trade-attribution';
import type {BrokerTradeEvidence} from './trade-attribution';
import type {ExecutionEvent} from '../shared/propdao-execution-journal';
const NOW=Date.UTC(2026,10,10,14,0);
const trade:BrokerTradeEvidence={id:'trade1',accountId:'prop-1',symbol:'GOLDUSDC',
 side:'SELL',qty:0.5,entry:4044.75,exit:4051.87,pnl:-3.12,
 openedAt:NOW/1000,closedAt:(NOW+180000)/1000,reason:'SL',fee:0.12};
const fill:ExecutionEvent={id:'event_123456789',time:NOW,filledAt:NOW,
 accountId:'prop-1',botId:'bot-A',grantId:'grant-X',codeHash:'a'.repeat(64),
 stage:'PROTECTED_FILL',symbol:'GOLDUSDC',side:'SELL',
 intentId:'tv-123456789',positionId:'position-1',brokerOrderId:'order-1',
 entryPrice:4044.8,quantity:0.5,stopPrice:4050,decisionCandleClose:NOW/1000};
describe('evidence-scoped broker attribution',()=>{
 it('verifies an exact provider position ID and preserves deployment code hash',()=>{
  expect(reconcileTradeIdentity({...trade,positionId:'position-1'},[fill]))
   .toMatchObject({botId:'bot-A',grantId:'grant-X',confidence:'verified',
    attribution:'exact-provider-identity',strategyCodeHash:'a'.repeat(64)});
 });
 it('verifies exact intent and order identifiers independently',()=>{
  for(const patch of [{intentId:'tv-123456789'},{orderId:'order-1'}])
   expect(reconcileTradeIdentity({...trade,...patch},[fill]).confidence).toBe('verified');
 });
 it('does not match another account, side or instrument even with the same provider ID',()=>{
  for(const patch of [{accountId:'prop-2'},{side:'BUY' as const},{symbol:'BTCUSDC'}])
   expect(reconcileTradeIdentity({...trade,positionId:'position-1',...patch},[fill]).botId).toBeNull();
 });
 it('does not upgrade unmatched broker position identity from time and price',()=>{
  expect(reconcileTradeIdentity({...trade,positionId:'other-position'},[fill]))
   .toMatchObject({botId:null,attribution:'unattributed'});
 });
 it('supports probable links with all six independent entry measurements',()=>{
  expect(reconcileTradeIdentity(trade,[fill])).toMatchObject({
   botId:'bot-A',confidence:'probable',attribution:'probable-entry-evidence'});
 });
 it('never guesses from a signal, submission, or same account bot presence',()=>{
  for(const stage of ['SIGNAL','SUBMISSION_STARTED','OUTCOME_UNKNOWN'] as const)
   expect(reconcileTradeIdentity(trade,[{...fill,stage}]).botId).toBeNull();
 });
 it('never guesses with missing entry time, quantity, price or excessive drift',()=>{
  const mismatches=[
   {...trade,openedAt:null},{...trade,qty:0.75},{...trade,entry:4100},
   {...trade,openedAt:(NOW+360000)/1000}
  ];
  for(const t of mismatches)expect(reconcileTradeIdentity(t,[fill]).botId).toBeNull();
 });
 it('refuses to choose between two plausible robots with no broker IDs',()=>{
  const other={...fill,id:'event_987654321',botId:'bot-B',grantId:'grant-Y',intentId:'tv-987654321'};
  expect(reconcileTradeIdentity(trade,[fill,other]))
   .toMatchObject({botId:null,attribution:'conflicting-evidence'});
 });
 it('refuses conflicting exact provider IDs across two grants',()=>{
  const other={...fill,id:'event_987654321',botId:'bot-B',grantId:'grant-Y',intentId:'tv-987654321'};
  expect(reconcileTradeIdentity({...trade,positionId:'position-1'},[fill,other]))
   .toMatchObject({botId:null,attribution:'conflicting-evidence'});
 });
 it('does not turn unsupported manual history into robot ownership',()=>{
  expect(reconcileTradeIdentity({...trade,openedAt:null},[])).toMatchObject({botId:null});
 });
});
