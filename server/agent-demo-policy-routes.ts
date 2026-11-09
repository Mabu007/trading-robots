import type {Express,Request,Response} from 'express';
import {z} from 'zod';
import {DemoPolicyStore,demoPolicyInput} from './agent-demo-policy.ts';
import type {RecordStore} from './firestore-store.ts';
import type {PropDAOAccounts} from './propdao-account.ts';

type Dependencies={
 uid:(req:Request,res:Response)=>Promise<string|null>;
 store:RecordStore;
 accounts:Pick<PropDAOAccounts,'snapshot'>;
 configured:()=>boolean;
};
const policyId=z.string().uuid();
export function agentDemoPolicyRoutes(app:Express,deps:Dependencies){
 const policies=new DemoPolicyStore(deps.store);
 app.get('/api/agent-policies',async(req,res)=>{
  const uid=await deps.uid(req,res);if(!uid)return;
  if(!deps.configured())return res.status(503).json({error:'Policy storage is unavailable'});
  try{return res.json({policies:await policies.list(uid),demoOnly:true,automaticExecutionEnabled:false})}
  catch{return res.status(503).json({error:'Could not verify your policies'})}
 });
 app.post('/api/agent-policies',async(req,res)=>{
  const uid=await deps.uid(req,res);if(!uid)return;
  res.setHeader('Cache-Control','no-store');
  if(!deps.configured())return res.status(503).json({error:'Policy storage is unavailable'});
  const input=demoPolicyInput.safeParse(req.body);
  if(!input.success)return res.status(400).json({error:'Choose a valid explicit DEMO authorization scope, expiry and confirmation phrase.'});
  try{
   const snapshot=await deps.accounts.snapshot(uid,input.data.accountId);
   const broker={simulated:snapshot.simulated===true,owned:true,status:String(snapshot.account?.status||''),
    breached:snapshot.risk?.breached===true,roomUsd:Number(snapshot.risk?.roomUsd)};
   const policy=await policies.create(uid,input.data,broker);
   return res.status(201).json({policy,executionEnabled:false,
    notice:'Standing research/deployment scope recorded. Actual demo autonomous execution remains disabled until independent broker-risk integration tests and the execution feature gate pass.'});
  }catch(error){return res.status(409).json({error:error instanceof Error?error.message:'Could not verify the demo account'})}
 });
 app.post('/api/agent-policies/:id/revoke',async(req,res)=>{
  const uid=await deps.uid(req,res);if(!uid)return;
  res.setHeader('Cache-Control','no-store');
  const id=policyId.safeParse(req.params.id);
  if(!id.success)return res.status(400).json({error:'Invalid policy ID'});
  if(!deps.configured())return res.status(503).json({error:'Policy storage is unavailable'});
  try{
   const policy=await policies.revoke(uid,id.data);
   return res.json({policy,futureAgentDeploymentPermissionRevoked:true,
    existingRobotRuntimeStopVerified:false,brokerExposure:'unknown',
    warning:'Standing agent permission is revoked. This action does NOT confirm that any previously deployed robot has stopped or that existing positions or resting orders are closed. Use the independent deployment stop and broker reconciliation controls.'});
  }catch(error){return res.status(409).json({error:error instanceof Error?error.message:'Policy revocation could not be verified'})}
 });
}
