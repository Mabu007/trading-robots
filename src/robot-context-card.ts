/** Compact, scoped chat evidence. Account-wide trades must never silently
 * become robot results because a model asked to diagnose that robot.
 */
export type RobotCardEvidence={
 available:boolean;robotId:string|null;accountId:string|null;instrument:string|null;
 timeframe:string|null;revision:string|null;running:'running'|'paused'|'stopped'|'unverified';
 lastDecision:{action:string;reason:string|null;time:number|null}|null;
 brokerExposure:string;brokerExposureVerified:boolean;
 today:{verifiedTrades:number;probableTrades:number;verifiedAndProbableReportedPnl:number|null;
  accountRecentLossesWithoutRobotProof:number;partial:boolean;unattributedStatement:string}|null;
 issue:string|null;source:'owner-checked deployed grant and Worker state';
};
const str=(v:unknown)=>typeof v==='string'&&v.length<=160?v:null;
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function robotCardEvidence(environment:unknown,desk:unknown):RobotCardEvidence{
 const env=environment&&typeof environment==='object'?environment as Record<string,unknown>:{};
 const selection=env.selection&&typeof env.selection==='object'?env.selection as Record<string,unknown>:{};
 const worker=env.worker&&typeof env.worker==='object'?env.worker as Record<string,unknown>:{};
 const result=desk&&typeof desk==='object'?desk as Record<string,unknown>:{};
 const robotId=str(selection.robotId);
 const accountId=str(selection.accountId);
 const liveState=env.kind==='paused'?'paused':env.kind==='resolved'&&worker.running===true?'running':
  env.kind==='inactive'?'stopped':'unverified';
 const last=worker.lastEvaluation&&typeof worker.lastEvaluation==='object'?
  worker.lastEvaluation as Record<string,unknown>:null;
 const decisions=Array.isArray(worker.recentDecisions)?worker.recentDecisions:[];
 const latest=last??(decisions.length?decisions.at(-1):null);
 const decision=latest&&typeof latest==='object'?latest as Record<string,unknown>:null;
 const rows=Array.isArray(result.byRobot)?result.byRobot:[];
 const robotRow=rows.find(x=>x&&typeof x==='object'&&x.botId===robotId) as
  {verified?:number;probable?:number;pnl?:number}|undefined;
 const losses=Array.isArray(result.recentLosses)?result.recentLosses:[];
 const accountUnknown=accountId?losses.filter(x=>x&&typeof x==='object'&&
  x.accountId===accountId&&(x.botId===null||x.attribution==='conflicting-evidence')).length:0;
 const coverage=result.available===true?{
  verifiedTrades:num(robotRow?.verified)??0,probableTrades:num(robotRow?.probable)??0,
  verifiedAndProbableReportedPnl:num(robotRow?.pnl),
  accountRecentLossesWithoutRobotProof:accountUnknown,
  partial:result.partial===true,
  unattributedStatement:'Account-only trades and probable matches are not verified robot losses. Profitability cannot be inferred from unattributed fills.'
 }:null;
 return {available:!!robotId&&!!accountId&&(env.kind==='resolved'||env.kind==='paused'),
  robotId,accountId,instrument:str(selection.instrument),timeframe:str(selection.executionTimeframe),
  revision:str(selection.strategyCodeHash),running:liveState,
  lastDecision:decision?{action:str(decision.action)??'unknown',
   reason:str(decision.reason),time:num(decision.time)??num(decision.candleClose)}:null,
  brokerExposure:worker.brokerExposureVerified===true?str(worker.brokerExposure)??'unknown':'unknown',
  brokerExposureVerified:worker.brokerExposureVerified===true,
  today:coverage,
  issue:!robotId?str(env.reason)??'No unique owner-verified robot identified':liveState==='unverified'?
   'Worker runtime is unverified; no claims about running status, positions or robot losses are possible.':null,
  source:'owner-checked deployed grant and Worker state'};
}
