#!/usr/bin/env node
/** Guarded rollback of the just-updated Worker version after postflight.
 * No secrets are printed, and the previous version must be explicitly supplied.
 * This is not a broker order command and never alters risk permissions. */
import {inspectWorker} from './verify-propdao-worker.mjs';

export async function rollbackWorker(args={}){
 const env=args.env??process.env,request=args.fetcher??fetch;
 const inspect=args.inspector??((opts)=>inspectWorker(opts));
 const previous=env.PREVIOUS_VERSION;
 if(env.GITHUB_ACTIONS!=='true'||!previous||
    !/^[a-f0-9-]{36}$/.test(previous)||!['true','false'].includes(env.TV_EXPECT_ENTRY_GATE))
  throw Error('Rollback lacks a validated earlier version and operator gate');
 const active=await inspect({env,fetcher:request});
 if(active.activeVersionId===previous)
  throw Error('Previous Worker is already active; do not create a new deployment');
 if(active.operatorEntriesEnabled!==Boolean(env.TV_EXPECT_ENTRY_GATE==='true'))
  throw Error('Operator entry gate changed; refusing automatic rollback');
 // GitHub serializes its deploy jobs. This additionally refuses a Cloudflare
 // update whose active version has changed since our deploy step verified it.
 if(env.DEPLOYED_VERSION&&active.activeVersionId!==env.DEPLOYED_VERSION)
  throw Error('Worker version changed again; human reconciliation required');
 const response=await request('https://api.cloudflare.com/client/v4/accounts/'+
  encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)+'/workers/scripts/trading-vibes-propdao-live/deployments',{
   method:'POST',headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,
    'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({strategy:'percentage',versions:[{version_id:previous,percentage:100}]}),
   signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Cloudflare refused rollback with HTTP '+response.status);
 const data=await response.json();
 if(data.success!==true)throw Error('Cloudflare did not acknowledge rollback');
 const after=await inspect({env,fetcher:request});
 if(after.activeVersionId!==previous||
    after.operatorEntriesEnabled!==active.operatorEntriesEnabled)
  throw Error('Rollback verification incomplete; inspect Cloudflare immediately');
 return {rollbackVerified:true,operatorEntriesEnabled:after.operatorEntriesEnabled,
  restoredVersionId:previous};
}
if(process.argv[1]&&import.meta.url.endsWith('/'+process.argv[1].split('/').at(-1))){
 try{
  const result=await rollbackWorker();
  console.log('Previous Cloudflare Worker version restored, gate unchanged.',
   JSON.stringify(result));
 }catch(error){
  console.error('Rollback needs operator review:',error instanceof Error?error.message:'unknown');
  process.exitCode=1;
 }
}
