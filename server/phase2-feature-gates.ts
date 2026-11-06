import {timingSafeEqual} from 'node:crypto';
export type Phase2Flag='AI_SDK_STRATEGY_APPROVAL_ENABLED'|'AI_SDK_SERVER_BACKTEST_ENABLED';
/** QA permissions apply only to one signed-in Firebase UID until the configured expiry.
 * They authorize a simulated backtest or reviewed code edit, never live trades.
 */
function phase2QaIdentityAuthorized(uid:string,env:NodeJS.ProcessEnv){
 const until=Date.parse(env.PHASE2_E2E_EXPIRES_AT||'');
 return env.PHASE2_E2E_ENABLED==='true'&&
  typeof uid==='string'&&/^[A-Za-z0-9_-]{10,128}$/.test(uid)&&
  uid===env.PHASE2_E2E_UID&&
  Number.isFinite(until)&&Date.now()<until;
}
export function phase2QaHeaderAuthorized(uid:string,header:unknown,env:NodeJS.ProcessEnv=process.env){
 if(!phase2QaIdentityAuthorized(uid,env))return false;
 const expected=env.PHASE2_E2E_SECRET;
 if(typeof expected!=='string'||!/^[a-f0-9]{32,128}$/.test(expected)||typeof header!=='string'||header.length!==expected.length)return false;
 return timingSafeEqual(Buffer.from(header),Buffer.from(expected));
}
export function phase2FeatureEnabled(uid:string,flag:Phase2Flag,env:NodeJS.ProcessEnv=process.env,qaHeader?:unknown){
 if(env[flag]==='true')return true;
 if(!phase2QaIdentityAuthorized(uid,env))return false;
 return !env.PHASE2_E2E_SECRET||phase2QaHeaderAuthorized(uid,qaHeader,env);
}
export function phase2SharedModelTestEnabled(uid:string,env:NodeJS.ProcessEnv=process.env,qaHeader?:unknown){
 if(env.PHASE2_E2E_ALLOW_SHARED_MODEL!=='true'||!phase2QaIdentityAuthorized(uid,env))return false;
 return !env.PHASE2_E2E_SECRET||phase2QaHeaderAuthorized(uid,qaHeader,env);
}
