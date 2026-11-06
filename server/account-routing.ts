import {z} from 'zod';
export const accountTargetSchema=z.object({
  connectionId:z.string().min(1).max(128),
  brokerAccountId:z.string().min(1).max(128),
  venueId:z.enum(['ctrader','propdao','valr','hyperliquid'])
}).strict();
export type BrokerAccountTarget=z.infer<typeof accountTargetSchema>;
export type OwnedBrokerAccount=BrokerAccountTarget & {ownerUid:string};
export function resolveOwnedAccount(uid:string, records:readonly OwnedBrokerAccount[], requested:unknown):OwnedBrokerAccount{
  const target=accountTargetSchema.parse(requested);
  const matched=records.filter(r=>r.ownerUid===uid && r.connectionId===target.connectionId && r.brokerAccountId===target.brokerAccountId && r.venueId===target.venueId);
  if(matched.length!==1)throw new Error('Trading account could not be uniquely verified for the signed-in user.');
  return matched[0];
}
export function ownedAccounts(uid:string,records:readonly OwnedBrokerAccount[]){return records.filter(r=>r.ownerUid===uid);}
