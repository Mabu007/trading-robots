export const TF_SECONDS: Record<string, number> = { m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400,d1:86400 };
export type Payment = { id:string;botId:string;creatorId:string;customerId:string;grossMinor:number;feeMinor:number;creatorMinor:number;currency:string;provider:'yoco';status:'pending'|'successful'|'refunded'|'disputed'|'failed';payoutStatus:'pending'|'completed'|'not_due';createdAt:number;verifiedAt?:number;providerEventId?:string };
export function verifiedRevenue(payments:Payment[]) {
  const result={grossMinor:0,feeMinor:0,creatorMinor:0,paidSales:0,pendingPayoutMinor:0,completedPayoutMinor:0}; const seen=new Set<string>();
  for(const p of payments){
    if(p.status!=='successful'||!p.verifiedAt||!p.providerEventId||p.provider!=='yoco'||seen.has(p.providerEventId))continue;
    if(![p.grossMinor,p.feeMinor,p.creatorMinor].every(n=>Number.isSafeInteger(n)&&n>=0)||p.feeMinor+p.creatorMinor!==p.grossMinor)throw Error('Invalid verified ledger amount');
    seen.add(p.providerEventId);result.grossMinor+=p.grossMinor;result.feeMinor+=p.feeMinor;result.creatorMinor+=p.creatorMinor;result.paidSales++;
    if(![result.grossMinor,result.feeMinor,result.creatorMinor].every(Number.isSafeInteger))throw Error('Verified ledger totals exceed safe integer limits');
    if(p.payoutStatus==='completed')result.completedPayoutMinor+=p.creatorMinor;else if(p.payoutStatus==='pending')result.pendingPayoutMinor+=p.creatorMinor;
  }
  return result;
}
