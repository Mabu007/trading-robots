import type {PropDAOSimulation} from '../propdao-evaluation';
import {IRON_1K} from '../propdao-evaluation';

const usd=(v:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
const pct=(v:number)=>Math.max(0,v).toFixed(2);
export function PropDAOEvaluationPanel({simulation,busy=false}:{simulation:PropDAOSimulation|null;busy?:boolean}){
 const s=simulation;const passed=s?.status==='passed',failed=Boolean(s?.status?.startsWith('failed'));
 return <section className="prop-evaluation" aria-label="PropDAO historical evaluation simulator">
  <div className="prop-evaluation-head"><div><span>IRON $1K · PRO</span><strong>PropDAO evaluation simulator</strong></div><span className={'prop-evaluation-status '+(passed?'pass':failed?'fail':'pending')}>{!s?'NOT TESTED':passed?'PASSED':failed?'FAILED':'NOT PASSED'}</span></div>
  <div className="prop-equity"><div><span>Equity</span><strong>{usd(s?.equity??IRON_1K.startingBalance)}</strong></div><div><span>Balance</span><strong>{usd(s?.balance??IRON_1K.startingBalance)}</strong></div><div><span>Available (estimated)</span><strong>{usd(s?.available??IRON_1K.startingBalance)}</strong></div></div>
  <div className="prop-meters">
   <div><label><span>Static drawdown used</span><b>{pct((s?.drawdownUsed??0)/IRON_1K.startingBalance*100)} of 5.00%</b></label><progress max="50" value={Math.min(50,s?.drawdownUsed??0)}/></div>
   <div><label><span>Daily loss used (UTC)</span><b>{pct((s?.dailyLossUsed??0)/Math.max(1,(s?.dailyAllowance??IRON_1K.maxDailyLoss)/0.02)*100)} of 2.00%</b></label><progress max={s?.dailyAllowance??IRON_1K.maxDailyLoss} value={Math.min(s?.dailyAllowance??IRON_1K.maxDailyLoss,s?.dailyLossUsed??0)}/></div>
   <div><label><span>Profit target</span><b>{pct(s?.profitTargetUsed??0)} of 10.00%</b></label><progress max="100" value={Math.min(100,Math.max(0,(s?.balance??1000)-1000))}/></div>
  </div>
  <div className="prop-target"><strong>{usd(s?.profitTargetRemaining??IRON_1K.targetProfit)} to target</strong><span>{s? `${s.completedTrades} trades · ${pct(s.riskPercent)}% initial risk per trade`: 'Run a backtest to evaluate the challenge'}</span></div>
  {s&&<p className={'prop-evaluation-outcome '+(passed?'pass':failed?'fail':'pending')} role="status">{passed?'PASS':failed?'BREACH':'TARGET NOT MET'} · {s.reason} {s.endedAt?`(${new Date(s.endedAt*1000).toLocaleString()})`:''}</p>}
  <p className="prop-evaluation-note">Historical simulation only, not a connected PropDAO account. Applies 10% target, $50 static equity floor and $20 daily loss limit, resetting daily at 00:00 UTC. Costs use strategy backtest assumptions. Available is estimated equity; margin, venue funding, execution fees and exact firm reset rules are not verified. Intrabar breaches are conservatively estimated from OHLC extremes.</p>
  {busy&&<small>Running evaluation…</small>}
 </section>;
}
