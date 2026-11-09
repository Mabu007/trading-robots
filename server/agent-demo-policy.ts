import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {RecordStore} from './firestore-store.ts';

/** Standing consent is scoped to PropDAO DEMO accounts and cannot authorize real money. */
export const demoPolicyInput=z.object({
 mode:z.enum(['bounded-demo','full-demo']),
 accountId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
 instruments:z.array(z.string().regex(/^[A-Za-z0-9_:@.-]{1,64}$/)).min(1).max(8),
 maxRiskUsd:z.number().min(.01).max(1),
 maxDailyLossPct:z.number().min(.1).max(2),
 maxDrawdownPct:z.number().min(.5).max(5),
 maxOpenPositions:z.number().int().min(1).max(2),
 expiresInHours:z.number().int().min(1).max(168),
 allowReplace:z.boolean().default(false),
 confirmation:z.literal('I AUTHORIZE VIBES PROPDAO DEMO AUTONOMY')
}).strict();
export type DemoPolicy={
 version:1;id:string;ownerUid:string;mode:'bounded-demo'|'full-demo';
 venue:'propdao';demoOnly:true;accountId:string;instruments:string[];
 maxRiskUsd:number;maxDailyLossPct:number;maxDrawdownPct:number;maxOpenPositions:number;
 allowReplace:boolean;createdAt:number;expiresAt:number;revokedAt:null|number;
 fingerprint:string;stateVersion:number;
};
const key=(uid:string,id:string)=>'users/'+uid+'/agent-policies/'+id;
const strongId=/^[A-Za-z0-9_-]{8,100}$/;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** A challenge name or generic "simulated" connector mode is NOT a broker demo attestation. */
export function verifyPropDAODemoAccount(account:unknown,operatorAllowlist:string|undefined=process.env.PROPDAO_AUTONOMY_DEMO_ACCOUNT_IDS):boolean{
 if(!account||typeof account!=='object')return false;
 const a=account as Record<string,unknown>;
 const challenge=a.challenge&&typeof a.challenge==='object'?a.challenge as Record<string,unknown>:{};
 const providerDemo=a.demo===true||a.isDemo===true||a.environment==='demo'||
  challenge.demo===true||challenge.isDemo===true||challenge.environment==='demo';
 const listed=typeof a.accountId==='string'&&(operatorAllowlist||'').split(',').map(v=>v.trim()).filter(Boolean).includes(a.accountId);
 const explicitlyLive=a.realMoney===true||a.isLive===true||a.environment==='live'||a.accountType==='live'||
  challenge.live===true||challenge.realMoney===true;
 return Boolean((providerDemo||listed)&&!explicitlyLive&&a.status==='active'&&challenge&&Object.keys(challenge).length>0);
}
export function evaluateDemoPolicy(policy:DemoPolicy,action:{
 uid:string;accountId:string;instrument:string;riskUsd:number;action:'deploy'|'replace'|'monitor';now:number;
 existingPositions?:number|null;existingOrders?:number|null;breached?:boolean|null;exposureVerified:boolean;
}):{allowed:boolean;reasons:string[]}{
 const reasons:string[]=[];
 if(policy.version!==1||policy.demoOnly!==true||policy.venue!=='propdao')reasons.push('This is not a PropDAO demo-only policy.');
 if(policy.ownerUid!==action.uid||policy.accountId!==action.accountId)reasons.push('Policy ownership or broker account mismatch.');
 if(policy.revokedAt!==null||action.now>=policy.expiresAt)reasons.push('Standing authorization is revoked or expired.');
 if(!policy.instruments.includes(action.instrument))reasons.push('Instrument is outside the authorized universe.');
 if(action.action==='replace'&&!policy.allowReplace)reasons.push('Strategy replacement is not authorized.');
 if(!Number.isFinite(action.riskUsd)||action.riskUsd<.01||action.riskUsd>policy.maxRiskUsd)reasons.push('Trade risk exceeds the user-authorized budget.');
 if(!action.exposureVerified||action.breached!==false||action.existingOrders==null||action.existingPositions==null)reasons.push('Broker exposure/risk is unknown; do not place or deploy.');
 else if(action.existingPositions>=policy.maxOpenPositions||action.existingOrders>0)reasons.push('Open positions or resting orders prevent new entries.');
 return {allowed:reasons.length===0,reasons};
}
export class DemoPolicyStore{
 private readonly store:Pick<RecordStore,'get'|'create'|'put'|'query'|'transaction'>;
 private readonly clock:()=>number;
 constructor(store:Pick<RecordStore,'get'|'create'|'put'|'query'|'transaction'>,clock:()=>number=Date.now){this.store=store;this.clock=clock;}
 async create(uid:string,data:z.infer<typeof demoPolicyInput>,broker:{simulated:boolean;owned:boolean;evaluation:boolean;realMoney:boolean;status:string;breached:boolean;roomUsd:number}):Promise<DemoPolicy>{
  const input=demoPolicyInput.parse(data);
  if(!uid||uid.length>128||!broker.simulated||!broker.owned||!broker.evaluation||broker.realMoney||broker.status!=='active'||broker.breached||!Number.isFinite(broker.roomUsd)||broker.roomUsd<=input.maxRiskUsd*4)throw Error('A verified active evaluation-only demo account and safe risk room are required. Funded or unclassified accounts are excluded.');
  if(new Set(input.instruments).size!==input.instruments.length)throw Error('Duplicate instruments are not permitted.');
  const existing=await this.store.query('users/'+uid+'/agent-policies');
  if(existing.some(x=>x.ownerUid===uid&&x.accountId===input.accountId&&x.revokedAt===null&&x.expiresAt>this.clock()))throw Error('An active standing policy already exists on this account. Revoke it before replacing the scope.');
  const createdAt=this.clock(),id=randomUUID();
  const scoped={mode:input.mode,venue:'propdao' as const,demoOnly:true as const,
   accountId:input.accountId,instruments:input.instruments,maxRiskUsd:input.maxRiskUsd,
   maxDailyLossPct:input.maxDailyLossPct,maxDrawdownPct:input.maxDrawdownPct,
   maxOpenPositions:input.maxOpenPositions,allowReplace:input.allowReplace,
   createdAt,expiresAt:createdAt+input.expiresInHours*3_600_000};
  const policy:DemoPolicy={version:1,id,ownerUid:uid,...scoped,
   fingerprint:hash(JSON.stringify(scoped)),revokedAt:null,stateVersion:1};
  if(!(await this.store.create(key(uid,id),policy)))throw Error('Policy ID conflict; retry the request.');
  return policy;
 }
 async owned(uid:string,id:string):Promise<DemoPolicy>{
  if(!uid||uid.length>128||!strongId.test(id))throw Error('Invalid standing policy');
  const raw=await this.store.get(key(uid,id)) as DemoPolicy|null;
  if(!raw||raw.ownerUid!==uid||raw.id!==id||raw.version!==1||raw.demoOnly!==true)throw Error('Standing policy not found for this account.');
  return raw;
 }
 async list(uid:string):Promise<DemoPolicy[]>{
  if(!uid||uid.length>128)throw Error('Invalid account');
  const records=await this.store.query('users/'+uid+'/agent-policies');
  return records.filter((p:any)=>p&&p.ownerUid===uid&&p.demoOnly===true).slice(-40) as DemoPolicy[];
 }
 async revoke(uid:string,id:string):Promise<DemoPolicy>{
  const prior=await this.owned(uid,id);
  if(prior.revokedAt!==null)return prior;
  if(!this.store.transaction)throw Error('Atomic policy revocation is unavailable. Refusing to claim revocation.');
  const path=key(uid,id),time=this.clock();
  await this.store.transaction([path],records=>{
   const current=records[0] as DemoPolicy|null;
   if(!current||current.ownerUid!==uid||current.id!==id)throw Error('Policy ownership mismatch during revocation.');
   return {[path]:{...current,revokedAt:current.revokedAt??time,stateVersion:current.stateVersion+1}};
  });
  return this.owned(uid,id);
 }
}
