import {describe,it,expect} from 'vitest';
import {deploymentPreflightReason,type DeploymentPreflight} from './deployment-preflight';
const ready:DeploymentPreflight={accountId:'prop-demo',accountStatus:'active',configured:true,connected:true};
describe('PropDAO deployment preflight UX',()=>{
 it('permits review only when account and Worker prerequisites are met',()=>expect(deploymentPreflightReason(ready)).toBeNull());
 it('explains previously silent disabled states',()=>{
  expect(deploymentPreflightReason({...ready,accountId:''})).toContain('Choose a PropDAO account');
  expect(deploymentPreflightReason({...ready,configured:false})).toContain('Cloudflare runtime');
  expect(deploymentPreflightReason({...ready,statusUnavailable:true})).toContain('unverified');
  expect(deploymentPreflightReason({...ready,pendingIntent:{id:'unresolved'}})).toContain('Reconcile');
  expect(deploymentPreflightReason({...ready,accountStatus:'disabled'})).toContain('not active');
 });
});
