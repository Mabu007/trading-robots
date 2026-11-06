import {timingSafeEqual} from 'node:crypto';
export type Phase2Flag='AI_SDK_STRATEGY_APPROVAL_ENABLED'|'AI_SDK_SERVER_BACKTEST_ENABLED';
/** Test identity gates never authorize live trades. They only unlock a
 * read-only simulated backtest or exact reviewed strategy edit for a
 * single signed Firebase user. Production rollouts must use explicit flags.
 */
export function phase2QaHeaderAuthorized(uid:string,header:unknown,env:NodeJS.ProcessEnv=process.env){
 if(env.PHASE2_E2E_ENABLED!=='true'||typeof uid!=='string'||!/^[A-Za-z0-9_-]{10,128}$/.test(uid))return false;
 const expected=env.PHASE2_E2E_SECRET;
 if(typeof expected!=='string'||!/^[a-f0-9]{32,128}$/.test(expected)||typeof header!=='string'||header.length!==expected.length)return false;
 const until=Date.parse(env.PHASE2_E2E_EXPIRES_AT||'');
 if(!Number.isFinite(until)||Date.now()>=until)return false;
 return timingSafeEqual(Buffer.from(header),Buffer.from(expected));
}
export function phase2FeatureEnabled(uid:string,flag:Phase2Flag,env:NodeJS.ProcessEnv=process.env,qaHeader?:unknown){
 if(env[flag]==='true')return true;
 if(phase2QaHeaderAuthorized(uid,qaHeader,env))return true;
 return Boolean(env.PHASE2_E2E_ENABLED==='true'&&
   typeof uid==='string'&&/^[A-Za-z0-9_-]{10,128}$/.test(uid)&&
   uid===env.PHASE2_E2E_UID);
}
export function phase2SharedModelTestEnabled(uid:string,env:NodeJS.ProcessEnv=process.env,qaHeader?:unknown){
 if(env.PHASE2_E2E_ALLOW_SHARED_MODEL!=='true')return false;
 if(phase2QaHeaderAuthorized(uid,qaHeader,env))return true;
 return Boolean(env.PHASE2_E2E_ALLOW_SHARED_MODEL==='true'&&
 env.PHASE2_E2E_ENABLED==='true'&&
 typeof uid==='string'&&/^[A-Za-z0-9_-]{10,128}$/.test(uid)&&
 uid===env.PHASE2_E2E_UID);
}
