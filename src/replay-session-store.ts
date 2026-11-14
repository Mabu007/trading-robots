import type {ReplaySession} from './market-replay-engine';
import type {ReplayTimeline} from './replay-timeline';
import type {ReplayCosts} from './market-replay-engine';

export type ReplayArchive={
 version:5;
 id:string;
 name:string;
 asset:'XAUUSD';
 day:string;
 startClock:string;
 startingBalance:number;
 firstTimestamp:number;
 lastTimestamp:number;
 firstIndex:number;
 session:ReplaySession;
 timeline:ReplayTimeline|null;
 costs:ReplayCosts;
 notes:string;
 annotations:Record<string,string>;
 activeSeconds:number;
 createdAt:string;
 updatedAt:string;
};
export type ReplayArchiveSummary=Pick<ReplayArchive,'id'|'name'|'day'|'asset'|'updatedAt'|'createdAt'|'activeSeconds'|'startingBalance'> & {tradeCount:number;lastTime:number};
export const archiveKey=(uid:string,id:string)=>`trading-vibes:replay-session:v5:${uid}:${id}`;
const prefix=(uid:string)=>`trading-vibes:replay-session:v5:${uid}:`;
export const validArchiveId=(id:string)=>/^[a-zA-Z0-9-]{1,80}$/.test(id);
export function summarizeReplayArchive(value:ReplayArchive):ReplayArchiveSummary{
 return {id:value.id,name:value.name,day:value.day,asset:value.asset,updatedAt:value.updatedAt,createdAt:value.createdAt,activeSeconds:value.activeSeconds,startingBalance:value.startingBalance,tradeCount:value.session.trades.length,lastTime:value.session.index};
}
export function formatReplayDuration(seconds:number):string{
 const value=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));
 if(value<60)return `${value}s`;
 if(value<3600)return `${Math.floor(value/60)}m ${String(value%60).padStart(2,'0')}s`;
 return `${Math.floor(value/3600)}h ${String(Math.floor(value%3600/60)).padStart(2,'0')}m`;
}
export function readLocalReplayArchive(uid:string,id:string):ReplayArchive|null{
 if(!validArchiveId(id))return null;
 try{
  const value=JSON.parse(localStorage.getItem(archiveKey(uid,id))||'null') as ReplayArchive|null;
  if(value?.version!==5||value.id!==id||!value.session||!Array.isArray(value.session.trades)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(value.day))return null;
  return value;
 }catch{return null}
}
export function listLocalReplayArchives(uid:string):ReplayArchiveSummary[]{
 const list:ReplayArchiveSummary[]=[];
 try{
  for(let i=0;i<localStorage.length;i++){
   const key=localStorage.key(i);
   if(!key?.startsWith(prefix(uid)))continue;
   const value=readLocalReplayArchive(uid,key.slice(prefix(uid).length));
   if(value)list.push(summarizeReplayArchive(value));
  }
 }catch{/* Storage can be disabled. */}
 return list.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export function saveLocalReplayArchive(uid:string,archive:ReplayArchive):void{
 if(!validArchiveId(archive.id))throw Error('Invalid replay session identifier');
 localStorage.setItem(archiveKey(uid,archive.id),JSON.stringify(archive));
}
export function removeLocalReplayArchive(uid:string,id:string){if(validArchiveId(id))localStorage.removeItem(archiveKey(uid,id))}
export function mergeReplaySummaries(local:ReplayArchiveSummary[],remote:ReplayArchiveSummary[]):ReplayArchiveSummary[]{
 const items=new Map(remote.map(item=>[item.id,item]));
 for(const item of local){const existing=items.get(item.id);if(!existing||item.updatedAt>existing.updatedAt)items.set(item.id,item)}
 return [...items.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
