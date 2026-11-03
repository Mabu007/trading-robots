import {describe,it,expect} from 'vitest';
import {commissionPerUnitDeposit} from '../shared/ctrader-commission';
const basic={commissionType:2,preciseTradingCommissionRate:15*1e8,preciseMinCommission:0,minCommissionAsset:'USD',minCommissionType:1,lotSize:10000,minVolume:100,executionPrice:3000,quoteToDeposit:1,usdToDeposit:1,baseToUsd:3000};
describe('broker commission calculations',()=>{
 it('applies two-sided USD-per-lot fees over true instrument units',()=>expect(commissionPerUnitDeposit(basic)).toBeCloseTo(.3));
 it('converts USD commissions to the account currency',()=>expect(commissionPerUnitDeposit({...basic,usdToDeposit:18})).toBeCloseTo(5.4));
 it('applies quote-currency per-lot model',()=>expect(commissionPerUnitDeposit({...basic,commissionType:4,quoteToDeposit:2})).toBeCloseTo(.6));
 it('rejects an unsupported broker fee model',()=>expect(()=>commissionPerUnitDeposit({...basic,commissionType:99})).toThrow());
 it('includes minimum fees conservatively per smallest lot',()=>expect(commissionPerUnitDeposit({...basic,preciseMinCommission:4*1e8})).toBeGreaterThanOrEqual(8));
});
