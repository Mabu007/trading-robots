import type {Limits} from './valr-risk';
export const LIVE_ACKNOWLEDGEMENT='I AUTHORIZE LIVE VALR TRADING';
export type LiveGrant={id:string;uid:string;botId:string;pair:string;code:string;codeHash:string;keyId:string;issuedAt:number;expiresAt:number;limits:Omit<Limits,'authorized'>};
export function validateLiveGrant(grant:LiveGrant,now:number){
 if(!grant||!/^[a-f0-9]{64}$/.test(grant.id)||!/^[a-f0-9]{64}$/.test(grant.codeHash)||!/^[a-f0-9]{64}$/.test(grant.keyId)||typeof grant.uid!=='string'||!grant.uid||grant.uid.length>128||!/^[A-Za-z0-9_-]{1,100}$/.test(grant.botId)||!/^[A-Z0-9]{3,30}$/.test(grant.pair)||typeof grant.code!=='string'||!grant.code.trim()||grant.code.length>180000)throw Error('Invalid live authorization');
 if(!Number.isSafeInteger(grant.issuedAt)||!Number.isSafeInteger(grant.expiresAt)||grant.issuedAt>now+1000||grant.expiresAt<=now||grant.expiresAt<=grant.issuedAt||grant.expiresAt>grant.issuedAt+86400000)throw Error('Live authorization expired or invalid');
 const l=grant.limits;if(!l||typeof l.allocation!=='string'||!/^\d+(?:\.\d{1,18})?$/.test(l.allocation)||l.allocation.length>40||Number(l.allocation)<=0)throw Error('Invalid live allocation');
 for(const [value,min,max] of [[l.riskBps,1,200],[l.dailyLossBps,10,1000],[l.maxSpreadBps,1,1000],[l.slippageBps,0,500],[l.feeBps,0,1000],[l.maxPriceAgeMs,500,10000]] as const)if(!Number.isInteger(value)||value<min||value>max)throw Error('Invalid live risk limits');
}
