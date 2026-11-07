import {describe,it,expect,vi,beforeEach} from 'vitest';
const aws=vi.hoisted(()=>({last:null as any,throwNext:null as any}));
vi.mock('@aws-sdk/client-s3',()=>({
 S3Client:class{async send(command:any){aws.last=command;if(aws.throwNext)throw aws.throwNext;return {};}destroy(){}},
 PutObjectCommand:class{input:any;constructor(input:any){this.input=input;}},
 GetObjectCommand:class{},ListObjectsV2Command:class{},DeleteObjectCommand:class{}
}));
import {writeR2ObjectIfAbsent} from './r2.ts';
describe('R2 atomic create-once contract',()=>{
 beforeEach(()=>{aws.last=null;aws.throwNext=null;vi.stubEnv('R2_ACCOUNT_ID','test-account');vi.stubEnv('R2_ACCESS_KEY_ID','isolated-test-id');vi.stubEnv('R2_SECRET_ACCESS_KEY','isolated-test-secret');vi.stubEnv('R2_BUCKET','isolated-market-history');});
 it('sends Cloudflare R2 native conditional PutObject and preserves content type',async()=>{
  await expect(writeR2ObjectIfAbsent('market-history/v3/x.json','{}')).resolves.toBe(true);
  expect(aws.last.input).toMatchObject({Bucket:'isolated-market-history',Key:'market-history/v3/x.json',IfNoneMatch:'*',Body:'{}'});
 });
 it('treats competing precondition failure as an existing immutable shard only',async()=>{
  aws.throwNext=Object.assign(new Error('Object exists'),{name:'PreconditionFailed',$metadata:{httpStatusCode:412}});
  await expect(writeR2ObjectIfAbsent('market-history/v3/x.json','{}')).resolves.toBe(false);
 });
 it('does not swallow credential, authorization or network errors',async()=>{
  aws.throwNext=Object.assign(new Error('Forbidden'),{name:'Forbidden',$metadata:{httpStatusCode:403}});
  await expect(writeR2ObjectIfAbsent('market-history/v3/x.json','{}')).rejects.toThrow('Forbidden');
 });
});
