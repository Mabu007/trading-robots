/** Declarative contract for data the Trading Vibes task agent can request.
 * A catalog entry is never a permission grant; its tool implementation verifies ownership.
 */
export type DataCapability={
 id:string;tool:string;domain:'market'|'account'|'strategy'|'evaluation'|'execution';
 source:string;classification:'public-read'|'owner-read'|'draft-write'|'approval-only';
 freshness:'snapshot'|'completed-candles'|'persisted'|'derived';
 venue:'hyperliquid'|'propdao'|'all';requires:string[];
 limitations:string;cost:'low'|'medium'|'high';
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
 {id:'execution.review',tool:'requestDeploymentReview',domain:'execution',source:'Existing revision-bound deployment approval service',
  classification:'approval-only',freshness:'persisted',venue:'propdao',requires:['User confirmation','Exact code hash','Broker reconciliation'],cost:'low',
  limitations:'Task engine must never execute live orders, grant approval, modify risk or start a bot.'}
] as const;
export function listDataCapabilities(scope:{allowDraft:boolean;allowReadOwner:boolean;allowSimulation:boolean}){
 return dataCapabilities.map(cap=>({...cap,available:
  cap.classification==='approval-only'?false:
  cap.id==='strategy.draft'?scope.allowDraft:
  cap.id==='strategy.owned'?scope.allowReadOwner:
  cap.id==='evaluation.backtest'?scope.allowSimulation:true}));
}
export function declaredToolForCapability(id:string):string|null{
 return dataCapabilities.find(cap=>cap.id===id)?.tool??null;
}
