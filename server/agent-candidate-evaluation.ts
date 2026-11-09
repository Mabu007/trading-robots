/**
 * Independently compares immutable completed-candle simulations before research
 * approval. This does not certify challenge success or broker execution parity.
 */
type Metrics={trades:number;netReturn:number;profitFactor:number;maxDrawdown:number;winRate:number};
export type CandidateWindow={
 codeHash:string;coin:string;venue:string;reportId:string;
 from:string;toExclusive:string;tradeCount:number;worstLossR:number;
 metrics:Metrics;assumptions:{spread:number;slippage:number;commissionR:number};
 quality:'reference';dataGaps:number;source:string;
};
export type CandidateEvaluation={
 acceptedForResearchReview:boolean;deployable:false;
 codeHash:string|null;rejectionReasons:string[];
 assessedWindows:number;totalTrades:number;worstLossR:number|null;
 maxDrawdownAtRiskPct:number|null;
 trainNetR:number|null;holdoutNetR:number|null;
 policy:'reference-research-only';assumptions:string[];
};
const isFinite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const minTrades=25;
export function evaluateCandidateWindows(runs:CandidateWindow[],riskPercent:number):CandidateEvaluation{
 const failures:string[]=[];
 const enough=Array.isArray(runs)&&runs.length>=2&&runs.length<=8;
 if(!enough)failures.push('At least two separate, immutable train and untouched holdout windows are required.');
 const sorted=[...(Array.isArray(runs)?runs:[])].sort((a,b)=>Date.parse(a.from)-Date.parse(b.from));
 const base=sorted[0];
 if(!isFinite(riskPercent)||riskPercent<=0||riskPercent>0.5)failures.push('Risk per trade exceeds the 0.5% research maximum.');
 for(const [i,run]of sorted.entries()){
  if(!run||run.quality!=='reference'||!/^[a-f0-9]{64}$/.test(run.codeHash??'')||
   !/^backtest_[a-f0-9]{32}$/.test(run.reportId??'')||
   typeof run.coin!=='string'||typeof run.source!=='string'||!run.source.includes('Hyperliquid')||
   !isFinite(run.tradeCount)||!isFinite(run.worstLossR)||!isFinite(run.metrics?.netReturn)||
   !isFinite(run.metrics?.maxDrawdown)||!isFinite(run.metrics?.profitFactor)){
   failures.push('A backtest report has unverifiable identity, source or metrics.');continue;
  }
  if(base&&(base.codeHash!==run.codeHash||base.coin!==run.coin))failures.push('Train and holdout simulations use different strategy hashes or instruments.');
  if(!isFinite(run.assumptions?.spread)||!isFinite(run.assumptions?.slippage)||!isFinite(run.assumptions?.commissionR)||
    run.assumptions.spread<0||run.assumptions.slippage<0||run.assumptions.commissionR<0||
    run.assumptions.spread+run.assumptions.slippage+run.assumptions.commissionR<=0)
    failures.push('No realistic positive transaction cost assumption was applied.');
  if(run.dataGaps!==0)failures.push('Incomplete market candle coverage is not allowed.');
  if(!Number.isFinite(Date.parse(run.from))||!Number.isFinite(Date.parse(run.toExclusive))||Date.parse(run.from)>=Date.parse(run.toExclusive))
    failures.push('Invalid backtest interval.');
  if(i>0&&Date.parse(sorted[i-1].toExclusive)>Date.parse(run.from))failures.push('Evaluation intervals overlap; the holdout must be chronologically disjoint.');
 }
 const trades=sorted.reduce((total,run)=>total+(isFinite(run?.tradeCount)?run.tradeCount:0),0);
 const worst=sorted.every(run=>isFinite(run?.worstLossR))?Math.min(...sorted.map(run=>run.worstLossR)):null;
 const dd=sorted.every(run=>isFinite(run?.metrics?.maxDrawdown))?Math.max(...sorted.map(run=>run.metrics.maxDrawdown))*(isFinite(riskPercent)?riskPercent:0):null;
 const train=sorted[0],holdout=sorted.at(-1);
 if(trades<minTrades)failures.push('Only '+trades+' trades; at least '+minTrades+' trades across windows are required for initial screening.');
 if(!holdout||holdout.tradeCount<8)failures.push('Holdout contains fewer than eight completed simulated trades.');
 if(!train||train.metrics.netReturn<=0||train.metrics.profitFactor<1.2)failures.push('Training window fails minimum reference profitability criteria.');
 if(!holdout||holdout.metrics.netReturn<=0||holdout.metrics.profitFactor<1.2)failures.push('Holdout window does not demonstrate positive simulated performance with minimum profit factor.');
 if(worst===null||worst< -1.5)failures.push('Oversized simulated single-trade loss; investigate before considering prop-firm execution.');
 if(dd===null||dd>2)failures.push('Reference drawdown at configured risk exceeds 2% research guardrail.');
 return {
  acceptedForResearchReview:failures.length===0,deployable:false,codeHash:base?.codeHash??null,
  rejectionReasons:[...new Set(failures)],assessedWindows:sorted.length,totalTrades:trades,
  worstLossR:worst,maxDrawdownAtRiskPct:dd,trainNetR:train?.metrics?.netReturn??null,holdoutNetR:holdout?.metrics?.netReturn??null,
  policy:'reference-research-only',
  assumptions:['Hyperliquid completed-candle reference results, not PropDAO fills.',
   'No PropDAO broker-equity path, intrabar execution, challenge-specific constraints, funding or true forward out-of-sample verified.',
   'Passing this screen permits review, not automated or manual deployment.']
 };
}
