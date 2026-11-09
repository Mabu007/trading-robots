/** Guardrails for explicit PropDAO free Iron $1K evaluation-autonomy.
 * Broker risk service remains authoritative; no equity data => stop new entries.
 */
export type EvaluationEnvelope={demoOnly:true;taskId:string;policyFingerprint:string;maxDailyLossPct:number;maxDrawdownPct:number;startingEquity:number};
export function evaluateAutonomousEquity(envelope:EvaluationEnvelope,nowEquity:unknown,dailyStartEquity:unknown,
 risk:{breached?:unknown;roomUsd?:unknown},riskUsd:number){
 const deny=(reason:string)=>({canEnter:false as const,reason});
 if(envelope.demoOnly!==true||!Number.isFinite(envelope.startingEquity)||envelope.startingEquity<=0||
  !Number.isFinite(envelope.maxDailyLossPct)||envelope.maxDailyLossPct<=0||envelope.maxDailyLossPct>2||
  !Number.isFinite(envelope.maxDrawdownPct)||envelope.maxDrawdownPct<=0||envelope.maxDrawdownPct>5||
  typeof nowEquity!=='number'||!Number.isFinite(nowEquity)||
  typeof dailyStartEquity!=='number'||!Number.isFinite(dailyStartEquity)||
  !Number.isFinite(risk.roomUsd)||risk.breached!==false)return deny('Broker equity, risk room, or authorization cannot be verified');
 const floor=envelope.startingEquity*(1-envelope.maxDrawdownPct/100);
 const dailyFloor=dailyStartEquity*(1-envelope.maxDailyLossPct/100);
 if(nowEquity<=floor)return deny('Static evaluation drawdown protection triggered');
 if(nowEquity<=dailyFloor)return deny('Daily evaluation loss protection triggered');
 if((risk.roomUsd as number)<=riskUsd*4)return deny('Broker risk room too small for a new entry');
 return {canEnter:true as const,reason:'Equity, daily loss, static drawdown, and broker risk room within limits'};
}
