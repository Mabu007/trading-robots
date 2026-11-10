import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWorker,verifyWorkerHealth} from './verify-propdao-worker.mjs';

const ready={name:'PROPDAO_LIVE_ENABLED',type:'plain_text',text:'true'};
const control={name:'PROPDAO_CONTROL_URL',type:'plain_text',text:'https://trading-robots.vercel.app'};
const bots={name:'BOTS',type:'durable_object_namespace',class_name:'PropDAOLiveBot'};
const secret={name:'PROPDAO_LIVE_INTERNAL_SECRET',type:'secret_text'};
const settings={bindings:[ready,control,bots,secret]};
const versions={deployments:[{id:'deploy-original',versions:[{version_id:'version-1',percentage:100}]}]};
const env={CLOUDFLARE_ACCOUNT_ID:'0123456789abcdef',CLOUDFLARE_API_TOKEN:'token',
 PROPDAO_LIVE_INTERNAL_SECRET:'x'.repeat(40),
 TV_EXPECT_ENTRY_GATE:'true',PROPDAO_WORKER_URL:'https://trading-vibes-propdao-live.gtebogo75.workers.dev'};
function fakeCloudflare(bindingList=settings.bindings,deployments=versions){
 const reads=[];
 const fetcher=async url=>{
  reads.push(url);
  const body=String(url).endsWith('/settings')?{bindings:bindingList}:deployments;
  return {ok:true,status:200,json:async()=>({success:true,result:body})};
 };
 return {fetcher,reads};
}
test('reports live gate, DO and version without disclosing bindings values',async()=>{
 const {fetcher,reads}=fakeCloudflare();
 const value=await inspectWorker({env,fetcher});
 assert.equal(value.operatorEntriesEnabled,true);
 assert.equal(value.activeVersionId,'version-1');
 assert.equal(value.doBinding,'BOTS:PropDAOLiveBot');
 assert.equal(reads.length,2);
 assert.equal(JSON.stringify(value).includes(env.CLOUDFLARE_API_TOKEN),false);
});
test('fails closed when the operator entry gate differs from the expected gate',async()=>{
 const {fetcher}=fakeCloudflare([{...ready,text:'false'},control,bots,secret]);
 await assert.rejects(inspectWorker({env,fetcher}),/entry authorization differs/);
});
test('fails without the required DO or authentication binding',async()=>{
 for(const omitted of ['BOTS','PROPDAO_LIVE_INTERNAL_SECRET']){
  const {fetcher}=fakeCloudflare(settings.bindings.filter(b=>b.name!==omitted));
  await assert.rejects(inspectWorker({env,fetcher}),/binding/i);
 }
});
test('refuses ambiguous traffic splits instead of guessing the current version',async()=>{
 const {fetcher}=fakeCloudflare(settings.bindings,{deployments:[{id:'deploy-2',
  versions:[{version_id:'v1',percentage:80},{version_id:'v2',percentage:20}]}]});
 await assert.rejects(inspectWorker({env,fetcher}),/not uniquely verifiable/);
});
test('health requires unauthenticated 401 and checks the exact operator gate',async()=>{
 const seen=[];
 const fetcher=async (_url,options={})=>{
  seen.push(options.headers?.Authorization??'none');
  if(!options.headers?.Authorization)return {status:401};
  return {status:200,json:async()=>({runtime:'propdao-durable-object',ready:true,releaseSha:'sha1'})};
 };
 const result=await verifyWorkerHealth({env,fetcher});
 assert.deepEqual(result,{authenticated:true,unauthedRejected:true,operatorReady:true,releaseSha:'sha1'});
 assert.equal(seen.length,2);
 assert.equal(seen[0],'none');
});
test('health refuses mismatched release SHA, missing auth, and disabled entries',async()=>{
 const fetcher=async(_url,opts={})=>opts.headers?
  {status:200,json:async()=>({runtime:'propdao-durable-object',ready:false,releaseSha:'bad'})}:{status:401};
 await assert.rejects(verifyWorkerHealth({env:{...env,TV_RELEASE_SHA:'expected'},fetcher}),/execution gate/);
 await assert.rejects(verifyWorkerHealth({env:{...env,PROPDAO_LIVE_INTERNAL_SECRET:'short'},fetcher}),/secret unavailable/);
});
