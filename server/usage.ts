import {randomUUID} from 'node:crypto';
import type {RecordStore} from './firestore-store.ts';
export type AIUsage={provider:string;model:string;inputTokens?:number;outputTokens?:number;status:'completed'|'failed'|'interrupted'};
// Provider adapters supply measured tokens. Missing usage is unknown, never estimated as a charge.
export async function recordAIUsage(store:RecordStore,uid:string,usage:AIUsage){
 const inputTokens=Number.isSafeInteger(usage.inputTokens)&&usage.inputTokens!>=0?usage.inputTokens:null;
 const outputTokens=Number.isSafeInteger(usage.outputTokens)&&usage.outputTokens!>=0?usage.outputTokens:null;
 await store.create(`resourceUsage/${randomUUID()}`,{uid,kind:'ai',...usage,inputTokens,outputTokens,requests:1,billingStatus:'unbilled',plan:'free_test',createdAt:Date.now()});
}
