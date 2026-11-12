import {createHash,randomUUID} from 'node:crypto';
import {parseStrategyConfig,validateStrategySyntax} from '../src/strategy.ts';
import {ApprovalIntents,approvalActionSchema,approvalFingerprint,type ApprovalAction} from './approval-intents.ts';
import type {RecordStore} from './firestore-store.ts';

type Meta={id:string;name:string;asset:string;venue:string;userId?:string;ownerUid?:string};
type Stage={version:1;ownerUid:string;botId:string;intentId:string;
 operation:'strategy.create'|'strategy.delete';code:string;codeHash:string;
 meta:{name:string;asset:string;venue:'research'|'propdao'|'hyperliquid'|'valr';prompt:string};
 action:ApprovalAction;createdAt:number;expiresAt:number};
type Dependencies={
 approvals:ApprovalIntents;store:RecordStore;
 read:(key:string)=>Promise<string|null>;
 write:(key:string,value:string)=>Promise<void>;
 remove:(key:string)=>Promise<void>;
 withLock:<T>(uid:string,botId:string,run:()=>Promise<T>)=>Promise<T>;
 assertDeletable:(uid:string,botId:string)=>Promise<void>;
 deleteOwned:(uid:string,botId:string)=>Promise<void>;
 now?:()=>number;uuid?:()=>string;
};
const id=/^[A-Za-z0-9_-]{1,100}$/;
const assetRe=/^[A-Za-z0-9_:.@-]{1,64}$/;
const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
function owner(uid:string,botId?:string){
 if(!uid||uid.length>128||uid.includes('/')||(botId!==undefined&&!id.test(botId)))
  throw Error('Invalid owner-scoped strategy identity');
}
function root(uid:string,botId:string){owner(uid,botId);return 'user-bots/'+Buffer.from(uid).toString('base64url')+'/'+botId;}
function stageKey(uid:string,intentId:string){owner(uid,intentId);return 'strategy-crud/v1/'+Buffer.from(uid).toString('base64url')+'/'+intentId+'.json'}
function botPath(uid:string,botId:string){owner(uid,botId);return 'users/'+uid+'/bots/'+botId}
function validateCode(value:unknown){
 if(typeof value!=='string'||!value.trim()||value.length>180000||
   !/export\s+function\s+onCandle\s*\(/.test(value))throw Error('Complete valid strategy.js source is required');
 parseStrategyConfig(value);validateStrategySyntax(value);return value;
}
const supported=new Set(['research','propdao','hyperliquid','valr']);
function venue(value:unknown):Stage['meta']['venue']{
 if(typeof value!=='string'||!supported.has(value))throw Error('Unsupported new strategy venue');
 return value as Stage['meta']['venue'];
}
function action(s:Pick<Stage,'botId'|'operation'|'codeHash'|'meta'>):ApprovalAction{
 return approvalActionSchema.parse({
  operation:s.operation,connectionId:'no-connection',accountId:'no-account',
  venue:s.meta.venue,instrument:s.meta.asset,strategyId:s.botId,
  strategyVersion:s.codeHash,
  parameters:{sourceHash:s.codeHash,name:s.meta.name,
   action:s.operation==='strategy.create'?'create':'delete'},
  riskContext:{liveExecution:false,kind:'source-management-no-broker-orders'}
 });
}
/** A model may stage, but it never receives approve/apply/delete execution
 * capabilities. Only a separate signed-in user HTTP action can advance state.
 */
export class RobotCrudIntents{
 private deps:Dependencies;private now:()=>number;private uuid:()=>string;
 constructor(deps:Dependencies){this.deps=deps;this.now=deps.now??Date.now;this.uuid=deps.uuid??randomUUID}
 private async current(uid:string,botId:string){
  const [meta,raw]=await Promise.all([
   this.deps.store.get(botPath(uid,botId)),this.deps.read(root(uid,botId)+'/current.json')
  ]);
  if(!meta||!raw||raw.length>250000)throw Error('Owned strategy source unavailable');
  const stored=JSON.parse(raw),m=meta as Meta;
  if(m.id&&m.id!==botId||m.userId&&m.userId!==uid||
      m.ownerUid&&m.ownerUid!==uid||stored.userId!==uid||
      stored.botId!==botId||typeof stored.code!=='string'||
      stored.venue!==m.venue||!assetRe.test(m.asset)||
      typeof m.name!=='string')
   throw Error('Strategy ownership or source catalog mismatch');
  return {meta:m,code:validateCode(stored.code)};
 }
 async stageCreate(uid:string,input:{name:unknown;asset:unknown;venue:unknown;code:unknown;prompt?:unknown}){
  owner(uid);
  const name=String(input.name??'').trim(),asset=String(input.asset??'').trim();
  if(name.length<2||name.length>64||!assetRe.test(asset))
   throw Error('New strategy requires a name (2–64 characters) and valid instrument');
  const v=venue(input.venue),code=validateCode(input.code);
  const prompt=typeof input.prompt==='string'?input.prompt.slice(0,3000):'Created from an approved VIBES strategy proposal';
  const botId=this.uuid().replace(/-/g,''),meta={name,asset,venue:v,prompt};
  owner(uid,botId);
  if(await this.deps.store.get(botPath(uid,botId))||await this.deps.read(root(uid,botId)+'/current.json'))
   throw Error('Generated strategy ID already exists; retry');
  const data={botId,operation:'strategy.create' as const,codeHash:hash(code),meta};
  const approvedAction=action(data),intent=await this.deps.approvals.create(uid,approvedAction,180000);
  const stage:Stage={version:1,ownerUid:uid,intentId:intent.id,
   ...data,action:approvedAction,code,createdAt:this.now(),expiresAt:intent.expiresAt};
  try{await this.deps.write(stageKey(uid,intent.id),JSON.stringify(stage))}
  catch(e){await this.deps.approvals.deny(uid,intent.id).catch(()=>{});throw e}
  return this.view(stage);
 }
 async stageDelete(uid:string,botId:string){
  const {meta,code}=await this.current(uid,botId);
  if(meta.venue==='ctrader')throw Error('Cannot safely delete cTrader source until its live gateway state can be independently reconciled');
  // Never invite a user to approve deletion of a still-running bot.
  // Approval is gated independently again after staging, then at apply.
  await this.deps.assertDeletable(uid,botId);
  const data={botId,operation:'strategy.delete' as const,codeHash:hash(code),
   meta:{name:meta.name,asset:meta.asset,venue:venue(meta.venue),
    prompt:typeof (meta as any).prompt==='string'?(meta as any).prompt.slice(0,3000):''}};
  const approvedAction=action(data),intent=await this.deps.approvals.create(uid,approvedAction,180000);
  const stage:Stage={version:1,ownerUid:uid,intentId:intent.id,...data,action:approvedAction,
   code:'',createdAt:this.now(),expiresAt:intent.expiresAt};
  try{await this.deps.write(stageKey(uid,intent.id),JSON.stringify(stage))}
  catch(e){await this.deps.approvals.deny(uid,intent.id).catch(()=>{});throw e}
  return this.view(stage);
 }
 private view(stage:Stage){
  return {reviewRequired:true,operation:stage.operation,botId:stage.botId,intentId:stage.intentId,
   expiresAt:stage.expiresAt,name:stage.meta.name,asset:stage.meta.asset,
   venue:stage.meta.venue,codeHash:stage.codeHash,
   ...(stage.operation==='strategy.create'?{codePreview:stage.code.slice(0,2400)}:{}),
   note:stage.operation==='strategy.create'?
    'Not created. Explicitly approve and apply this saved-source proposal; no backtest or deployment is performed.':
    'Not deleted. Permanent deletion requires explicit approval and an independently verified stopped and reconciled runtime.'
  };
 }
 private async load(uid:string,intentId:string){
  owner(uid,intentId);
  const raw=await this.deps.read(stageKey(uid,intentId));
  if(!raw||raw.length>260000)throw Error('Strategy mutation review is missing');
  const s=JSON.parse(raw) as Stage;
  if(s.version!==1||s.ownerUid!==uid||s.intentId!==intentId||
     !id.test(s.botId)||this.now()>=s.expiresAt||!Number.isFinite(s.expiresAt)||
     !['strategy.create','strategy.delete'].includes(s.operation))
   throw Error('Strategy mutation expired or identity invalid');
  if(s.operation==='strategy.create'){
   const code=validateCode(s.code);
   if(hash(code)!==s.codeHash)throw Error('Staged source changed since creation review');
  }else if(s.code!==''||!/^[a-f0-9]{64}$/.test(s.codeHash))
   throw Error('Deletion review must not retain or alter historical source');
  if(approvalFingerprint(action(s))!==approvalFingerprint(s.action))
   throw Error('Staged approval identity changed');
  return s;
 }
 async preview(uid:string,intentId:string){
  const stage=await this.load(uid,intentId);
  const before=stage.operation==='strategy.delete'?
   (await this.current(uid,stage.botId)).code:null;
  if(before!==null&&hash(before)!==stage.codeHash)
   throw Error('Strategy changed since deletion was staged');
  return {...this.view(stage),before,
   after:stage.operation==='strategy.create'?stage.code:null,
   reviewRequired:true};
 }
 async approve(uid:string,intentId:string){
  const s=await this.load(uid,intentId);
  if(s.operation==='strategy.delete'){
   const current=await this.current(uid,s.botId);
   if(hash(current.code)!==s.codeHash)throw Error('Strategy source has changed since deletion review');
   await this.deps.assertDeletable(uid,s.botId);
  }else if(await this.deps.store.get(botPath(uid,s.botId))||
    await this.deps.read(root(uid,s.botId)+'/current.json'))
   throw Error('New robot identity is occupied');
  await this.deps.approvals.approve(uid,intentId,s.action);
  return {approved:true,...this.view(s)};
 }
 async deny(uid:string,intentId:string){
  const s=await this.load(uid,intentId);
  await this.deps.approvals.deny(uid,intentId);
  await this.deps.remove(stageKey(uid,intentId)).catch(()=>{});
  return {denied:true,operation:s.operation,botId:s.botId,intentId};
 }
 async apply(uid:string,intentId:string){
  const s=await this.load(uid,intentId);
  return this.deps.withLock(uid,s.botId,async()=>{
   if(s.operation==='strategy.create'){
    if(await this.deps.store.get(botPath(uid,s.botId))||
       await this.deps.read(root(uid,s.botId)+'/current.json'))
     throw Error('Robot now exists. Stage a fresh proposal.');
    await this.deps.approvals.consume(uid,intentId,s.action);
    const location=root(uid,s.botId)+'/current.json';
    await this.deps.write(location,JSON.stringify({
     schemaVersion:1,userId:uid,botId:s.botId,code:s.code,venue:s.meta.venue,
     updatedAt:new Date(this.now()).toISOString()
    }));
    try{
     const created=await this.deps.store.create(botPath(uid,s.botId),{
      id:s.botId,ownerUid:uid,userId:uid,name:s.meta.name,asset:s.meta.asset,
      venue:s.meta.venue,prompt:s.meta.prompt,
      storage:{provider:'r2',key:location},updatedAt:this.now(),lastBacktest:null
     });
     if(!created)throw Error('Robot ID collision after source write');
    }catch(error){
     // Only the newly created R2 asset is rolled back. No broker data is touched.
     await this.deps.remove(location).catch(()=>{});
     throw error;
    }
    await this.deps.remove(stageKey(uid,intentId)).catch(()=>{});
    return {applied:true,operation:s.operation,botId:s.botId,codeHash:s.codeHash,
     note:'Saved robot created. No backtest, deployment or broker order was performed.'};
   }
   const current=await this.current(uid,s.botId);
   if(hash(current.code)!==s.codeHash||current.meta.venue!==s.meta.venue||
      current.meta.asset!==s.meta.asset)
    throw Error('Source or metadata changed after review; delete is blocked');
   await this.deps.assertDeletable(uid,s.botId);
   await this.deps.approvals.consume(uid,intentId,s.action);
   await this.deps.deleteOwned(uid,s.botId);
   await this.deps.remove(stageKey(uid,intentId)).catch(()=>{});
   return {applied:true,operation:s.operation,botId:s.botId,codeHash:s.codeHash,
    note:'Approved owner-scoped robot source and catalog deletion. Broker trade journal remains immutable.'};
  });
 }
}
