/** Safe read-only projection of an existing revision-bound PropDAO runtime.
 * No deployment/stop/execute method is reachable through this module.
 */
export type DeploymentObservation={
 available:boolean;asOf:string;running:boolean|null;paused:boolean|null;
 uncertain:boolean;brokerExposure:'open'|'pending'|'flat'|'unknown';brokerExposureVerified:boolean;
 authorizationActive:boolean|null;accountId:string|null;codeHash:string|null;
 pendingIntent:boolean;grantExpiresAt:number|null;error:string|null;
};
export function summarizeDeploymentState(raw:unknown,now:number=Date.now()):DeploymentObservation{
 const fallback:DeploymentObservation={
  available:false,asOf:new Date(now).toISOString(),running:null,paused:null,uncertain:true,
  brokerExposure:'unknown',brokerExposureVerified:false,authorizationActive:null,
  accountId:null,codeHash:null,pendingIntent:false,grantExpiresAt:null,error:'Deployment status is unverified'
 };
 if(!raw||typeof raw!=='object')return fallback;
 const r=raw as Record<string,unknown>;
 const verified=r.brokerExposureVerified===true&&['open','pending','flat'].includes(String(r.brokerExposure));
 const connected=r.configured===true&&r.connected===true&&r.uncertain!==true&&r.statusUnavailable!==true;
 return {
  available:connected,asOf:new Date(now).toISOString(),
  running:connected&&typeof r.running==='boolean'?r.running:null,
  paused:connected&&typeof r.paused==='boolean'?r.paused:null,
  uncertain:!connected,brokerExposure:verified?r.brokerExposure as 'open'|'pending'|'flat':'unknown',
  brokerExposureVerified:verified,authorizationActive:connected&&typeof r.activeAuthorization==='boolean'?r.activeAuthorization:null,
  accountId:typeof r.accountId==='string'?r.accountId.slice(0,128):null,
  codeHash:typeof r.codeHash==='string'&&/^[a-f0-9]{64}$/.test(r.codeHash)?r.codeHash:null,
  pendingIntent:r.pendingIntent===true,grantExpiresAt:typeof r.grantExpiresAt==='number'&&Number.isFinite(r.grantExpiresAt)?r.grantExpiresAt:null,
  error:r.accountError||r.error?String(r.accountError||r.error).slice(0,160):null
 };
}
