#!/usr/bin/env node
/**
 * Production Phase-2 verification using an explicitly provisioned disposable
 * Firebase EMAIL/PASSWORD account. Never request/copy a human user's token.
 * Environment: TV_E2E_ID_TOKEN, TV_E2E_FIREBASE_PROJECT_ID,
 * TV_E2E_BASE_URL (HTTPS), TV_E2E_ALLOW_WRITES=1. Optional TV_E2E_MODEL=1.
 * The runner prints outcomes only and deletes its temporary Firestore/R2 data.
 */
import {randomUUID} from 'node:crypto';

const token=process.env.TV_E2E_ID_TOKEN||'';
const project=process.env.TV_E2E_FIREBASE_PROJECT_ID||'';
const base=process.env.TV_E2E_BASE_URL||'https://trading-robots.vercel.app';
const enabled=process.env.TV_E2E_ALLOW_WRITES==='1';
const result=[];
const startedAt=new Date().toISOString();
const qaHeader=process.env.TV_E2E_QA_SECRET||'';
const qaHeaders=qaHeader?{'x-phase2-e2e-secret':qaHeader}:{};
function check(name,success,detail=''){result.push({name,success:Boolean(success),detail:String(detail).slice(0,100)});if(!success)throw Error('Verification failed: '+name)}
if(!enabled||!token||!project||!/^https:\/\/[A-Za-z0-9.-]+$/.test(base))throw Error('A dedicated test Firebase identity, project and explicit write permission are required.');
const parts=token.split('.');
if(parts.length!==3)throw Error('Use an actual Firebase ID token from a test user.');
const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
if(claims.aud!==project||claims.iss!=='https://securetoken.google.com/'+project||!claims.sub||typeof claims.email!=='string'||!/^tv-phase2-e2e-[\w-]+@example\.(com|test)$/i.test(claims.email)){
 throw Error('Refusing to run against an account other than a dedicated tv-phase2-e2e test user.');
}
const uid=claims.sub;
const id='tvqa-'+randomUUID().replaceAll('-','');
const code='export const config={timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2};export function onCandle(){return {action:"WAIT"}};';
const edited=code.replace('riskReward:2','riskReward:3');
const auth={Authorization:'Bearer '+token};
const api=async(path,method='GET',payload)=> {
 const response=await fetch(base+path,{method,headers:{...auth,...qaHeaders,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(58000)});
 const data=await response.json().catch(()=>null);
 return {status:response.status,body:data};
};
const url='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(project)+'/databases/(default)/documents/users/'+encodeURIComponent(uid)+'/bots/'+encodeURIComponent(id);
const firestore=async(method,payload)=>{
 const response=await fetch(url+(method==='PATCH'?'?currentDocument.exists=false':''),{method,headers:{...auth,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(18000)});
 return {status:response.status,body:await response.json().catch(()=>null)};
};
let r2Saved=false,firestoreSaved=false;
try{
 const authTest=await api('/api/agents');
 check('Firebase ID token accepted; Firestore agent listing',authTest.status===200&&Array.isArray(authTest.body),authTest.status);
 const caps=await api('/api/agent/capabilities');
 check('authenticated Phase-2 capabilities endpoint',caps.status===200,caps.status);
 check('strategy approval feature activated',caps.body?.strategyApprovals===true,String(caps.body?.strategyApprovals));
 check('read-only server backtest feature activated',caps.body?.verifiedHyperliquidBacktest===true,String(caps.body?.verifiedHyperliquidBacktest));
 const save=await api('/api/user-bots/'+id+'/current','PUT',{code,venue:'hyperliquid'});
 check('R2 stored owned strategy',save.status===200,save.status);
 r2Saved=true;
 const stored=await api('/api/user-bots/'+id+'/current');
 check('R2 read is owner-scoped and byte-identical',stored.status===200&&stored.body?.code===code,stored.status);
 if(process.env.TV_E2E_SECOND_ID_TOKEN){
  const secondary=process.env.TV_E2E_SECOND_ID_TOKEN;
  const secondParts=secondary.split('.');
  const secondClaims=secondParts.length===3?JSON.parse(Buffer.from(secondParts[1],'base64url').toString('utf8')):{};
  check('second test user is a different Firebase project account',secondClaims.aud===project&&secondClaims.sub!==uid&&/^tv-phase2-e2e-[\w-]+@example\.(com|test)$/i.test(String(secondClaims.email)));
  const other=await fetch(base+'/api/user-bots/'+id+'/current',{headers:{Authorization:'Bearer '+secondary,...qaHeaders},signal:AbortSignal.timeout(20000)});
  check('live cross-tenant R2 read is forbidden',other.status===404||other.status===409,other.status);
 }
 const doc={fields:{name:{stringValue:'Phase2 QA sandbox strategy'},asset:{stringValue:'BTC'},venue:{stringValue:'hyperliquid'},prompt:{stringValue:'Isolated end-to-end verification'},storage:{mapValue:{fields:{provider:{stringValue:'r2'},key:{stringValue:String(save.body?.storageKey||'')}}}}}};
 const created=await firestore('PATCH',doc);
 check('real signed-in Firestore test bot create',created.status===200,created.status);
 firestoreSaved=true;
 const listed=await firestore('GET');
 check('signed-in Firestore test bot read',listed.status===200,listed.status);
 const proposal=await api('/api/agent/strategy-reviews','POST',{botId:id,expectedCode:code,proposedCode:edited});
 check('stage actual approval in Firestore and R2',proposal.status===201&&typeof proposal.body?.intentId==='string',proposal.status);
 const ref='/api/agent/strategy-reviews/'+id+'/'+proposal.body.intentId;
 const tooEarly=await api(ref+'/apply','POST',{});
 check('unapproved strategy update rejected',tooEarly.status===409,tooEarly.status);
 const accepted=await api(ref+'/approve','POST',{});
 check('user-scoped explicit approval recorded',accepted.status===200&&accepted.body?.approved===true,accepted.status);
 const applied=await api(ref+'/apply','POST',{});
 check('approved exact strategy code applied once',applied.status===200&&applied.body?.applied===true,applied.status);
 const replay=await api(ref+'/apply','POST',{});
 check('repeat approval consumption rejected',replay.status===409,replay.status);
 const updated=await api('/api/user-bots/'+id+'/current');
 check('R2 updated strategy content confirmed',updated.status===200&&updated.body?.code===edited,updated.status);
 const test=await api('/api/agent/backtest/verify','POST',{botId:id,lookbackCandles:120});
 check('server-side QuickJS, Firestore, R2 and Hyperliquid integration',test.status===200&&test.body?.available===true&&test.body?.source==='Hyperliquid public completed candles'&&test.body?.coverage?.[0]?.count===120,test.status);
 check('simulation cannot masquerade as fills',test.body?.kind==='simulation'&&test.body?.sourceType?.includes('not broker fills'));
 if(process.env.TV_E2E_MODEL==='1'){
  // This is an actual authenticated OpenRouter invocation using ONLY the
  // disposable user's own connected key. It may consume that user's credits.
  const response=await fetch(base+'/api/ai-sdk/stream',{
   method:'POST',headers:{...auth,...qaHeaders,'Content-Type':'application/json'},
   body:JSON.stringify({messages:[{role:'user',content:'Inspect my saved strategy '+id+' using the getSavedStrategy tool. Confirm its code is a WAIT-only strategy.'}],includeMarketContext:true,maxTokens:400}),
   signal:AbortSignal.timeout(58000)
  });
  const raw=await response.text();
  check('real BYO OpenRouter SDK streaming succeeds',response.status===200&&raw.includes('data:')&&raw.includes('[DONE]'),response.status);
  check('real agent selects verified owned strategy tool',/tool-call|tool-result|getSavedStrategy/.test(raw),'no verified structured tool event');
 }
} catch(error){
 result.push({name:'blocked',success:false,detail:String(error).slice(0,180)});
 process.exitCode=1;
} finally {
 // Always attempt BOTH cleanups, even after a failed assertion.
 if(r2Saved){
  const removed=await api('/api/user-bots/'+id,'DELETE').catch(()=>({status:0}));
  result.push({name:'temporary R2 data cleanup',success:removed.status===200,detail:String(removed.status)});
  if(removed.status!==200)process.exitCode=1;
 }
 if(firestoreSaved){
  const removed=await firestore('DELETE').catch(()=>({status:0}));
  result.push({name:'temporary Firestore data cleanup',success:removed.status===200,detail:String(removed.status)});
  if(removed.status!==200)process.exitCode=1;
 }
 const report={environment:base,executedAt:startedAt,completed:result.filter(x=>x.success).length,failed:result.filter(x=>!x.success).length,cleanup:{r2:r2Saved?result.find(x=>x.name==='temporary R2 data cleanup')?.success:false,firestore:firestoreSaved?result.find(x=>x.name==='temporary Firestore data cleanup')?.success:false,identity:'external test runner must delete both Firebase Auth users'},results:result};
 console.log(JSON.stringify(report,null,2));
}
