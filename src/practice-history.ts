import type {WorkoutId} from './practice-workouts';
import type {ReplayTrade} from './market-replay-engine';
export type PracticeRecord={id:string;kind:WorkoutId|'free';day:string;completedAt:string;candlesViewed:number;tradeCount:number;net:number;currency?:'USD'|'ZAR';asset?:'XAUUSD';notes:string;trades?:ReplayTrade[];annotations?:Record<string,string>};
// A clean Market Replay journal, separate from retired workout history.
const key=(uid:string)=>`trading-vibes:replay-trade-history:v2:${uid}`;
type Entry={record:PracticeRecord;synced:boolean};
export function readLocalHistory(uid:string):Entry[]{
 try{const data=JSON.parse(localStorage.getItem(key(uid))||'[]');return Array.isArray(data)?data.filter((entry:any)=>entry?.record?.id&&typeof entry.record.completedAt==='string'):[]}catch{return []}
}
export function saveLocalHistory(uid:string,record:PracticeRecord,synced=false){
 const entries=readLocalHistory(uid).filter(entry=>entry.record.id!==record.id);
 entries.unshift({record,synced});
 localStorage.setItem(key(uid),JSON.stringify(entries));
}
export function mergePracticeHistory(local:Entry[],remote:PracticeRecord[]):PracticeRecord[]{
 const records=new Map(remote.map(record=>[record.id,record]));
 for(const entry of local)if(!entry.synced||!records.has(entry.record.id))records.set(entry.record.id,entry.record);
 return [...records.values()].sort((a,b)=>b.completedAt.localeCompare(a.completedAt));
}
export async function syncPracticeHistory(uid:string,client:{savePracticeRecord:(record:PracticeRecord)=>Promise<void>}){
 for(const entry of readLocalHistory(uid))if(!entry.synced){await client.savePracticeRecord(entry.record);saveLocalHistory(uid,entry.record,true)}
}

export function removeLocalPracticeRecord(uid:string,id:string){
 const entries=readLocalHistory(uid).filter(item=>item.record.id!==id);
 localStorage.setItem(key(uid),JSON.stringify(entries));
}
export function clearLocalPracticeHistory(uid:string){localStorage.removeItem(key(uid));}
