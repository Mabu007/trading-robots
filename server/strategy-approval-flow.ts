import {createHash} from 'node:crypto';
import {ApprovalIntents,approvalActionSchema,approvalFingerprint,type ApprovalAction} from './approval-intents.ts';
import {parseStrategyConfig} from '../src/strategy.ts';
import {venues} from '../shared/venues.ts';

const safeId=/^[A-Za-z0-9_-]{1,100}$/;
const hash=(code:string)=>createHash('sha256').update(code).digest('hex');
type BotMeta={id:string;asset:string;venue:string;userId?:string;ownerUid?:string};
type Stage={
 schemaVersion:1;ownerUid:string;botId:string;intentId:string;action:ApprovalAction;
 expectedCode:string;proposedCode:string;createdAt:number;expiresAt:number
};
export type ReviewedStrategyDependencies={
 approvals:ApprovalIntents;
 read:(key:string)=>Promise<string|null>;
 write:(key:string,data:string)=>Promise<void>;
 getOwnedBot:(uid:string,botId:string)=>Promise<BotMeta|null>;
 /** Must hold existing per-account/bot locks and confirm live strategy is stopped.
  * Execute beforeCommit only AFTER checking current source and ownership, inside locks.
  */
 commit:(uid:string,botId:string,code:string,expectedCode:string,beforeCommit:()=>Promise<void>,expectedVenue:string)=>Promise<string>;
 now?:()=>number;
};
function key(uid:string,botId:string,intentId:string){
 if(!uid||uid.length>128||uid.includes('/')||!safeId.test(botId)||!safeId.test(intentId))throw Error('Invalid reviewed strategy identity');
 return 'user-bots/'+Buffer.from(uid).toString('base64url')+'/'+botId+'/approvals/'+intentId+'.json';
}
export function strategyApplyAction(meta:BotMeta,botId:string,expectedCode:string,proposedCode:string):ApprovalAction{
 if(meta.id!==botId||!venues.includes(meta.venue as any)||typeof meta.asset!=='string'||!/^[A-Za-z0-9_:.@-]{1,64}$/.test(meta.asset))throw Error('Invalid strategy metadata');
 return approvalActionSchema.parse({
  operation:'strategy.apply',connectionId:'no-connection',accountId:'no-account',
  venue:meta.venue,instrument:meta.asset,strategyId:botId,
  strategyVersion:hash(expectedCode),parameters:{expectedCodeHash:hash(expectedCode),proposedCodeHash:hash(proposedCode)},
  riskContext:{liveExecution:false,kind:'source-code-review'}
 });
}
/** Never callable by an AI SDK tool: only authenticated HTTP routes and a
 * user-visible review control can advance from pending to approved. */
export class ReviewedStrategyUpdates {
 private now:()=>number; private deps:ReviewedStrategyDependencies;
 constructor(deps:ReviewedStrategyDependencies){this.deps=deps;this.now=deps.now||Date.now}
 private async owned(uid:string,botId:string){
  if(!safeId.test(botId)||!uid||uid.includes('/')||uid.length>128)throw Error('Invalid user strategy');
  const meta=await this.deps.getOwnedBot(uid,botId);
  if(!meta||meta.id!==botId||meta.userId&&meta.userId!==uid||meta.ownerUid&&meta.ownerUid!==uid)throw Error('Strategy ownership could not be verified');
  return meta;
 }
 private validate(code:unknown){
  if(typeof code!=='string'||!code.trim()||code.length>180000||!/export\s+function\s+onCandle\s*\(/.test(code))throw Error('Invalid strategy code');
  parseStrategyConfig(code);
  // Parse as a function body after removing the supported export declarations.
  // The constructor compiles the source without evaluating it.
  try { new Function(code.replace(/\bexport\s+(?=const\s+config\b|function\s+onCandle\b)/g,'')); }
  catch { throw Error('Strategy code has invalid JavaScript syntax.'); }
  return code;
 }
 private async current(uid:string,botId:string){
  const raw=await this.deps.read('user-bots/'+Buffer.from(uid).toString('base64url')+'/'+botId+'/current.json');
  if(!raw||raw.length>250000)throw Error('Saved strategy unavailable');
  const record=JSON.parse(raw);
  if(record.userId!==uid||record.botId!==botId||typeof record.code!=='string')throw Error('Saved strategy ownership mismatch');
  return {code:record.code as string,venue:record.venue as unknown};
 }
 async stage(uid:string,botId:string,expectedCode:unknown,proposedCode:unknown){
  const meta=await this.owned(uid,botId);
  // cTrader's live gateway has its own deployment lifecycle. Until an explicit
  // stopped-runtime reconciliation is connected here, never update its source
  // through this new SDK approval path.
  if(meta.venue==='ctrader')throw Error('cTrader code review requires verified stopped gateway state.');
  const expected=this.validate(expectedCode),proposed=this.validate(proposedCode);
  if(expected===proposed)throw Error('No code changes to review');
  const current=await this.current(uid,botId);
  if(current.code!==expected||current.venue!==meta.venue)throw Error('Saved strategy source or venue changed before review');
  const action=strategyApplyAction(meta,botId,expected,proposed);
  const intent=await this.deps.approvals.create(uid,action,120000);
  const stage:Stage={schemaVersion:1,ownerUid:uid,botId,intentId:intent.id,action,expectedCode:expected,proposedCode:proposed,createdAt:this.now(),expiresAt:intent.expiresAt};
  try{await this.deps.write(key(uid,botId,intent.id),JSON.stringify(stage));}
  catch(e){await this.deps.approvals.deny(uid,intent.id).catch(()=>{});throw e}
  return {intentId:intent.id,expiresAt:intent.expiresAt,operation:'strategy.apply',botId,asset:meta.asset,venue:meta.venue,expectedCodeHash:hash(expected),proposedCodeHash:hash(proposed)};
 }
 private async load(uid:string,botId:string,intentId:string){
  await this.owned(uid,botId);
  const raw=await this.deps.read(key(uid,botId,intentId));
  if(!raw||raw.length>410000)throw Error('Reviewed strategy stage unavailable');
  const record=JSON.parse(raw) as Stage;
  if(record.schemaVersion!==1||record.ownerUid!==uid||record.botId!==botId||record.intentId!==intentId||!Number.isFinite(record.expiresAt)||this.now()>=record.expiresAt)throw Error('Strategy review is expired or does not belong to this user');
  const expected=this.validate(record.expectedCode),proposed=this.validate(record.proposedCode);
  const meta=await this.owned(uid,botId);
  const action=strategyApplyAction(meta,botId,expected,proposed);
  if(approvalFingerprint(action)!==approvalFingerprint(record.action))throw Error('Reviewed strategy payload changed');
  return {record,action,expected,proposed};
 }
 async approve(uid:string,botId:string,intentId:string){
  const v=await this.load(uid,botId,intentId);
  const current=await this.current(uid,botId);
  if(current.code!==v.expected||current.venue!==v.action.venue)throw Error('Strategy source or venue changed before approval.');
  await this.deps.approvals.approve(uid,intentId,v.action);
  return {approved:true,intentId,botId,expiresAt:v.record.expiresAt};
 }
 async deny(uid:string,botId:string,intentId:string){
  const v=await this.load(uid,botId,intentId);
  await this.deps.approvals.deny(uid,intentId);
  return {denied:true,intentId,botId};
 }
 async apply(uid:string,botId:string,intentId:string){
  const {action,expected,proposed}=await this.load(uid,botId,intentId);
  const location=await this.deps.commit(uid,botId,proposed,expected,async()=>{
   const current=await this.owned(uid,botId);
   const currentAction=strategyApplyAction(current,botId,expected,proposed);
   if(approvalFingerprint(currentAction)!==approvalFingerprint(action))throw Error('Strategy instrument or venue changed before execution.');
   await this.deps.approvals.consume(uid,intentId,currentAction);
  },action.venue);
  return {applied:true,botId,intentId,storageKey:location,codeHash:hash(proposed),note:'Approved source update only; no backtest or live broker execution was performed.'};
 }
}
