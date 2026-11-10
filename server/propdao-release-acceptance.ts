import type {ToolTrace} from '../src/tool-trace.ts';

/** Independent acceptance checks: no broker writes, no model calls, no
 * fabricated trades. This verifies evidence from actual platform sources. */
type GateInput={
 accountId:string;tradeId:string;ownedDemoAccount:boolean;
 investigation:any;archivedTrade:any;archivedFill:any;
 revision:any;chatProof:any;chatTrace:ToolTrace[]|null;
 workerHealth:any;productionSha:string|null;configuredModel:string|null;
 receiptId:string;conversationId:string;
};
export function evaluatePropDAOReleaseGate(input:GateInput){
 const tests:{name:string;passed:boolean;detail:string}[]=[];
 const add=(name:string,passed:boolean,detail:string)=>tests.push({name,passed,detail});
 const check=input.investigation,link=check?.attribution;
 add('Authenticated PropDAO demo ownership',input.ownedDemoAccount===true,
  'Connected PropDAO evaluation account must belong to the signed-in user');
 const broker=check?.available===true&&check?.brokerFresh===true&&
  check?.accountId===input.accountId&&check?.tradeId===input.tradeId&&
  check?.trade?.id===input.tradeId&&
  typeof check?.trade?.pnl==='number'&&Number.isFinite(check.trade.pnl);
 add('Fresh real demo broker closed fill',broker,
  'The broker must independently report the selected trade, not only a Worker log');
 const exact=broker&&link?.confidence==='verified'&&
  link?.attribution==='exact-provider-identity'&&
  typeof link?.botId==='string'&&typeof link?.grantId==='string'&&
  typeof link?.eventId==='string';
 add('Exact broker-to-robot provider identity',Boolean(exact),
  'Unattributed or probable temporal matches do not pass the exact-attribution release gate');
 const decision=exact&&check?.diagnostic?.evidenceCoverage?.entryEvent===true&&
  check?.diagnostic?.evidenceCoverage?.decision===true;
 add('Original Worker decision and protected-fill journal',Boolean(decision),
  'Recorded strategy decision and actual protected broker fill must both exist');
 const event=exact&&input.archivedFill?.id===link.eventId&&
  input.archivedFill?.accountId===input.accountId&&
  input.archivedFill?.botId===link.botId&&
  input.archivedFill?.grantId===link.grantId&&
  input.archivedFill?.stage==='PROTECTED_FILL'&&
  input.archivedFill?.source==='durable-object-sql-worker-event-not-broker-trade';
 const trade=input.archivedTrade?.providerTradeId===input.tradeId&&
  input.archivedTrade?.accountId===input.accountId&&
  input.archivedTrade?.source==='durable-object-sql-authenticated-broker';
 add('Durable Object SQL evidence acknowledged in Firebase',Boolean(event&&trade),
  'Both the provider trade and exact protected-fill event need separate archived SQL receipts');
 const revision=exact&&input.revision?.available===true&&
  input.revision?.botId===link.botId&&input.revision?.grantId===link.grantId&&
  input.revision?.codeHash===link.strategyCodeHash&&
  typeof input.revision?.code==='string'&&input.revision.code.length>0;
 add('Immutable executed strategy revision',Boolean(revision),
  'R2 must prove the historical code hash for this exact deployment, not current strategy.js');
 const worker=input.workerHealth?.runtime==='propdao-durable-object'&&
  input.workerHealth.ready===true&&
  Boolean(input.productionSha)&&input.workerHealth.releaseSha===input.productionSha;
 add('Cloudflare and Vercel release SHA and entry gate',Boolean(worker),
  'Authenticated Worker health SHA must match deployed production Vercel SHA with entries enabled');
 const proof=input.chatProof?.ownerUid!==undefined&&input.chatProof.ownerUid&&
  input.chatProof.ownerUid===input.chatProof.signedInOwner&&
  input.chatProof.conversationId===input.conversationId&&
  input.chatProof.receiptId===input.receiptId&&
  input.chatProof.completed===true&&
  input.chatProof.streamedChars>0&&
  input.chatProof.model===input.configuredModel;
 const tool=Array.isArray(input.chatTrace)&&input.chatTrace.some(t=>
  t.name==='inspectBrokerTrade'&&t.state==='completed'&&
  (t.output as any)?.available===true&&
  (t.output as any)?.tradeId===input.tradeId&&
  (t.output as any)?.accountId===input.accountId&&
  (t.output as any)?.attribution?.confidence==='verified');
 add('Real configured OpenRouter model and saved VIBES conversation tool receipt',Boolean(proof&&tool),
  'A completed model response and a matching owner-scoped trade-inspection receipt are required');
 return {passed:tests.every(x=>x.passed),checkedAt:new Date().toISOString(),
  accountId:input.accountId,tradeId:input.tradeId,checks:tests,
  mode:'read-only acceptance (never creates a broker order)',
  limitation:'Without exact provider identity and archived broker evidence, release cannot be certified by inference.'};
}
