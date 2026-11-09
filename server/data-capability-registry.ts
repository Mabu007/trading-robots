/** Declarative contract for data the Trading Vibes task agent can request.
 * A catalog entry is never a permission grant; its tool implementation verifies ownership.
 */
export type DataCapability={
 id:string;tool:string;domain:'market'|'account'|'strategy'|'evaluation'|'execution';
 source:string;classification:'public-read'|'owner-read'|'draft-write'|'approval-only';
 freshness:'snapshot'|'completed-candles'|'persisted'|'derived';
 venue:'hyperliquid'|'propdao'|'all';requires:string[];
 limitations:string;cost:'low'|'medium'|'high';
 operations?:string[];requestSchema?:string;outputSchema?:string;rateLimit?:string;latencyMs?:number;
};
export const dataCapabilities:readonly DataCapability[]=[
 {id:'market.reference',tool:'readMarketEvidence',domain:'market',source:'Hyperliquid public candleSnapshot, L2, recentTrades and indexed news',
  classification:'public-read',freshness:'snapshot',venue:'hyperliquid',requires:[],cost:'medium',
  limitations:'Derivatives reference; not spot or PropDAO broker execution. Order-book liquidity is resting; recentTrades is a sample.'},
 {id:'market.ohlcv',tool:'readCompletedCandles',domain:'market',source:'Hyperliquid public candleSnapshot / validated historical cache',
  classification:'public-read',freshness:'completed-candles',venue:'hyperliquid',requires:[],cost:'medium',
  limitations:'Source-specific volume and historical prices. No future candles and no guarantee of fill quality.'},
 {id:'strategy.owned',tool:'readOwnedStrategy',domain:'strategy',source:'User-owned R2 strategy revisions',
  classification:'owner-read',freshness:'persisted',venue:'all',requires:['Firebase uid'],cost:'low',
  limitations:'Saved code is untrusted input; does not authorize trades.'},
 {id:'strategy.draft',tool:'proposeDraft',domain:'strategy',source:'User-scoped R2 task scratch',
  classification:'draft-write',freshness:'persisted',venue:'all',requires:['Firebase uid','R2'],cost:'low',
  limitations:'Drafts are not deployed and do not overwrite approved or saved strategies.'},
 {id:'evaluation.backtest',tool:'backtestDraft',domain:'evaluation',source:'QuickJS isolated code and validated completed Hyperliquid candles',
  classification:'draft-write',freshness:'derived',venue:'hyperliquid',requires:['R2'],cost:'high',
  limitations:'Reference simulation in R; not independently verified PropDAO fills, firm equity path or broker parity.'},
 {id:'account.propdao-list',tool:'listPropDAOAccounts',domain:'account',source:'Owner-scoped PropDAO connected account directory',
  classification:'owner-read',freshness:'snapshot',venue:'propdao',requires:['Firebase uid','PropDAO connection'],cost:'low',
  operations:['list demo accounts'],requestSchema:'reason',outputSchema:'connected accounts with challenge metadata',rateLimit:'per provider',
  limitations:'Account directory is not proof of live exposure or executable venue prices.'},
 {id:'account.propdao-risk',tool:'inspectPropDAOAccount',domain:'account',source:'PropDAO authenticated account-risk, positions and orders API',
  classification:'owner-read',freshness:'snapshot',venue:'propdao',requires:['Firebase uid','PropDAO connection','accountId'],cost:'medium',
  operations:['read equity','read risk','read positions','read open orders'],requestSchema:'accountId',outputSchema:'timestamped risk/exposure snapshot',rateLimit:'per provider',
  limitations:'On provider error, equity and exposure are unknown, NEVER assumed flat.'},
 {id:'strategy.inspect-draft',tool:'readTaskDraft',domain:'strategy',source:'Task-scoped immutable R2 revision',
  classification:'owner-read',freshness:'persisted',venue:'all',requires:['Firebase uid','taskId','draftId'],cost:'low',
  operations:['retrieve code for repair'],requestSchema:'draftId',outputSchema:'source and SHA-256',
  limitations:'Draft code is untrusted and does not grant permission to execute orders.'},
 {id:'evaluation.independent',tool:'evaluateCandidate',domain:'evaluation',source:'Server-side immutable backtest window comparison',
  classification:'draft-write',freshness:'derived',venue:'hyperliquid',requires:['Firebase uid','2+ disjoint backtests'],cost:'low',
  operations:['compare train and holdout','reject oversized loss','check costs and drawdown'],requestSchema:'draftId + reportIds',outputSchema:'research eligibility receipt',
  limitations:'Research screening only, never PropDAO broker fill parity or live deployment authorization.'},
 {id:'policy.demo',tool:'readTaskPolicy',domain:'account',source:'Server-side user-owned standing demo policy',
  classification:'owner-read',freshness:'persisted',venue:'propdao',requires:['Firebase uid','linked policy ID'],cost:'low',
  operations:['check consent expiry','check scoped account and instruments','check max risk'],requestSchema:'reason',outputSchema:'read-only validated policy and execution-disabled status',
  limitations:'A linked scope alone never authorizes an order. Every eventual deployment must perform broker-specific safety checks.'},
 {id:'monitor.deployment',tool:'inspectDeployment',domain:'execution',source:'Existing owner-scoped PropDAO runtime and broker reconciliation',
  classification:'owner-read',freshness:'snapshot',venue:'propdao',requires:['Firebase uid','owned botId','PropDAO connection'],cost:'medium',
  operations:['read deployment status','read grant expiry','read independently verified exposure'],requestSchema:'botId',outputSchema:'sanitized runtime and broker snapshot',
  limitations:'Read-only. Unknown broker response cannot imply flat exposure or stopped execution.'},
 {id:'execution.review',tool:'requestDeploymentReview',domain:'execution',source:'Existing revision-bound deployment approval service',
  classification:'approval-only',freshness:'persisted',venue:'propdao',requires:['User confirmation','Exact code hash','Broker reconciliation'],cost:'low',
  limitations:'Task engine must never execute live orders, grant approval, modify risk or start a bot.'}
] as const;
export function listDataCapabilities(scope:{allowDraft:boolean;allowReadOwner:boolean;allowSimulation:boolean;propdaoConnected?:boolean|null;brokerHealthy?:boolean|null}){
 return dataCapabilities.map(cap=>({...cap,health:cap.domain==='account'&&scope.brokerHealthy===false?'unavailable':cap.freshness==='snapshot'?'dynamic':'configured',available:
  cap.classification==='approval-only'?false:
  cap.id==='strategy.draft'?scope.allowDraft:
  cap.id==='strategy.owned'?scope.allowReadOwner:
  cap.id==='evaluation.backtest'?scope.allowSimulation:true}));
}
export function declaredToolForCapability(id:string):string|null{
 return dataCapabilities.find(cap=>cap.id===id)?.tool??null;
}
