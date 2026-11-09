/**
 * Authority to stop autonomous entries belongs to deterministic server code,
 * never a language model. All outcomes are for the existing PropDAO broker
 * runtime; no new order endpoint is introduced.
 */
import type {TaskRecord} from '../shared/agent-task-state.ts';
import type {DemoPolicy} from './agent-demo-policy.ts';
import {summarizeDeploymentState} from './agent-task-monitor.ts';
export type SupervisionOutcome={
 outcome:'running'|'stopped'|'retry'|'research'|'halted';
 botId?:string;codeHash?:string;exposure:'open'|'pending'|'flat'|'unknown';message:string;
};
export type SupervisorDeps={
 policy:(uid:string,id:string)=>Promise<DemoPolicy>;
 snapshot:(uid:string,accountId:string)=>Promise<{
  account:{status:string};risk:{breached:boolean;roomUsd:number;equity:number};positions:unknown[];orders:unknown[];
 }>;
 status:(uid:string,botId:string)=>Promise<unknown>;
 stop:(uid:string,botId:string)=>Promise<unknown>;
 now?:()=>number;
};
export async function superviseDemoTask(task:TaskRecord,deps:SupervisorDeps):Promise<SupervisionOutcome>{
 const id=task.autonomy?.botId,uid=task.ownerUid,now=(deps.now||Date.now)();
 if(!task.autonomy?.enabled) return {outcome:'halted',exposure:'unknown',message:'Autonomy is not enabled on this task'};
 if(!id)return {outcome:task.autonomy.stopRequested?'stopped':'research',exposure:'unknown',message:'No robot has been activated'};
 const fallback=(outcome:SupervisionOutcome['outcome'],message:string):SupervisionOutcome=>({
  outcome,botId:id,codeHash:task.autonomy?.codeHash,exposure:'unknown',message
 });
 let verifiedPolicy=false,brokerBreached=false;
 if(!task.autonomy.stopRequested){
  try{
   if(!task.policy)throw Error('No standing policy');
   const p=await deps.policy(uid,task.policy.policyId);
   verifiedPolicy=p.ownerUid===uid&&p.demoOnly===true&&p.venue==='propdao'&&p.revokedAt===null&&
    p.accountId===task.policy.accountId&&p.fingerprint===task.policy.fingerprint&&
    p.expiresAt>now&&p.mode===task.policy.mode;
  }catch{verifiedPolicy=false}
  if(verifiedPolicy&&task.policy){
   try{
    const state=await deps.snapshot(uid,task.policy.accountId);
    brokerBreached=state.risk.breached||state.account.status!=='active'||
     !Number.isFinite(state.risk.roomUsd)||state.risk.roomUsd<=0||
     !Number.isFinite(state.risk.equity)||!Array.isArray(state.positions)||!Array.isArray(state.orders);
   }catch{brokerBreached=true}
  }
 }
 const mustStop=task.autonomy.stopRequested||!verifiedPolicy||brokerBreached;
 if(mustStop){
  try{await deps.stop(uid,id)}
  catch{return fallback('retry','Stop requested but the existing PropDAO runtime did not acknowledge it; status remains unverified. No new deployment is permitted.')}
  try{
   const raw=await deps.status(uid,id),view=summarizeDeploymentState(raw,now);
   if(view.running===false&&view.paused===false&&view.authorizationActive===false&&view.available)
    return {...fallback('stopped','New entries are stopped. Existing broker exposure still requires reconciliation.'),exposure:view.brokerExposure};
  }catch{}
  return fallback('retry','Stop response received, but runtime revocation cannot be verified. Retry supervision.');
 }
 try{
  const raw=await deps.status(uid,id),view=summarizeDeploymentState(raw,now);
  if(!view.available||view.authorizationActive===null||view.brokerExposure==='unknown')
   return fallback('retry','Runtime or broker position data is uncertain; no replacement or fresh order authorization is permitted.');
  if(view.accountId!==task.policy?.accountId||view.codeHash!==task.autonomy?.codeHash)
   return fallback('halted','Runtime authorization belongs to a different account or source revision.');
  if(view.running===true&&view.authorizationActive===true)
   return {outcome:'running',botId:id,codeHash:view.codeHash||undefined,exposure:view.brokerExposure,
    message:'Existing PropDAO Durable Object is evaluating candles. Broker exposure verified.'};
  if(view.running===false&&view.authorizationActive===false&&view.brokerExposure==='flat'&&!view.pendingIntent)
   return {outcome:'research',botId:id,codeHash:view.codeHash||undefined,exposure:'flat',
    message:'Previous broker authorization expired or stopped and account is flat; research/renewal can proceed.'};
  return {...fallback('retry','Robot not confirmed running or safe to replace; wait and reconcile.'),exposure:view.brokerExposure};
 }catch{return fallback('retry','Could not inspect active broker runtime; assume exposure unknown and preserve existing authorization.')}
}
