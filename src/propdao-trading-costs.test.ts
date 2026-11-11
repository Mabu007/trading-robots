import {describe,it,expect} from 'vitest';
import {accountPropDAOTrade,explicitPropDAOAssumptions,propDAOProfileFromMarkets,sizePropDAOForNetStop,reconcilePropDAOBrokerCostEvidence} from './propdao-trading-costs';
const profile=propDAOProfileFromMarkets('GOLDUSDC',{
 fees:{maker:0.00015,taker:0.00045},
 data:[{symbol:'GOLDUSDC',lotStep:0.0001,minQty:0.0001,contractMultiplier:1}]
});
const assumptions=explicitPropDAOAssumptions({spreadPrice:0.2,entrySlippagePrice:0.1,stopSlippagePrice:0.2,
 targetSlippagePrice:0.1,endSlippagePrice:0.1,fundingUsdPerUnit:0},
 'Disclosed OHLC execution assumptions; not live quotes');
const trade={profile,assumptions,side:'LONG' as const,quantity:0.2,referenceEntry:4000,
 referenceExit:4001,exitReason:'target' as const,entryLiquidity:'taker' as const,exitLiquidity:'taker' as const};
describe('PropDAO cost accounting',()=>{
 it('does not assume an absent venue fee profile',()=>{
  expect(()=>propDAOProfileFromMarkets('GOLDUSDC',{data:[{symbol:'GOLDUSDC',lotStep:.1}]})).toThrow();
 });
 it('computes fee-aware net performance from executed notional',()=>{
  const result=accountPropDAOTrade(trade);
  expect(result.grossPnlUsd).toBeGreaterThan(0);
  expect(result.netPnlUsd).toBeLessThan(0);
  expect(result.netPnlUsd).toBeCloseTo(result.grossPnlUsd-result.commissionUsd-result.fundingUsd);
  expect(result.grossReferenceUsd-result.grossPnlUsd).toBeCloseTo(result.spreadImpactUsd+result.slippageImpactUsd);
 });
 it('charges twice on maker or taker fills, at respective execution prices',()=>{
  const result=accountPropDAOTrade(trade);
  expect(result.entryCommissionUsd).toBeCloseTo(result.entry*trade.quantity*.00045);
  expect(result.exitCommissionUsd).toBeCloseTo(result.exit*trade.quantity*.00045);
  const maker=accountPropDAOTrade({...trade,entryLiquidity:'maker',exitLiquidity:'maker'});
  expect(maker.commissionUsd).toBeLessThan(result.commissionUsd);
 });
 it('sizes quantity so expected loss including fees fits risk budget',()=>{
  const sizing=sizePropDAOForNetStop({balanceUsd:1000,riskPercent:1,side:'LONG',referenceEntry:4000,
   referenceStop:3994,profile,assumptions});
  expect(sizing.accepted).toBe(true);
  expect(sizing.estimatedStopLossUsd).toBeLessThanOrEqual(10+1e-8);
 });
});

describe('PropDAO broker trade cost evidence',()=>{
 it('reconciles net against gross and paid fee legs without double subtraction',()=>{
  const result=reconcilePropDAOBrokerCostEvidence({symbol:'GOLDUSDC',qty:.2,entry:4000,
   exit:4001,grossPnl:.2,pnl:-.52209,openFee:.36,closeFee:.36009,
   fee:.72009,fundingPaid:.002,exitLiquidity:'taker'});
  expect(result.brokerReportedNetPnlUsd).toBeCloseTo(-.52209);
  expect(result.brokerReportedTotalFeesUsd).toBeCloseTo(.72009);
  expect(result.grossToNetReconciled).toBe(true);
  expect(result.feeLegsReconciled).toBe(true);
  expect(result.accounting).toContain('no fee re-deduction');
 });
 it('retains unknown gross or funding rather than inventing zero',()=>{
  const result=reconcilePropDAOBrokerCostEvidence({symbol:'GOLDUSDC',qty:.2,entry:4000,
   exit:4001,pnl:-.6,fee:.8});
  expect(result.brokerReportedGrossPnlUsd).toBeNull();
  expect(result.brokerReportedFundingUsd).toBeNull();
  expect(result.grossToNetReconciled).toBeNull();
 });
});
