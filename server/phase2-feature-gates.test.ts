import {describe,it,expect} from 'vitest';
import {phase2FeatureEnabled,phase2SharedModelTestEnabled} from './phase2-feature-gates.ts';
const uid='firebaseTestUid_0123456789',other='firebaseOtherUid_0123456789';
const env={PHASE2_E2E_ENABLED:'true',PHASE2_E2E_UID:uid,PHASE2_E2E_ALLOW_SHARED_MODEL:'true'} as NodeJS.ProcessEnv;
describe('Phase 2 account-scoped release controls',()=>{
 it('keeps all new functionality disabled by default',()=>{
  expect(phase2FeatureEnabled(uid,'AI_SDK_SERVER_BACKTEST_ENABLED',{})).toBe(false);
  expect(phase2FeatureEnabled(uid,'AI_SDK_STRATEGY_APPROVAL_ENABLED',{})).toBe(false);
  expect(phase2SharedModelTestEnabled(uid,{})).toBe(false);
 });
 it('allows only the exact signed-in verification user',()=>{
  expect(phase2FeatureEnabled(uid,'AI_SDK_STRATEGY_APPROVAL_ENABLED',env)).toBe(true);
  expect(phase2FeatureEnabled(other,'AI_SDK_STRATEGY_APPROVAL_ENABLED',env)).toBe(false);
  expect(phase2SharedModelTestEnabled(uid,env)).toBe(true);
  expect(phase2SharedModelTestEnabled(other,env)).toBe(false);
 });
 it('requires a separate shared-model credit flag for the verification user',()=>{
  expect(phase2SharedModelTestEnabled(uid,{...env,PHASE2_E2E_ALLOW_SHARED_MODEL:'false'})).toBe(false);
  expect(phase2FeatureEnabled(uid,'AI_SDK_SERVER_BACKTEST_ENABLED',{...env,PHASE2_E2E_ENABLED:'false'})).toBe(false);
 });
 it('explicit global flags work without test mode',()=>{
  expect(phase2FeatureEnabled(other,'AI_SDK_SERVER_BACKTEST_ENABLED',{AI_SDK_SERVER_BACKTEST_ENABLED:'true'})).toBe(true);
 });
});