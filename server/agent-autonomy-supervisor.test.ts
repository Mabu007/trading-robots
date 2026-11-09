import {describe,it,expect,vi} from 'vitest';
import {superviseDemoTask} from './agent-autonomy-supervisor.ts';
import {initialTask} from '../shared/agent-task-state.ts';
const now=Date.now(),codeHash='a'.repeat(64);
const task=(()=>{
 const t=initialTask('owner','agenttask_12345','trade gold autonomously',now,80,60,true);
 t.autonomy={enabled:true,stage:'monitoring',stopRequested:false,completedCycles:0,policyRequired:true,botId:'bot_123456789',codeHash};
 t.policy={policyId:'policy_12345678',fingerprint:'b'.repeat(64),accountId:'prop_eval123',expiresAt:now+86400_000,mode:'full-demo',linkedAt:now};
 return t;
})();
const policy={version:1,id:task.policy!.policyId,ownerUid:'owner',venue:'propdao',demoOnly:true,revokedAt:null,
 accountId:task.policy!.accountId,fingerprint:task.policy!.fingerprint,mode:'full-demo',expiresAt:now+86400_000} as any;
const deps=(overrides:any={})=>({
 policy:vi.fn(async()=>policy),
 snapshot:vi.fn(async()=>({account:{status:'active'},risk:{breached:false,roomUsd:20,equity:1000},positions:[],orders:[]})),
 status:vi.fn(async()=>({connected:true,configured:true,running:true,paused:false,activeAuthorization:true,
  accountId:'prop_eval123',codeHash,brokerExposureVerified:true,brokerExposure:'flat'})),
 stop:vi.fn(async()=>({})),now:()=>now,...overrides
});
describe('PropDAO autonomous run-until-stopped supervisor',()=>{
 it('leaves a verified, authorized live demo robot running',async()=>{
  const d=deps(),r=await superviseDemoTask(task,d);
  expect(r.outcome).toBe('running');expect(d.stop).not.toHaveBeenCalled();
 });
 it('stops new entries when user requests stop, even if positions remain open',async()=>{
  const d=deps({status:vi.fn(async()=>({connected:true,configured:true,running:false,paused:false,
   activeAuthorization:false,accountId:'prop_eval123',codeHash,brokerExposure:'open',brokerExposureVerified:true}))});
  const r=await superviseDemoTask({...task,autonomy:{...task.autonomy!,stopRequested:true}},d);
  expect(d.stop).toHaveBeenCalledWith('owner','bot_123456789');
  expect(r).toMatchObject({outcome:'stopped',exposure:'open'});
 });
 it('requires stop and retries when stop acknowledgement is unknown',async()=>{
  const d=deps({stop:vi.fn(async()=>{throw Error('Cloudflare 502')})});
  const r=await superviseDemoTask({...task,autonomy:{...task.autonomy!,stopRequested:true}},d);
  expect(r.outcome).toBe('retry');expect(r.exposure).toBe('unknown');
 });
 it('fails closed and tries stopping on revoked policy, broker breach or unreadable broker',async()=>{
  const d=deps({policy:vi.fn(async()=>({...policy,revokedAt:now}))});
  await superviseDemoTask(task,d);expect(d.stop).toHaveBeenCalled();
  const breached=deps({snapshot:vi.fn(async()=>({...await deps().snapshot(),risk:{breached:true,equity:990,roomUsd:5}}))});
  await superviseDemoTask(task,breached);expect(breached.stop).toHaveBeenCalled();
 });
 it('can derive a candidate robot while STOP races with first activation acknowledgement',async()=>{
  const codeHash='c'.repeat(64);
  const pending={...task,autonomy:{...task.autonomy!,botId:undefined,codeHash:undefined,stopRequested:true},
   memory:{...task.memory,artifacts:[{kind:'evaluation' as const,id:'eval_123456789',codeHash,reviewEligible:true,updatedAt:new Date(now).toISOString()}]}};
  const d=deps({status:vi.fn(async()=>({connected:true,configured:true,running:false,paused:false,
   activeAuthorization:false,brokerExposure:'flat',brokerExposureVerified:true}))});
  await superviseDemoTask(pending,d);
  expect(d.stop).toHaveBeenCalledTimes(1);
  expect(d.stop.mock.calls[0][1]).toMatch(/^autobot_[a-f0-9]{32}$/);
 });
 it('never treats uncertain exposure as zero or silently renews deployment',async()=>{
  const d=deps({status:vi.fn(async()=>({connected:true,configured:true,running:false,brokerExposure:'flat',brokerExposureVerified:false}))});
  const r=await superviseDemoTask(task,d);expect(r).toMatchObject({outcome:'retry',exposure:'unknown'});
 });
});
