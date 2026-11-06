import type {RecordStore} from './firestore-store.ts';
const watchId=(value:string)=>/^analysis-[a-z0-9_-]{8,110}$/.test(value);
/** Read-only owner-scoped status. A saved pointer alone does not prove that
 * a monitor is running, so runtime failures are explicitly unverified. */
export async function readMonitorStatus(uid:string,id:string,store:RecordStore,request:typeof fetch=fetch,env:NodeJS.ProcessEnv=process.env){
 if(!uid||uid.length>128||uid.includes('/')||!watchId(id))throw Error('Invalid monitor');
 const saved=await store.get('users/'+uid+'/codeWatches/'+id);
 if(!saved)return {id,available:false,verified:false,state:'not-found'};
 const base=String(env.CODE_WATCH_RUNTIME_URL||''),secret=String(env.CODE_WATCH_INTERNAL_SECRET||'');
 if(env.CODE_WATCH_ENABLED!=='true'||!/^https:\/\//.test(base)||secret.length<32)return {id,available:false,verified:false,state:'unavailable'};
 const response=await request(new URL('/watches/'+id+'/status',base),{headers:{Authorization:'Bearer '+secret,'X-TV-UID':uid},signal:AbortSignal.timeout(9000)});
 if(!response.ok)throw Error('Monitor status unavailable');
 const data:any=await response.json();
 if(!data||typeof data.running!=='boolean'||!Array.isArray(data.events))throw Error('Invalid monitor status');
 return {id,available:true,verified:true,running:data.running,lastCandle:typeof data.lastCandle==='number'?data.lastCandle:null,lastCheck:typeof data.lastCheck==='number'?data.lastCheck:null,nextAlarm:typeof data.nextAlarm==='number'?data.nextAlarm:null,eventCount:data.events.length};
}
