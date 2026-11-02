import type { PropDAOSimulation } from '../propdao-evaluation';
import { IRON_1K } from '../propdao-evaluation';

const usd=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const percent=(value:number)=>Math.max(0,value).toFixed(2);
type LimitMeter={label:string;used:number;maximum:number;value:string;tone:'loss'|'target'};
export function PropDAOEvaluationPanel({simulation,busy=false}:{simulation:PropDAOSimulation|null;busy?:boolean}){
 const s=simulation;
 const passed=s?.status==='passed',failed=Boolean(s?.status?.startsWith('failed'));
 const dailyAllowance=s?.dailyAllowance??IRON_1K.maxDailyLoss;
 const meters:LimitMeter[]=[
  {label:'STATIC DRAWDOWN',used:s?.drawdownUsed??0,maximum:IRON_1K.maxStaticLoss,value:`${percent((s?.drawdownUsed??0)/IRON_1K.startingBalance*100)}% / 5.00%`,tone:'loss'},
  {label:'DAILY LOSS · UTC',used:s?.dailyLossUsed??0,maximum:dailyAllowance,value:`${percent((s?.dailyLossUsed??0)/Math.max(1,dailyAllowance/0.02)*100)}% / 2.00%`,tone:'loss'},
  {label:'PROFIT TARGET',used:Math.max(0,(s?.balance??IRON_1K.startingBalance)-IRON_1K.startingBalance),maximum:IRON_1K.targetProfit,value:`${percent(s?.profitTargetUsed??0)}% / 10.00%`,tone:'target'}
 ];
 return <section className="output-result-panel prop-native-results" aria-label="PropDAO historical evaluation simulator">
  <div className="output-result-heading">
   <div><span className="output-eyebrow">PROPDAO · IRON $1K PRO</span><strong>Evaluation results</strong><small>Historical simulation · 1,000 USDC starting balance</small></div>
   <span className={`prop-native-status ${passed?'green':failed?'red':''}`}>{!s?'NOT TESTED':passed?'PASSED':failed?'FAILED':'NOT PASSED'}</span>
  </div>
  <div className="output-metrics prop-native-summary">
   <div className="output-metric featured"><span>EQUITY</span><strong>{usd(s?.equity??IRON_1K.startingBalance)}</strong></div>
   <div className="output-metric"><span>BALANCE</span><strong>{usd(s?.balance??IRON_1K.startingBalance)}</strong></div>
   <div className="output-metric"><span>AVAILABLE · EST.</span><strong>{usd(s?.available??IRON_1K.startingBalance)}</strong></div>
   <div className="output-metric"><span>PROFIT / LOSS</span><strong className={(s?.profit??0)>=0?'green':'red'}>{usd(s?.profit??0)}</strong></div>
   <div className="output-metric"><span>REMAINING TO TARGET</span><strong>{usd(s?.profitTargetRemaining??IRON_1K.targetProfit)}</strong></div>
  </div>
  <div className="prop-native-limits">
   {meters.map(m=><div className="output-metric prop-native-limit" key={m.label}>
    <div className="prop-native-meter-label"><span>{m.label}</span><strong>{m.value}</strong></div>
    <progress aria-label={m.label} max={m.maximum||1} value={Math.min(m.maximum||1,Math.max(0,m.used))} className={m.tone}/>
   </div>)}
  </div>
  {s&&<div className="prop-native-outcome"><span className={passed?'green':failed?'red':''}>{passed?'PASS':failed?'BREACH':'TARGET NOT MET'}</span><span>{s.reason}</span><small>{s.completedTrades} simulated trades · {percent(s.riskPercent)}% initial risk per trade{s.endedAt?` · ${new Date(s.endedAt*1000).toLocaleString()}`:''}</small></div>}
  {busy&&<p className="output-disclaimer">Running evaluation…</p>}
  <p className="output-disclaimer">Historical estimate, not your connected PropDAO account. Daily allowance resets at 00:00 UTC; margin, funding, actual fills and firm-specific exceptions are not verified.</p>
 </section>;
}
