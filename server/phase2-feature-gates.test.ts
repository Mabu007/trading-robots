import {describe,it,expect} from 'vitest';
import {phase2FeatureEnabled,phase2SharedModelTestEnabled,phase2QaHeaderAuthorized} from './phase2-feature-gates.ts';
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
describe('Protected expiring QA header rollout',()=>{
 const secret='0123456789abcdef0123456789abcdef';
 const scoped={PHASE2_E2E_ENABLED:'true',PHASE2_E2E_SECRET:secret,PHASE2_E2E_EXPIRES_AT:'2099-01-01T00:00:00Z',PHASE2_E2E_ALLOW_SHARED_MODEL:'true'} as NodeJS.ProcessEnv;
 it('requires exact header, valid UID and explicit expiration',()=>{
  expect(phase2QaHeaderAuthorized('qaUser0123456',secret,scoped)).toBe(true);
  expect(phase2QaHeaderAuthorized('qaUser0123456',secret.slice(1),scoped)).toBe(false);
  expect(phase2QaHeaderAuthorized('qaUser0123456',undefined,scoped)).toBe(false);
  expect(phase2QaHeaderAuthorized('bad/uid',secret,scoped)).toBe(false);
  expect(phase2QaHeaderAuthorized('qaUser0123456',secret,{...scoped,PHASE2_E2E_EXPIRES_AT:'2020-01-01T00:00:00Z'})).toBe(false);
 });
 it('exposes read-only simulation or reviewed strategy updates only for verified QA header',()=>{
  expect(phase2FeatureEnabled('qaUser0123456','AI_SDK_SERVER_BACKTEST_ENABLED',scoped,secret)).toBe(true);
  expect(phase2FeatureEnabled('qaUser0123456','AI_SDK_STRATEGY_APPROVAL_ENABLED',scoped,secret)).toBe(true);
  expect(phase2FeatureEnabled('qaUser0123456','AI_SDK_SERVER_BACKTEST_ENABLED',scoped)).toBe(false);
  expect(phase2SharedModelTestEnabled('qaUser0123456',scoped,secret)).toBe(true);
  expect(phase2SharedModelTestEnabled('qaUser0123456',{...scoped,PHASE2_E2E_ALLOW_SHARED_MODEL:'false'},secret)).toBe(false);
 });
});
