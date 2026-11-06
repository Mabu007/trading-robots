export type Phase2Flag='AI_SDK_STRATEGY_APPROVAL_ENABLED'|'AI_SDK_SERVER_BACKTEST_ENABLED';
/** Test identity gates never authorize live trades. They only unlock a
 * read-only simulated backtest or exact reviewed strategy edit for a
 * single signed Firebase user. Production rollouts must use explicit flags.
 */
export function phase2FeatureEnabled(uid:string,flag:Phase2Flag,env:NodeJS.ProcessEnv=process.env){
 if(env[flag]==='true')return true;
 return Boolean(env.PHASE2_E2E_ENABLED==='true'&&
   typeof uid==='string'&&/^[A-Za-z0-9_-]{10,128}$/.test(uid)&&
   uid===env.PHASE2_E2E_UID);
}
export function phase2SharedModelTestEnabled(uid:string,env:NodeJS.ProcessEnv=process.env){
 return Boolean(env.PHASE2_E2E_ALLOW_SHARED_MODEL==='true'&&
 env.PHASE2_E2E_ENABLED==='true'&&
 typeof uid==='string'&&/^[A-Za-z0-9_-]{10,128}$/.test(uid)&&
 uid===env.PHASE2_E2E_UID);
}
