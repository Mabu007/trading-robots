import { expect,it } from 'vitest';
import { validatePropDAORisk } from '../shared/propdao-risk';
const base={status:'active',breached:false,roomUsd:100,availableMargin:1000,side:'BUY' as const,entry:100,stop:90,quantity:2,lotStep:0.1,leverage:2,maxLeverage:2,takerFeeRate:0.001,userRiskLimitUsd:30};
it('includes both fees in planned loss and margin',()=>{expect(validatePropDAORisk(base)).toMatchObject({ok:true,plannedLoss:20.38,requiredMargin:100})});
it('rejects ineligible, breached and exhausted accounts',()=>{for(const value of [{status:'failed'},{breached:true},{roomUsd:20}])expect(validatePropDAORisk({...base,...value}).ok).toBe(false)});
it('rejects invalid stop, quantity, leverage, margin and unknown cost data',()=>{for(const value of [{stop:110},{quantity:2.05},{leverage:3},{availableMargin:99},{takerFeeRate:NaN}])expect(validatePropDAORisk({...base,...value}).ok).toBe(false)});
