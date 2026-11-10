#!/usr/bin/env node
/** Read-only Cloudflare release audit; never prints tokens, secret bindings or
 * arbitrary Cloudflare API response bodies. Used both before and after deploy.
 * FAIL CLOSED if Cloudflare cannot prove the existing operator entry gate. */
export async function inspectWorker(args={env:process.env,fetcher:fetch}){
 const {env,fetcher}=args;
 const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
 const script='trading-vibes-propdao-live';
 if(!account||!token||!/^[a-zA-Z0-9_-]{8,100}$/.test(account))
  throw Error('Missing Cloudflare read permissions or account configuration');
 const api='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+
  '/workers/scripts/'+encodeURIComponent(script);
 async function request(path){
  const response=await fetcher(api+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},
   signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Cloudflare read failed with HTTP '+response.status+' on '+path);
  const body=await response.json();
  if(body.success!==true)throw Error('Cloudflare did not confirm '+path);
  return body.result;
 }
 const [settings,deployments]=await Promise.all([request('/settings'),request('/deployments')]);
 if(!settings||!Array.isArray(settings.bindings))
  throw Error('Cloudflare settings do not include verifiable bindings');
 const bindings=settings.bindings;
 const plain=key=>bindings.find(b=>b.name===key&&b.type==='plain_text');
 const entry=plain('PROPDAO_LIVE_ENABLED');
 const control=plain('PROPDAO_CONTROL_URL');
 const binding=bindings.find(b=>b.name==='BOTS'&&b.type==='durable_object_namespace');
 const hasSecret=bindings.some(b=>b.name==='PROPDAO_LIVE_INTERNAL_SECRET'&&b.type==='secret_text');
 if(!entry||!['true','false'].includes(entry.text))
  throw Error('Cannot verify the currently active Cloudflare order gate');
 if(!control||control.text!=='https://trading-robots.vercel.app')
  throw Error('Cloudflare control origin differs from the verified production origin');
 if(!binding||binding.class_name!=='PropDAOLiveBot')
  throw Error('Expected BOTS Durable Object binding missing or changed');
 if(!hasSecret)throw Error('Cloudflare internal authorization secret binding missing');
 const records=Array.isArray(deployments)?deployments:
  Array.isArray(deployments?.deployments)?deployments.deployments:[];
 const latest=records[0];
 const active=Array.isArray(latest?.versions)?latest.versions:[];
 if(!latest?.id||active.length!==1||active[0].percentage!==100||!active[0].version_id)
  throw Error('Cloudflare active Worker deployment version is not uniquely verifiable');
 const outcome={script,operatorEntriesEnabled:entry.text==='true',
  doBinding:'BOTS:PropDAOLiveBot',secretBindingPresent:true,
  controlOriginVerified:true,activeDeploymentId:latest.id,
  activeVersionId:active[0].version_id,
  annotatedGitSha:settings.annotations?.['workers/tag']??null,
  checkedAt:new Date().toISOString()};
 if(env.TV_EXPECT_ENTRY_GATE&&String(outcome.operatorEntriesEnabled)!==env.TV_EXPECT_ENTRY_GATE)
  throw Error('Cloudflare entry authorization differs from the approved release gate');
 return outcome;
}
export async function verifyWorkerHealth(args={env:process.env,fetcher:fetch}){
 const {env,fetcher}=args;
 const origin=env.PROPDAO_WORKER_URL||'https://trading-vibes-propdao-live.gtebogo75.workers.dev';
 const url=new URL('/health',origin);
 if(url.protocol!=='https:'||url.origin!==new URL(origin).origin||
    !url.hostname.endsWith('.workers.dev'))throw Error('Unexpected Worker health origin');
 const secret=env.PROPDAO_LIVE_INTERNAL_SECRET;
 if(!secret||secret.length<32)throw Error('Cloudflare internal health secret unavailable');
 const unauth=await fetcher(url,{signal:AbortSignal.timeout(12000)});
 if(unauth.status!==401)throw Error('Worker accepted unauthenticated health request');
 const response=await fetcher(url,{headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(12000)});
 if(response.status!==200)throw Error('Authenticated Worker health returned HTTP '+response.status);
 const state=await response.json();
 if(state.runtime!=='propdao-durable-object'||typeof state.ready!=='boolean')
  throw Error('Unexpected Worker health response');
 if(env.TV_EXPECT_ENTRY_GATE&&String(state.ready)!==env.TV_EXPECT_ENTRY_GATE)
  throw Error('Worker health execution gate differs from approved expected gate');
 if(env.TV_RELEASE_SHA&&state.releaseSha!==env.TV_RELEASE_SHA)
  throw Error('Worker release SHA does not match the deployed commit');
 return {authenticated:true,unauthedRejected:true,operatorReady:state.ready,
  releaseSha:typeof state.releaseSha==='string'?state.releaseSha:null};
}
if(process.argv[1]&&import.meta.url.endsWith('/'+process.argv[1].split('/').at(-1))){
 try{
  const metadata=await inspectWorker();
  const health=await verifyWorkerHealth();
  if(metadata.operatorEntriesEnabled!==health.operatorReady)
   throw Error('Cloudflare bindings and Worker health disagree about execution');
  console.log(JSON.stringify({passed:true,metadata,health},null,2));
 }catch(error){
  console.error('PropDAO release audit FAILED:',error instanceof Error?error.message:'unknown');
  process.exitCode=1;
 }
}
