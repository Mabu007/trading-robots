import test from 'node:test';
import assert from 'node:assert/strict';
import {rollbackWorker} from './rollback-propdao-worker.mjs';
const old='11111111-1111-4111-8111-111111111111';
const latest='22222222-2222-4222-8222-222222222222';
const env={GITHUB_ACTIONS:'true',PREVIOUS_VERSION:old,DEPLOYED_VERSION:latest,
 TV_EXPECT_ENTRY_GATE:'true',CLOUDFLARE_ACCOUNT_ID:'account-test',CLOUDFLARE_API_TOKEN:'token'};
test('rolls back only the known deployed Worker version, keeping the gate unchanged',async()=>{
 const statuses=[{activeVersionId:latest,operatorEntriesEnabled:true},
  {activeVersionId:old,operatorEntriesEnabled:true}];
 const inspected=[],posted=[];
 const result=await rollbackWorker({env,inspector:async()=>{const v=statuses.shift();inspected.push(v);return v},
  fetcher:async(url,init)=>{posted.push({url,init});return {ok:true,status:200,json:async()=>({success:true})}}});
 assert.equal(result.rollbackVerified,true);
 assert.equal(inspected.length,2);
 assert.equal(posted.length,1);
 assert.equal(posted[0].init.method,'POST');
 assert.deepEqual(JSON.parse(posted[0].init.body),{
  strategy:'percentage',versions:[{version_id:old,percentage:100}]});
});
test('refuses rollback if an operator changed the active Worker version',async()=>{
 let posts=0;
 await assert.rejects(rollbackWorker({env,inspector:async()=>({
  activeVersionId:'33333333-3333-4333-8333-333333333333',operatorEntriesEnabled:true}),
  fetcher:async()=>{posts++;return {ok:true}}}),/changed again/);
 assert.equal(posts,0);
});
test('refuses rollback when entry authorization is not independently verified',async()=>{
 await assert.rejects(rollbackWorker({env,inspector:async()=>({
  activeVersionId:latest,operatorEntriesEnabled:false})}),/gate changed/);
});
test('refuses manual or malformed rollback without a verified prior version',async()=>{
 await assert.rejects(rollbackWorker({env:{...env,GITHUB_ACTIONS:'false'}}),/validated/);
 await assert.rejects(rollbackWorker({env:{...env,PREVIOUS_VERSION:'not-a-uuid'}}),/validated/);
});
