export type ReviewIdentity={uid:string;botId:string;code:string;venue:string};
export type ActionReview={identity:ReviewIdentity;expiresAt:number;consumed:boolean};
export function createActionReview(identity:ReviewIdentity,now=Date.now()):ActionReview{return {identity:{...identity},expiresAt:now+120000,consumed:false}}
export function consumeActionReview(review:ActionReview|null,identity:ReviewIdentity,now=Date.now()):boolean{
 if(!review||review.consumed||now>=review.expiresAt)return false;
 if((Object.keys(identity) as (keyof ReviewIdentity)[]).some(k=>identity[k]!==review.identity[k]))return false;
 review.consumed=true;return true;
}
