import {describe,it,expect} from 'vitest';
import {reconcileBrokerTrade} from './trade-attribution.ts';
import type {ExecutionEvent} from '../shared/propdao-execution-journal.ts';
const time=Date.parse('2026-11-11T08:00:00Z');
const trade={
 id:'trade-1',accountId:'prop-1',symbol:'GOLDUSDC',side:'SELL' as const,
 qty:.1859,entry:4044.75,openedAt:time,closedAt:time+120000,
 positionId:null,intentId:null,orderId:null
};
const fill:ExecutionEvent={
 id:'event_12345678',time,accountId:'prop-1',botId:'bot-1',
 grantId:'grant-1',symbol:'GOLDUSDC',stage:'PROTECTED_FILL',side:'SELL',
 positionId:'position-100',intentId:'intent-12345678',brokerOrderId:'order-1000',
 quantity:.1859,entryPrice:4044.75,filledAt:time,codeHash:'a'.repeat(64),decisionCandleClose:1794383940
};
describe('broker-to-robot attribution is explicit and conflict-aware',()=>{
 it('matches exact broker position, order, or intent ID with the correct account/symbol/side',()=>{
  for(const id of [{positionId:'position-100'},{orderId:'order-1000'},{intentId:'intent-12345678'}]){
   expect(reconcileBrokerTrade({...trade,...id},[fill])).toMatchObject({
    botId:'bot-1',confidence:'verified',attribution:'exact-provider-identity',codeHash:'a'.repeat(64)});
  }
 });
 it('does not equate account or instrument similarity with exact attribution',()=>{
  expect(reconcileBrokerTrade(trade,[{...fill,entryPrice:undefined}])).toMatchObject({botId:null,confidence:'unknown'});
  expect(reconcileBrokerTrade({...trade,accountId:'prop-2'},[fill])).toMatchObject({botId:null});
  expect(reconcileBrokerTrade({...trade,side:'BUY'},[fill])).toMatchObject({botId:null});
  expect(reconcileBrokerTrade({...trade,positionId:'different'},[fill])).toMatchObject({botId:null,confidence:'unknown'});
 });
 it('only labels a unique strong entry-evidence match as probable',()=>{
  const linked=reconcileBrokerTrade(trade,[fill]);
  expect(linked).toMatchObject({botId:'bot-1',confidence:'probable',attribution:'probable-entry-evidence'});
  expect(linked.evidence.join(' ')).toMatch(/not verified/i);
 });
 it('refuses a fuzzy match if the times, quantities, or prices differ',()=>{
  for(const other of [
   {...fill,filledAt:time+400000,time:time+400000},
   {...fill,quantity:.22},{...fill,entryPrice:4059.91},
   {...fill,stage:'SIGNAL' as const}
  ]){
   expect(reconcileBrokerTrade(trade,[other])).toMatchObject({botId:null,confidence:'unknown'});
  }
 });
 it('does not guess when two robots filled the same instrument and similar quantities',()=>{
  const second={...fill,botId:'bot-2',grantId:'grant-2',intentId:'intent-87654321',id:'event_87654321',positionId:'position-200'};
  expect(reconcileBrokerTrade(trade,[fill,second])).toMatchObject({botId:null,attribution:'conflicting-evidence'});
 });
 it('fails closed on contradictory provider IDs even when one position matches',()=>{
  const second={...fill,id:'event_87654321',botId:'bot-2',grantId:'grant-2',
    positionId:'position-200',intentId:'intent-87654321'};
  expect(reconcileBrokerTrade({...trade,positionId:'position-100',intentId:'intent-87654321'},[fill,second]))
   .toMatchObject({botId:null,attribution:'conflicting-evidence'});
  expect(reconcileBrokerTrade({...trade,positionId:'position-100',intentId:'another-id'},[fill]))
   .toMatchObject({botId:null,attribution:'conflicting-evidence'});
 });
 it('does not attribute a fill without broker entry timestamp or a real protected event',()=>{
  expect(reconcileBrokerTrade({...trade,openedAt:null},[fill])).toMatchObject({botId:null});
  expect(reconcileBrokerTrade(trade,[{...fill,stage:'SUBMISSION_STARTED'}])).toMatchObject({botId:null});
 });
});
