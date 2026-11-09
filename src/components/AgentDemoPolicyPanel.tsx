import {useEffect,useState} from 'react';
import {ShieldCheck,ShieldAlert,PowerOff} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import type {DemoPolicy} from '../../server/agent-demo-policy.ts';
import './agent-demo-policy.css';

type Account={accountId:string;status:string;demo?:boolean;isDemo?:boolean;environment?:string;challenge?:{name?:string;type?:string;demo?:boolean;isDemo?:boolean;environment?:string}|null};
const CONFIRM='I AUTHORIZE VIBES PROPDAO DEMO AUTONOMY';
export function AgentDemoPolicyPanel({client}:{client:CloudClient}){
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [policies,setPolicies]=useState<DemoPolicy[]>([]);
 const [accountId,setAccountId]=useState('');
 const [risk,setRisk]=useState(.25),[maxDailyLoss,setMaxDailyLoss]=useState(1);
 const [maxDrawdown,setMaxDrawdown]=useState(3),[maxPositions,setMaxPositions]=useState(1);
 const [expires,setExpires]=useState(24),[untilStopped,setUntilStopped]=useState(true),[allowReplace,setAllowReplace]=useState(true);
 const [mode,setMode]=useState<'bounded-demo'|'full-demo'>('bounded-demo');
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const refresh=async()=>{
  const list=await sharingRequest<{policies:DemoPolicy[];eligibleAccounts:Account[]}>(client,'/api/agent-policies');
  const demo=list.eligibleAccounts||[];
  setAccounts(demo);setPolicies(list.policies||[]);
  setAccountId(current=>demo.some(a=>a.accountId===current)?current:demo[0]?.accountId||'');
 };
 useEffect(()=>{let active=true;
  void sharingRequest<{policies:DemoPolicy[];eligibleAccounts:Account[]}>(client,'/api/agent-policies')
   .then(list=>{
    if(!active)return;
    const eligible=list.eligibleAccounts||[];
    setAccounts(eligible);setPolicies(list.policies||[]);setAccountId(eligible[0]?.accountId||'');
   }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Demo policy service unavailable')});
  return()=>{active=false};},[client]);
 const create=async()=>{
  if(!consent||!accountId||busy)return;setBusy(true);setError('');setNote('');
  try{
   await sharingRequest(client,'/api/agent-policies','POST',{
    mode,accountId,instruments:['GOLDUSDC'],maxRiskUsd:risk,maxDailyLossPct:maxDailyLoss,
    maxDrawdownPct:maxDrawdown,maxOpenPositions:maxPositions,expiresInHours:expires,untilStopped,allowReplace,acceptEvaluationDemo:true,
    confirmation:CONFIRM
   });
   await refresh();setConsent(false);
   setNote('Demo-only policy recorded. To run, start a continuous agent; broker execution must also pass the backend activation gate.');
  }catch(e){setError(e instanceof Error?e.message:'The policy was not confirmed')}
  finally{setBusy(false)}
 };
 const revoke=async(id:string)=>{
  if(busy)return;setBusy(true);setError('');setNote('');
  try{
   await sharingRequest(client,'/api/agent-policies/'+encodeURIComponent(id)+'/revoke','POST');
   await refresh();setNote('Future agent permission revoked. Any existing bot must still be stopped and reconciled separately.');
  }catch(e){setError(e instanceof Error?e.message:'Could not verify revocation')}
  finally{setBusy(false)}
 };
 return <section className="tv-agent-policy-panel" aria-label="PropDAO demo authorization policy">
  <header><ShieldCheck size={18}/><div><strong>PropDAO demo operating policy</strong><p>Define the PropDAO Evaluation demo account and risk envelope. Explicit confirmation permits free evaluation trading; funded and real-money accounts are excluded.</p></div></header>
  {policies.filter(p=>p.revokedAt===null&&p.expiresAt>Date.now()).map(p=><div className="tv-agent-policy-active" key={p.id}>
   <div><strong>{p.accountId+' · '+p.mode}</strong>
    <p>{'GOLDUSDC · }</p>
    <small>Policy recorded · Autonomous execution disabled</small></div>
   <button type="button" disabled={busy} onClick={()=>void revoke(p.id)}><PowerOff size={14}/> Revoke</button>
  </div>)}
  <div className="tv-agent-policy-fields">
   <label>Demo evaluation account<select value={accountId} onChange={e=>setAccountId(e.target.value)}>
    {accounts.length===0&&<option value="">No owned active evaluation demo account</option>}
    {accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.accountId+' · '+(a.challenge?.name||'Evaluation')}</option>)}
   </select></label>
   <label>Operating mode<select value={mode} onChange={e=>setMode(e.target.value as 'bounded-demo'|'full-demo')}>
    <option value="bounded-demo">Bounded demo · approved robots only</option>
    <option value="full-demo">Full demo · replacement requires separate eligibility</option>
   </select></label>
   <label>Maximum risk per order (USD)<input type="number" min=".01" max="1" step=".05" value={risk} onChange={e=>setRisk(Number(e.target.value))}/></label>
   <label>Maximum daily loss (%)<input type="number" min=".1" max="2" step=".1" value={maxDailyLoss} onChange={e=>setMaxDailyLoss(Number(e.target.value))}/></label>
   <label>Maximum drawdown (%)<input type="number" min=".5" max="5" step=".5" value={maxDrawdown} onChange={e=>setMaxDrawdown(Number(e.target.value))}/></label>
   <label>Maximum open positions<select value={maxPositions} onChange={e=>setMaxPositions(Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option></select></label>
   <label className="tv-agent-policy-checkbox"><input type="checkbox" checked={untilStopped} onChange={e=>setUntilStopped(e.target.checked)}/> Continue running until I stop it (demo account only). Each broker robot remains subject to separate seven-day grants and risk checks.</label>
   {!untilStopped&&<label>Policy expiry<select value={expires} onChange={e=>setExpires(Number(e.target.value))}>
    <option value={24}>24 hours</option><option value={72}>3 days</option><option value={120}>5 days</option><option value={168}>7 days</option>
   </select></label>}
   <label className="tv-agent-policy-checkbox"><input type="checkbox" checked={allowReplace} onChange={e=>setAllowReplace(e.target.checked)}/> Permit replacing an independently approved strategy within the same limits</label>
  </div>
  <label className="tv-agent-policy-checkbox"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
   I explicitly approve a DEMO-only operating policy for the limits shown. Recording the policy authorizes only the Evaluation demo within these limits; deployment is separately gated by risk and independent strategy verification.</label>
  <button type="button" className="tv-hub-primary" disabled={!consent||!accountId||busy} onClick={()=>void create()}>
   <ShieldCheck size={14}/> Record demo operating policy
  </button>
  <p className="tv-agent-policy-warning"><ShieldAlert size={15}/> Revoking a policy does not close orders or positions or verify a running robot has stopped.</p>
  {note&&<p role="status">{note}</p>}
  {error&&<p role="alert" className="tv-agent-policy-error">{error}</p>}
 </section>;
}
+p.maxRiskUsd.toFixed(2)+' risk/order · '+(p.untilStopped?'until stopped':'expires '+new Date(p.expiresAt).toLocaleString())}</p>
    <small>Policy recorded · Autonomous execution disabled</small></div>
   <button type="button" disabled={busy} onClick={()=>void revoke(p.id)}><PowerOff size={14}/> Revoke</button>
  </div>)}
  <div className="tv-agent-policy-fields">
   <label>Demo evaluation account<select value={accountId} onChange={e=>setAccountId(e.target.value)}>
    {accounts.length===0&&<option value="">No owned active evaluation demo account</option>}
    {accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.accountId+' · '+(a.challenge?.name||'Evaluation')}</option>)}
   </select></label>
   <label>Operating mode<select value={mode} onChange={e=>setMode(e.target.value as 'bounded-demo'|'full-demo')}>
    <option value="bounded-demo">Bounded demo · approved robots only</option>
    <option value="full-demo">Full demo · replacement requires separate eligibility</option>
   </select></label>
   <label>Maximum risk per order (USD)<input type="number" min=".01" max="1" step=".05" value={risk} onChange={e=>setRisk(Number(e.target.value))}/></label>
   <label>Maximum daily loss (%)<input type="number" min=".1" max="2" step=".1" value={maxDailyLoss} onChange={e=>setMaxDailyLoss(Number(e.target.value))}/></label>
   <label>Maximum drawdown (%)<input type="number" min=".5" max="5" step=".5" value={maxDrawdown} onChange={e=>setMaxDrawdown(Number(e.target.value))}/></label>
   <label>Maximum open positions<select value={maxPositions} onChange={e=>setMaxPositions(Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option></select></label>
   <label className="tv-agent-policy-checkbox"><input type="checkbox" checked={untilStopped} onChange={e=>setUntilStopped(e.target.checked)}/> Continue running until I stop it (demo account only). Each broker robot remains subject to separate seven-day grants and risk checks.</label>
   {!untilStopped&&<label>Policy expiry<select value={expires} onChange={e=>setExpires(Number(e.target.value))}>
    <option value={24}>24 hours</option><option value={72}>3 days</option><option value={120}>5 days</option><option value={168}>7 days</option>
   </select></label>}
   <label className="tv-agent-policy-checkbox"><input type="checkbox" checked={allowReplace} onChange={e=>setAllowReplace(e.target.checked)}/> Permit replacing an independently approved strategy within the same limits</label>
  </div>
  <label className="tv-agent-policy-checkbox"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
   I explicitly approve a time-limited DEMO-account policy for the limits shown. Recording the policy authorizes only the Evaluation demo within these limits; deployment is separately gated by risk and independent strategy verification.</label>
  <button type="button" className="tv-hub-primary" disabled={!consent||!accountId||busy} onClick={()=>void create()}>
   <ShieldCheck size={14}/> Record demo operating policy
  </button>
  <p className="tv-agent-policy-warning"><ShieldAlert size={15}/> Revoking a policy does not close orders or positions or verify a running robot has stopped.</p>
  {note&&<p role="status">{note}</p>}
  {error&&<p role="alert" className="tv-agent-policy-error">{error}</p>}
 </section>;
}
