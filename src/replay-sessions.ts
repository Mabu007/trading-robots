import type {ReplaySession,ReplayCosts} from './market-replay-engine';
import type {ReplayTimeline} from './replay-timeline';
export type StoredReplayWorkspace={
 version:5;id:string;day:string;asset:'XAUUSD';name:string;
 firstTimestamp:number;lastTimestamp:number;session:ReplaySession;firstIndex:number;
 notes:string;costs:ReplayCosts;annotations:Record<string,string>;
 startedAt:string;elapsedSeconds:number;lastActiveAt:string;
 timeline?:ReplayTimeline;
};
export type WorkspaceSummary={id:string;name:string;day:string;updatedAt:string;elapsedSeconds:number;tradeCount:number;lastIndex?:number};
export const workspaceIndexKey=(uid:string)=>`trading-vibes:replay-workspaces:v1:${uid}`;
export const workspaceKey=(uid:string,id:string)=>`trading-vibes:replay-workspace:v5:${uid}:${id}`;
export function listLocalWorkspaces(uid:string):WorkspaceSummary[]{
 try{
  const raw=JSON.parse(localStorage.getItem(workspaceIndexKey(uid))||'[]');
  return Array.isArray(raw)?raw.filter(v=>v&&typeof v.id==='string'&&typeof v.day==='string'&&typeof v.name==='string').sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))):[];
 }catch{return []}
}
export function getLocalWorkspace(uid:string,id:string):StoredReplayWorkspace|null{
 try{
  const raw=localStorage.getItem(workspaceKey(uid,id));if(!raw)return null;
  const parsed=JSON.parse(raw);
  return parsed?.version===5&&parsed.id===id&&parsed.session&&typeof parsed.day==='string'?parsed:null;
 }catch{return null}
}
export function saveLocalWorkspace(uid:string,snapshot:StoredReplayWorkspace){
 if(snapshot.version!==5||!snapshot.id||!snapshot.session)throw new Error('Invalid workspace');
 localStorage.setItem(workspaceKey(uid,snapshot.id),JSON.stringify(snapshot));
 const summaries=listLocalWorkspaces(uid).filter(item=>item.id!==snapshot.id);
 summaries.unshift({id:snapshot.id,name:snapshot.name,day:snapshot.day,updatedAt:snapshot.lastActiveAt,elapsedSeconds:snapshot.elapsedSeconds,tradeCount:snapshot.session.trades.length,lastIndex:snapshot.session.index});
 localStorage.setItem(workspaceIndexKey(uid),JSON.stringify(summaries.slice(0,300)));
}
export function renameLocalWorkspace(uid:string,id:string,name:string){
 const next=name.trim().slice(0,80);if(!next)return false;
 const existing=getLocalWorkspace(uid,id);if(!existing)return false;
 saveLocalWorkspace(uid,{...existing,name:next,lastActiveAt:new Date().toISOString()});return true;
}
export function clearLocalWorkspaces(uid:string){
 for(const item of listLocalWorkspaces(uid))localStorage.removeItem(workspaceKey(uid,item.id));
 localStorage.removeItem(workspaceIndexKey(uid));
}
export const formatPracticeDuration=(seconds:number)=>{
 const mins=Math.floor(Math.max(0,seconds)/60),hours=Math.floor(mins/60);
 return hours?hours+'h '+String(mins%60).padStart(2,'0')+'m':mins+'m';
};

/** One-time, non-destructive upgrade of pre-workspace day-keyed saves. */
export function migrateLegacyReplaySaves(uid:string):number{
 const prefix=`trading-vibes:replay:zar:v4:${uid}:XAUUSD:`;
 let migrated=0;
 for(let i=0;i<localStorage.length;i++){
  const key=localStorage.key(i);
  if(!key?.startsWith(prefix))continue;
  try{
   const saved=JSON.parse(localStorage.getItem(key)||'null');
   if(saved?.version!==4||saved.asset!=='XAUUSD'||!saved.session||!Array.isArray(saved.session.trades))continue;
   const id=typeof saved.attemptId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(saved.attemptId)?saved.attemptId:'legacy-'+String(saved.day||'unknown').replace(/[^0-9]/g,'');
   if(getLocalWorkspace(uid,id))continue;
   const when=new Date().toISOString();
   saveLocalWorkspace(uid,{version:5,id,day:saved.day,asset:'XAUUSD',name:'Gold · '+saved.day+' · Earlier replay',
    firstTimestamp:saved.firstTimestamp,lastTimestamp:saved.lastTimestamp,session:saved.session,
    firstIndex:saved.firstIndex||0,notes:saved.notes||'',costs:saved.costs,
    annotations:saved.annotations||{},startedAt:when,elapsedSeconds:0,lastActiveAt:when,
    timeline:saved.timeline||undefined});
   migrated++;
  }catch{/* Never modify or delete the original v4 data. */}
 }
 return migrated;
}
