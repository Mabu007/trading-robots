import {describe,it,expect} from 'vitest';
import {evaluatePropDAOReleaseGate} from './propdao-release-acceptance';
const sha='a'.repeat(40),hash='b'.repeat(64),now=Date.now();
const healthy={
 ownerUid:'alice',accountId:'prop-1',tradeId:'trade-1',ownedDemoAccount:true,
 investigation:{available:true,brokerFresh:true,accountId:'prop-1',tradeId:'trade-1',
  trade:{id:'trade-1',pnl:-1},
  attribution:{confidence:'verified',attribution:'exact-provider-identity',
   botId:'bot-1',grantId:'grant-1',eventId:'event_12345678',strategyCodeHash:hash},
  diagnostic:{evidenceCoverage:{entryEvent:true,decision:true}}},
 archivedTrade:{providerTradeId:'trade-1',accountId:'prop-1',source:'durable-object-sql-authenticated-broker'},
 archivedFill:{id:'event_12345678',accountId:'prop-1',botId:'bot-1',
  grantId:'grant-1',stage:'PROTECTED_FILL',source:'durable-object-sql-worker-event-not-broker-trade'},
 revision:{available:true,botId:'bot-1',grantId:'grant-1',codeHash:hash,code:'export const config={};'},
 chatProof:{ownerUid:'alice',conversationId:'chat-a',receiptId:'receipt-a',
  model:'model/a',completed:true,streamedChars:200,recordedAt:now},
 chatTrace:[{id:'tool-call-1',name:'inspectBrokerTrade',state:'completed',output:{
  available:true,tradeId:'trade-1',accountId:'prop-1',attribution:{confidence:'verified'}}}],
 workerHealth:{runtime:'propdao-durable-object',ready:true,releaseSha:sha},
 productionSha:sha,configuredModel:'model/a',receiptId:'receipt-a',conversationId:'chat-a'
} as const;
describe('production release acceptance (no broker order writes)',()=>{
 it('passes only when the real broker, worker, Firestore and AI receipts agree',()=>{
  const result=evaluatePropDAOReleaseGate(healthy as any);
  expect(result.passed).toBe(true);
  expect(result.checks.every(check=>check.passed)).toBe(true);
  expect(result.mode).toContain('never creates a broker order');
 });
 it('does not certify likely but non-exact robot attribution',()=>{
  const result=evaluatePropDAOReleaseGate({...healthy,
   investigation:{...healthy.investigation,attribution:{...healthy.investigation.attribution,
    attribution:'probable-entry-evidence',confidence:'probable'}}} as any);
  expect(result.passed).toBe(false);
  expect(result.checks.find(x=>x.name.includes('provider identity'))?.passed).toBe(false);
 });
 it('refuses to certify missing archived SQL receipt or missing revision',()=>{
  for(const change of [{archivedTrade:null},{archivedFill:null},{revision:{available:false}}]){
   expect(evaluatePropDAOReleaseGate({...healthy,...change} as any).passed).toBe(false);
  }
 });
 it('refuses fake or failed live model receipts, mismatched users or stale timestamps',()=>{
  for(const patch of [
   {completed:false},{ownerUid:'another-user'},{model:'different-model'},
   {recordedAt:now-20*60_000},{streamedChars:0}
  ]){
   const result=evaluatePropDAOReleaseGate({...healthy,chatProof:{...healthy.chatProof,...patch}} as any);
   expect(result.passed).toBe(false);
  }
 });
 it('refuses mismatched Worker/Vercel SHA, disabled entries or an absent actual tool result',()=>{
  for(const patch of [{workerHealth:{...healthy.workerHealth,releaseSha:'other'}},
   {workerHealth:{...healthy.workerHealth,ready:false}},
   {chatTrace:[]}]){
   expect(evaluatePropDAOReleaseGate({...healthy,...patch} as any).passed).toBe(false);
  }
 });
});
