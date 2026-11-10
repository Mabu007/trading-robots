#!/usr/bin/env node
/** Only executed after a successful guarded upload followed by a failed
 * postflight. Restores the independently verified previous Worker version.
 * Never attempts to change the entry gate or print any secrets. */
import {inspectWorker} from './verify-propdao-worker.mjs';
const env=process.env;
try {
 const previous=env.PREVIOUS_VERSION;
 if(env.GITHUB_ACTIONS!=='true'||!previous||
    !/^[a-f0-9-]{36}$/.test(previous)||env.TV_EXPECT_ENTRY_GATE!=='true'&&env.TV_EXPECT_ENTRY_GATE!=='false')
  throw Error('Rollback lacks a validated earlier release and operator gate');
 const active=await inspectWorker();
 if(active.activeVersionId===previous)
  throw Error('The previous Worker is already active; refusing an unnecessary rollback');
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+
  encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)+'/workers/scripts/trading-vibes-propdao-live/deployments',{
   method:'POST',headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,
    'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({strategy:'percentage',versions:[{version_id:previous,percentage:100}]}),
   signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Cloudflare refused rollback with HTTP '+response.status);
 const data=await response.json();
 if(data.success!==true)throw Error('Cloudflare did not acknowledge rollback');
 const after=await inspectWorker();
 if(after.activeVersionId!==previous||after.operatorEntriesEnabled!==active.operatorEntriesEnabled)
  throw Error('Rollback verification incomplete; inspect Cloudflare immediately');
 console.log('Rollback VERIFIED: previous Worker version restored, entry gate unchanged.');
} catch (error) {
 console.error('Rollback needs operator review:',error instanceof Error?error.message:'unknown');
 process.exitCode=1;
}
