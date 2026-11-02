import {venueOf} from '../shared/venues';
import type {CloudBot} from './firebase';
// Firestore documents can contain older or incomplete metadata. The document
// path owns identity; a stored `id` field must never redirect an action.
export function cloudBotFromRecord(id:string,input:unknown):CloudBot{
 const row=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,any>:{};
 const b=row.lastBacktest;
 const validBacktest=b&&typeof b==='object'&&b.metrics&&typeof b.metrics==='object'&&!Array.isArray(b.metrics)&&Number.isFinite(b.candleCount)&&typeof b.from==='string'&&typeof b.to==='string';
 const money=b?.money;
 return {id,venue:venueOf(row.venue),name:typeof row.name==='string'&&row.name.trim()?row.name:'Untitled robot',asset:typeof row.asset==='string'&&/^[a-zA-Z0-9_:.@-]{1,64}$/.test(row.asset)?row.asset:'',prompt:typeof row.prompt==='string'?row.prompt:'',...(typeof row.code==='string'?{code:row.code}:{}),...(typeof row.storage?.key==='string'?{storageKey:row.storage.key}:{}),updatedAt:row.updatedAt,lastBacktest:validBacktest?{metrics:b.metrics,candleCount:b.candleCount,from:b.from,to:b.to,...(money?.currency==='ZAR'&&Number.isFinite(money.netProfit)&&Number.isFinite(money.returnPercent)?{money:{netProfit:money.netProfit,returnPercent:money.returnPercent,currency:'ZAR' as const}}:{})}:null};
}
