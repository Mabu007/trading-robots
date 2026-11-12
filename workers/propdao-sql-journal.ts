/** Durable Object SQLite trading evidence. SQL is the live source of truth;
 * Firebase is an eventually consistent archive. This never submits orders.
 * Each row is idempotent, and rows are not deleted on failed transfer. */
export type JournalKind='trade'|'event'|'decision';
export type JournalRow={kind:JournalKind;key:string;grantId:string;accountId:string;botId:string;time:number;payload:Record<string,unknown>};
type Cursor={toArray:()=>Array<Record<string,unknown>>};
export type SqlHandle={exec:(sql:string,...bindings:(string|number|null)[])=>Cursor};
const tables:Record<JournalKind,string>={trade:'tv_broker_trades',event:'tv_execution_events',decision:'tv_strategy_decisions'};
function safeRow(row:JournalRow){
 return row&&['trade','event','decision'].includes(row.kind)&&typeof row.key==='string'&&row.key.length>0&&row.key.length<=400&&
  typeof row.grantId==='string'&&row.grantId.length<=120&&typeof row.accountId==='string'&&row.accountId.length>0&&row.accountId.length<=140&&
  typeof row.botId==='string'&&row.botId.length>0&&row.botId.length<=140&&Number.isFinite(row.time)&&
  row.payload&&typeof row.payload==='object'&&!Array.isArray(row.payload);
}
const safeLimit=(x:number,max=200)=>Number.isInteger(x)?Math.min(max,Math.max(1,x)):50;
export class PropDAOSqlJournal{
 constructor(private readonly sql:SqlHandle){
  for(const table of Object.values(tables)){
   this.sql.exec(`CREATE TABLE IF NOT EXISTS ${table}(
     row_key TEXT PRIMARY KEY, grant_id TEXT NOT NULL, account_id TEXT NOT NULL,
     bot_id TEXT NOT NULL, event_time INTEGER NOT NULL, payload TEXT NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
   )`);
   this.sql.exec(`CREATE INDEX IF NOT EXISTS ${table}_archived ON ${table}(archived,event_time)`);
  }
 }
 put(row:JournalRow){
  if(!safeRow(row))throw Error('Invalid SQL journal row');
  const payload=JSON.stringify(row.payload);
  if(payload.length>24000)throw Error('SQL journal payload too large');
  this.sql.exec(`INSERT OR IGNORE INTO ${tables[row.kind]}(row_key,grant_id,account_id,bot_id,event_time,payload,created_at)
   VALUES(?,?,?,?,?,?,?)`,row.key,row.grantId,row.accountId,row.botId,row.time,payload,Date.now());
 }
 read(kind:JournalKind,limit=50,after?:number){
  const table=tables[kind],bounded=safeLimit(limit,200);
  const cursor=after===undefined?
   this.sql.exec(`SELECT row_key,grant_id,account_id,bot_id,event_time,payload,archived FROM ${table} ORDER BY event_time DESC, row_key DESC LIMIT ?`,bounded):
   this.sql.exec(`SELECT row_key,grant_id,account_id,bot_id,event_time,payload,archived FROM ${table} WHERE event_time <= ? ORDER BY event_time DESC, row_key DESC LIMIT ?`,after,bounded);
  return cursor.toArray().map(r=>({
   kind,key:String(r.row_key),grantId:String(r.grant_id),accountId:String(r.account_id),
   botId:String(r.bot_id),time:Number(r.event_time),payload:JSON.parse(String(r.payload)) as Record<string,unknown>,
   archived:Number(r.archived)===1
  }));
 }
 pending(max=60){
  const remaining=safeLimit(max,120);
  const collected:Array<ReturnType<PropDAOSqlJournal['read']>[number]>=[];
  for(const kind of ['trade','event','decision'] as JournalKind[]){
   const rows=this.sql.exec(`SELECT row_key,grant_id,account_id,bot_id,event_time,payload,archived
    FROM ${tables[kind]} WHERE archived=0 ORDER BY event_time ASC LIMIT ?`,remaining-collected.length).toArray();
   for(const r of rows)collected.push({kind,key:String(r.row_key),grantId:String(r.grant_id),
    accountId:String(r.account_id),botId:String(r.bot_id),time:Number(r.event_time),
    payload:JSON.parse(String(r.payload)) as Record<string,unknown>,archived:false});
   if(collected.length>=remaining)break;
  }
  return collected;
 }
 acknowledge(rows:Array<{kind:JournalKind;key:string}>){
  for(const row of rows){
   if(!tables[row.kind]||typeof row.key!=='string'||row.key.length>400)throw Error('Invalid archival acknowledgement');
   this.sql.exec(`UPDATE ${tables[row.kind]} SET archived=1 WHERE row_key=?`,row.key);
  }
 }
 pendingCount(){
  return (Object.values(tables).reduce((n,table)=>n+Number(this.sql.exec(`SELECT COUNT(*) AS n FROM ${table} WHERE archived=0`).toArray()[0]?.n||0),0));
 }
 counts(){
  return Object.fromEntries((Object.entries(tables) as [JournalKind,string][]).map(([kind,table])=>{
   const r=this.sql.exec(`SELECT COUNT(*) AS total, SUM(CASE WHEN archived=0 THEN 1 ELSE 0 END) AS pending FROM ${table}`).toArray()[0];
   return [kind,{total:Number(r?.total||0),pending:Number(r?.pending||0)}];
  }));
 }
}



/** Next bounded Firestore transfer for a live Durable Object.
 * No pending evidence means no archive request; broker reconciliation still
 * runs on its own schedule. Failed deliveries back off without losing rows. */
export function nextLiveArchiveAt(now:number,lastAttempt:number,failures:number,pending:number):number|null{
 if(pending<=0)return null;
 if(!Number.isFinite(now)||!Number.isFinite(lastAttempt)||!Number.isFinite(failures))
  throw Error('Invalid archival schedule');
 const count=Math.max(0,Math.floor(failures));
 const interval=count>0?
  Math.min(30*60_000,60_000*2**Math.min(5,count-1)):
  pending>60?60_000:5*60_000;
 return lastAttempt>0?lastAttempt+interval:now;
}

/** Alarm planning is independent of the trading engine. A stopped robot can
 * still need broker close reconciliation or Firebase delivery; NO new entries. */
export function reconciliationAlarm(input:{
 running:boolean;paused:boolean;pendingArchive:number;flatVerified:boolean;
 unresolvedIntent:boolean;now:number;nextTradingCandle?:number;
}):number|null{
 if(input.running)return typeof input.nextTradingCandle==='number'&&Number.isFinite(input.nextTradingCandle)?
  Math.max(input.now+1000,input.nextTradingCandle):input.now+60000;
 if(input.paused||input.pendingArchive>0||!input.flatVerified||input.unresolvedIntent)
  return input.now+300000;
 return null;
}
