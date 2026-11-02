/** Preflight only. A passing result does not authorize or submit an order. */
export type PropDAORiskInput = {
  status: string; breached: boolean; roomUsd: number; availableMargin: number;
  side: 'BUY' | 'SELL'; entry: number; stop: number; quantity: number;
  lotStep: number; leverage: number; maxLeverage: number;
  takerFeeRate: number; userRiskLimitUsd: number;
};
export function validatePropDAORisk(input: PropDAORiskInput) {
  const n=[input.roomUsd,input.availableMargin,input.entry,input.stop,input.quantity,input.lotStep,input.leverage,input.maxLeverage,input.takerFeeRate,input.userRiskLimitUsd];
  if (!n.every(Number.isFinite) || input.roomUsd<=0 || input.availableMargin<0 || input.entry<=0 || input.stop<=0 || input.quantity<=0 || input.lotStep<=0 || input.leverage<=0 || input.maxLeverage<=0 || input.takerFeeRate<0 || input.userRiskLimitUsd<=0) return {ok:false as const,reason:'Missing or invalid account, market, or order data.'};
  if (input.breached || !['active','funded'].includes(input.status)) return {ok:false as const,reason:'Account is not eligible for new orders.'};
  if (input.side!=='BUY'&&input.side!=='SELL') return {ok:false as const,reason:'Invalid order side.'};
  if (input.side==='BUY'?input.stop>=input.entry:input.stop<=input.entry) return {ok:false as const,reason:'Stop must be on the losing side of entry.'};
  if (input.leverage>input.maxLeverage) return {ok:false as const,reason:'Leverage exceeds the market limit.'};
  const steps=input.quantity/input.lotStep;
  if (!Number.isFinite(steps) || steps>Number.MAX_SAFE_INTEGER || Math.abs(steps-Math.round(steps))>Math.min(1e-7, Math.max(1,Math.abs(steps))*Number.EPSILON*8)) return {ok:false as const,reason:'Quantity does not match the market lot step.'};
  const margin=input.entry*input.quantity/input.leverage;
  // Conservative estimate for entry and exit fees at the specified prices;
  // slippage, funding and gaps may increase actual loss.
  const fees=(input.entry+input.stop)*input.quantity*input.takerFeeRate;
  const plannedLoss=Math.abs(input.entry-input.stop)*input.quantity+fees;
  if (![margin,fees,plannedLoss].every(Number.isFinite)) return {ok:false as const,reason:'Order values are too large.'};
  if (margin>input.availableMargin) return {ok:false as const,reason:'Insufficient available margin.'};
  if (plannedLoss>=input.roomUsd || plannedLoss>input.userRiskLimitUsd) return {ok:false as const,reason:'Planned loss exceeds account or user risk allowance.'};
  return {ok:true as const,plannedLoss,estimatedFees:fees,requiredMargin:margin};
}
