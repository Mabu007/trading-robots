/** Single, pure cost-accounting layer for the existing PropDAO replay paths.
 * P&L is in USDC. PropDAO qty is asset units, not margin / lots.
 * Fee rates are per fill on the EXECUTED notional, not leveraged equity.
 *
 * Never infer spread, slippage or funding from OHLC or call zero "verified".
 */
export const PROPDAO_COST_MODEL_VERSION='propdao-cost-v1' as const;
export const PROPDAO_DOCUMENTED_FEES=Object.freeze({
 maker:0.00015,taker:0.00045,
 source:'https://www.propdao.finance/docs',
 observedOn:'2026-11-11',
 provenance:'published-PropDAO-fee-schedule' as const
});
export type PropDAOLiquidity='maker'|'taker';
export type CostProvenance='authenticated-propdao-markets'|'published-PropDAO-fee-schedule';
export type PropDAOCostProfile={
 version:typeof PROPDAO_COST_MODEL_VERSION;
 symbol:string;feeRate:{maker:number;taker:number};
 feeProvenance:CostProvenance; feeSource:string;
 verifiedAt:string; lotStep:number;minQuantity:number;minimumNotionalUsd:number|null;
 contractMultiplier:number; contractProvenance:'authenticated-propdao-markets'|'asset-units-assumption';
};
export type ExecutionAssumptions={
 /** Full quoted spread, in USDC per asset unit; applied half on each side. */
 spreadPrice:number;
 entrySlippagePrice:number;
 stopSlippagePrice:number;
 targetSlippagePrice:number;
 endSlippagePrice:number;
 /** Estimated funding / holding debit in USDC per filled asset unit.
  * Negative values represent credits. An explicit 0 is an assumption, NOT proof.
  */
 fundingUsdPerUnit:number;
 provenance:'user-assumption'|'measured-historical-quote'|'account-specific-evidence';
 note:string;
};
export type PropDAOTradeCostInput={
 side:'LONG'|'SHORT';quantity:number;referenceEntry:number;referenceExit:number;
 exitReason:'stop'|'target'|'signal'|'end';entryLiquidity:PropDAOLiquidity;exitLiquidity:PropDAOLiquidity;
 profile:PropDAOCostProfile;assumptions:ExecutionAssumptions;
};
const positive=(x:number)=>Number.isFinite(x)&&x>0;
const nonnegative=(x:number)=>Number.isFinite(x)&&x>=0;
const fixed=(x:number)=>Math.round(x*1e10)/1e10;
function fail(reason:string):never{throw Error('PropDAO cost model: '+reason)}
function validateRates(rates:{maker:number;taker:number}){
 if(!nonnegative(rates.maker)||!nonnegative(rates.taker)||rates.maker>=1||rates.taker>=1)
  fail('Invalid maker/taker fee rates.');
}
export function validatePropDAOProfile(profile:PropDAOCostProfile){
 if(profile.version!==PROPDAO_COST_MODEL_VERSION||!/^[A-Z0-9]{2,40}$/.test(profile.symbol)||
    !positive(profile.lotStep)||!positive(profile.minQuantity)||
    profile.minQuantity<profile.lotStep-1e-9||
    profile.minimumNotionalUsd!==null&&(!positive(profile.minimumNotionalUsd))||
    !positive(profile.contractMultiplier)||!profile.feeSource||
    !['authenticated-propdao-markets','published-PropDAO-fee-schedule'].includes(profile.feeProvenance))
   fail('Unverified contract, quantity or fee profile.');
 validateRates(profile.feeRate);
}
export function validateExecutionAssumptions(a:ExecutionAssumptions){
 if(!a||!nonnegative(a.spreadPrice)||!nonnegative(a.entrySlippagePrice)||
    !nonnegative(a.stopSlippagePrice)||!nonnegative(a.targetSlippagePrice)||
    !nonnegative(a.endSlippagePrice)||!Number.isFinite(a.fundingUsdPerUnit)||
    !['user-assumption','measured-historical-quote','account-specific-evidence'].includes(a.provenance)||
    !a.note?.trim())fail('Spread, slippage and funding must each be explicit with provenance.');
}
/** Authenticated account's available market specification takes precedence
 * over global documentation. Never fabricate a lot step or min quantity.
 */
export function propDAOProfileFromMarkets(
 symbol:string,markets:{
  fees?:{maker?:number;taker?:number};
  data?:Array<{symbol?:string;lotStep?:number;minQty?:number;minNotionalUsd?:number;contractMultiplier?:number}>
 },verifiedAt=new Date().toISOString()
):PropDAOCostProfile{
 const asset=markets.data?.find(x=>x.symbol===symbol);
 if(!asset||!positive(asset.lotStep??NaN)||
    !markets.fees||!nonnegative(markets.fees.maker??NaN)||!nonnegative(markets.fees.taker??NaN))
  fail('Verified PropDAO /markets fees and instrument lot step required.');
 const profile:PropDAOCostProfile={
  version:PROPDAO_COST_MODEL_VERSION,symbol,
  feeRate:{maker:markets.fees.maker!,taker:markets.fees.taker!},
  feeProvenance:'authenticated-propdao-markets',
  feeSource:'PropDAO GET /markets; authenticated account-bound market selection',
  verifiedAt,
  lotStep:asset.lotStep!,minQuantity:asset.minQty??asset.lotStep!,
  minimumNotionalUsd:asset.minNotionalUsd??null,
  contractMultiplier:asset.contractMultiplier??1,
  contractProvenance:positive(asset.contractMultiplier??NaN)?
   'authenticated-propdao-markets':'asset-units-assumption'
 };
 validatePropDAOProfile(profile);return profile;
}
/** No silent fallback: this must be supplied by the user, historical bid/ask
 * capture or an explicit policy. OHLC midpoint candles alone prove none of it.
 */
export function explicitPropDAOAssumptions(
 input:Omit<ExecutionAssumptions,'provenance'|'note'>,note:string
):ExecutionAssumptions{
 const assumptions:ExecutionAssumptions={...input,provenance:'user-assumption',note};
 validateExecutionAssumptions(assumptions);return assumptions;
}
export function priceForFill(input:{
 side:'LONG'|'SHORT';mid:number;isEntry:boolean;
 reason?:PropDAOTradeCostInput['exitReason'];assumptions:ExecutionAssumptions
}){
 const {side,mid,isEntry,assumptions:a}=input;
 validateExecutionAssumptions(a);
 if(!positive(mid))fail('Invalid reference market price.');
 const slip=isEntry?a.entrySlippagePrice:input.reason==='stop'?a.stopSlippagePrice:
   input.reason==='target'?a.targetSlippagePrice:a.endSlippagePrice;
 // Each entry buys at ask / sells at bid; each exit closes the opposite way.
 const direction=side==='LONG'?1:-1;
 const adjustment=(isEntry?direction:-direction)*(a.spreadPrice/2+slip);
 const price=mid+adjustment;
 if(!positive(price))fail('Execution price crossed zero.');
 return fixed(price);
}
/** Price spread and slippage are ALREADY reflected in execution P&L.
 * Do not subtract them a second time from the resulting gross P&L.
 */
export function accountPropDAOTrade(input:PropDAOTradeCostInput){
 const {profile,assumptions:a}=input;
 validatePropDAOProfile(profile);validateExecutionAssumptions(a);
 if(!positive(input.quantity)||!positive(input.referenceEntry)||!positive(input.referenceExit)||
    !['LONG','SHORT'].includes(input.side)||
    !['maker','taker'].includes(input.entryLiquidity)||
    !['maker','taker'].includes(input.exitLiquidity))
  fail('Invalid fill direction, quantity or liquidity.');
 const direction=input.side==='LONG'?1:-1;
 const entry=priceForFill({side:input.side,mid:input.referenceEntry,isEntry:true,assumptions:a});
 const exit=priceForFill({side:input.side,mid:input.referenceExit,isEntry:false,reason:input.exitReason,assumptions:a});
 const units=input.quantity*profile.contractMultiplier;
 const grossReferenceUsd=(input.referenceExit-input.referenceEntry)*direction*units;
 const grossExecutionUsd=(exit-entry)*direction*units;
 const entryCommissionUsd=entry*units*profile.feeRate[input.entryLiquidity];
 const exitCommissionUsd=exit*units*profile.feeRate[input.exitLiquidity];
 const commissionUsd=entryCommissionUsd+exitCommissionUsd;
 const spreadImpactUsd=a.spreadPrice*units;
 const slippageImpactUsd=(a.entrySlippagePrice+
   (input.exitReason==='stop'?a.stopSlippagePrice:input.exitReason==='target'?a.targetSlippagePrice:a.endSlippagePrice))*units;
 const fundingUsd=a.fundingUsdPerUnit*input.quantity;
 const netPnlUsd=grossExecutionUsd-commissionUsd-fundingUsd;
 return {
  version:PROPDAO_COST_MODEL_VERSION,profileVersion:profile.version,
  profileSource:profile.feeSource,assumptionProvenance:a.provenance,
  side:input.side,quantity:input.quantity,referenceEntry:input.referenceEntry,
  referenceExit:input.referenceExit,entry,exit,
  grossReferenceUsd:fixed(grossReferenceUsd),grossPnlUsd:fixed(grossExecutionUsd),
  entryCommissionUsd:fixed(entryCommissionUsd),exitCommissionUsd:fixed(exitCommissionUsd),
  commissionUsd:fixed(commissionUsd),spreadImpactUsd:fixed(spreadImpactUsd),
  slippageImpactUsd:fixed(slippageImpactUsd),fundingUsd:fixed(fundingUsd),
  netPnlUsd:fixed(netPnlUsd),costDragUsd:fixed(grossReferenceUsd-netPnlUsd),
  accounting:'Net = actual-execution gross - entry/exit commissions - explicit funding; spread/slippage included in prices',
  uncertainty:'OHLC does not prove bid/ask, slippage, funding, partial fills or intrabar order'
 };
}
export function sizePropDAOForNetStop(input:{
 balanceUsd:number;riskPercent:number;side:'LONG'|'SHORT';
 referenceEntry:number;referenceStop:number;profile:PropDAOCostProfile;
 assumptions:ExecutionAssumptions;entryLiquidity?:PropDAOLiquidity;stopLiquidity?:PropDAOLiquidity
}){
 const {profile,assumptions:a}=input;
 validatePropDAOProfile(profile);validateExecutionAssumptions(a);
 if(!positive(input.balanceUsd)||!positive(input.riskPercent)||input.riskPercent>10||
    !positive(input.referenceEntry)||!positive(input.referenceStop)||
    input.side==='LONG'&&input.referenceStop>=input.referenceEntry||
    input.side==='SHORT'&&input.referenceStop<=input.referenceEntry)
  fail('Invalid account, risk, or protective stop.');
 const riskBudgetUsd=input.balanceUsd*input.riskPercent/100;
 const unit=accountPropDAOTrade({profile,assumptions:a,side:input.side,
  quantity:1,referenceEntry:input.referenceEntry,referenceExit:input.referenceStop,
  exitReason:'stop',entryLiquidity:input.entryLiquidity??'taker',
  exitLiquidity:input.stopLiquidity??'taker'});
 const lossPerUnitUsd=-unit.netPnlUsd;
 if(!positive(lossPerUnitUsd))fail('Stop-loss execution is not a monetary loss.');
 const maxQty=riskBudgetUsd/lossPerUnitUsd;
 // Use the venue's exact quantity increment; floor, NEVER round up.
 const qty=profile.lotStep*Math.floor((maxQty+1e-12)/profile.lotStep);
 const quantity=Number(qty.toFixed(10));
 const constraint=quantity+1e-9<profile.minQuantity?'MINIMUM_QUANTITY':
  profile.minimumNotionalUsd!==null&&
  quantity*input.referenceEntry*profile.contractMultiplier<profile.minimumNotionalUsd?'MINIMUM_NOTIONAL':null;
 if(constraint)return {accepted:false,reason:constraint,
  riskBudgetUsd:fixed(riskBudgetUsd),quantity:0,estimatedStopLossUsd:null,
  lossPerUnitUsd:fixed(lossPerUnitUsd)};
 const stop=accountPropDAOTrade({profile,assumptions:a,side:input.side,
  quantity,referenceEntry:input.referenceEntry,referenceExit:input.referenceStop,
  exitReason:'stop',entryLiquidity:input.entryLiquidity??'taker',exitLiquidity:input.stopLiquidity??'taker'});
 if(-stop.netPnlUsd>riskBudgetUsd+1e-8)
  fail('Rounded size exceeds the risk budget.');
 return {accepted:true,reason:null,riskBudgetUsd:fixed(riskBudgetUsd),
  quantity,estimatedStopLossUsd:fixed(-stop.netPnlUsd),
  lossPerUnitUsd:fixed(lossPerUnitUsd)};
}
