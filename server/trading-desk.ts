import {createHash} from 'node:crypto';
import type {RecordStore} from './firestore-store.ts';
import {safeExecutionEvents,type ExecutionEvent} from '../shared/propdao-execution-journal.ts';

type Trade={id:string;symbol:string;side:'BUY'|'SELL';qty:number;entry:number;exit:number;pnl:number;openedAt:number|null;closedAt:number|null;reason:string;fee:number|null;positionId?:string|null;intentId?:string|null};
type Account={accountId:string;status:string};
type Broker={list:(uid:string)=>Promise<{connected:boolean;accounts:Account[]}>;recentTrades:(uid:string,accountId:string)=>Promise<Trade[]>};
type Decision={accountId:string;botId:string;grantId:string;codeHash:string|null;candleClose:number;time:number;action:string;reason:string;checks:unknown[]};
type History=(uid:string,accountId:string)=>Promise<{available:boolean;partial?:boolean;events?:ExecutionEvent[]|null;decisionSnapshots?:Decision[];error?:string}>;
const hash=(...parts:string[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,40);
const validId=(v:string)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const timestamp=(v:number|null)=>{
 if(typeof v!=='number'||!Number.isFinite(v))return null;
 const ms=v>1e11?v:v*1000;
 return ms>=946684800000&&ms<4102444800000?ms:null;
};
export const sastDay=(ms=Date.now())=>new Date(ms+7200000).toISOString().slice(0,10);
const validTrade=(v:any):v is Trade=>v&&typeof v.id==='string'&&v.id.length>0&&v.id.length<161&&
 typeof v.symbol==='string'&&v.symbol.length<=40&&['BUY','SELL'].includes(v.side)&&
 [v.qty,v.entry,v.exit,v.pnl].every((x:unknown)=>typeof x==='number'&&Number.isFinite(x));
const sum=(values:number[])=>Math.round(values.reduce((a,b)=>a+b,0)*1e6)/1e6;

/** Identity attribution is PROVEN only by an exact provider position/intent ID. */
export function attributeTrade(t:Trade,events:ExecutionEvent[]){
 const matches=events.filter(e=>e.stage==='PROTECTED_FILL'&&e.symbol===t.symbol&&e.side===t.side&&
  ((t.positionId&&e.positionId===t.positionId)||(t.intentId&&e.intentId===t.intentId)));
 const identities=[...new Set(matches.map(e=>e.botId+':'+e.grantId))];
 if(identities.length!==1)return {botId:null,grantId:null,attribution:'unattributed'};
 const chosen=matches[0];
 return {botId:chosen.botId,grantId:chosen.grantId,attribution:'exact-provider-identity'};
}
export function summarizeDay(trades:Array<Trade&{accountId:string;botId:string|null;attribution:string}>,day:string,coverage:{
 accountsChecked:number;failures:string[];capped:string[];journalWarnings:string[];ledgerAvailable:boolean;writeFailures:number;
}){
 const unknownTimes=trades.filter(t=>timestamp(t.closedAt)===null).length;
 const today=trades.filter(t=>{const ms=timestamp(t.closedAt);return ms!==null&&sastDay(ms)===day})
  .sort((a,b)=>(timestamp(b.closedAt)||0)-(timestamp(a.closedAt)||0));
 const losses=today.filter(t=>t.pnl<0),wins=today.filter(t=>t.pnl>0),decided=today.filter(t=>t.pnl!==0);
 const byRobot=new Map<string,{botId:string;trades:number;losses:number;pnl:number}>();
 for(const t of today){const k=t.botId||'unattributed',g=byRobot.get(k)||{botId:k,trades:0,losses:0,pnl:0};
  g.trades++;g.losses+=Number(t.pnl<0);g.pnl+=t.pnl;byRobot.set(k,g);}
 return {available:true,day,timeZone:'Africa/Johannesburg',window:'00:00–23:59 SAST',
  source:'Owner-authenticated PropDAO closed trades, Cloudflare journal, Firestore observation ledger',
  accountsChecked:coverage.accountsChecked,failedAccounts:coverage.failures,historyCapped:coverage.capped,
  journalWarnings:coverage.journalWarnings,ledgerAvailable:coverage.ledgerAvailable,
  partial:unknownTimes>0||coverage.failures.length>0||coverage.capped.length>0||
   coverage.journalWarnings.length>0||!coverage.ledgerAvailable||coverage.writeFailures>0,
  unknownClosedAtCount:unknownTimes,closedTradesToday:today.length,losses:losses.length,wins:wins.length,
  winRatePercent:decided.length?Number((100*wins.length/decided.length).toFixed(2)):null,
  reportedPnl:sum(today.map(t=>t.pnl)),
  feesReported:today.every(t=>t.fee!==null)?sum(today.map(t=>t.fee||0)):null,
  pnlCaveat:'It is unverified whether broker P/L includes fees: do not double deduct.',
  worstLoss:losses.length?Math.min(...losses.map(t=>t.pnl)):null,
  avgLoss:losses.length?sum(losses.map(t=>t.pnl))/losses.length:null,
  stopLossCount:today.filter(t=>/^(?:SL|STOP[_ -]?LOSS|STOPPED[_ -]?OUT)$/i.test(t.reason)).length,
  matchedRobotTrades:today.filter(t=>t.botId!==null).length,
  unattributedTrades:today.filter(t=>t.botId===null).length,
  byRobot:[...byRobot.values()].map(g=>({...g,pnl:Math.round(g.pnl*1e6)/1e6})),
  recentLosses:losses.slice(0,12).map(t=>({accountId:t.accountId,tradeId:t.id,botId:t.botId,attribution:t.attribution,
   side:t.side,symbol:t.symbol,pnl:t.pnl,fee:t.fee,reason:t.reason,entry:t.entry,exit:t.exit,
   openedAtUTC:timestamp(t.openedAt)!==null?new Date(timestamp(t.openedAt)!).toISOString():null,
   closedAtUTC:timestamp(t.closedAt)!==null?new Date(timestamp(t.closedAt)!).toISOString():null})),
  limitation:'Only broker-recorded closed trades are counted. An SL reason does not prove indicator failure. Worker history can be incomplete. The broker supplies up to 50 trades per read per account. Firestore retains only trades observed by this system.'};
}
export class TradingDesk{
 private readonly store:RecordStore|null;private readonly broker:Broker;private readonly history?:History;
 constructor(store:RecordStore|null,broker:Broker,history?:History){this.store=store;this.broker=broker;this.history=history;}
 /** Read-through, account-scoped and idempotent. Does NOT place any orders. */
 async today(uid:string,now=Date.now()){
  if(typeof uid!=='string'||uid.length>256||!uid||uid.includes('/'))throw Error('Invalid owner');
  const day=sastDay(now),listing=await this.broker.list(uid);
  if(!listing.connected)return {available:false,day,timeZone:'Africa/Johannesburg',reason:'PropDAO disconnected; cannot verify current broker trades'};
  const accounts=[...new Set(listing.accounts.map(a=>a.accountId).filter(validId))];
  if(!accounts.length)return {available:false,day,timeZone:'Africa/Johannesburg',reason:'No connected PropDAO accounts'};
  if(accounts.length>12)return {available:false,day,reason:'More than 12 accounts; restrict the investigation to a named account'};
  const root='users/'+uid+'/liveTrades';
  const retained=new Map<string,Trade&{accountId:string;botId:string|null;attribution:string}>();
  const failures:string[]=[],capped:string[]=[],journalWarnings:string[]=[];
  let writeFailures=0,tradeWrites=0,eventWrites=0,decisionWrites=0;
  for(const accountId of accounts){
   try{
    const trades=await this.broker.recentTrades(uid,accountId);
    if(trades.length===50)capped.push(accountId);
    let events:ExecutionEvent[]=[],decisions:Decision[]=[];
    if(this.history){
     try{
      const activity=await this.history(uid,accountId);
      events=safeExecutionEvents(activity.events,accountId);
      decisions=Array.isArray(activity.decisionSnapshots)?activity.decisionSnapshots.filter(d=>
       d&&d.accountId===accountId&&validId(d.botId)&&validId(d.grantId)&&Number.isFinite(d.candleClose)).slice(-300):[];
      if(!activity.available||activity.partial)journalWarnings.push(accountId+': '+(activity.error||'Worker history incomplete'));
     }catch{journalWarnings.push(accountId+': Worker history unavailable');}
    }else journalWarnings.push(accountId+': No Worker journal reader');
    const persist=async(rootName:string,id:string,data:Record<string,any>)=>{
     if(!this.store)return false;
     try{return await this.store.create('users/'+uid+'/'+rootName+'/'+id,data)}
     catch{writeFailures++;return false}
    };
    if(this.store){
     // Limit network concurrency, retain separate provenance for journal stages and strategy checks.
     for(let i=0;i<events.length;i+=8)await Promise.all(events.slice(i,i+8).map(async e=>{
      if(await persist('liveExecutionEvents',hash('propdao-event',accountId,e.botId,e.id),
       {...e,source:'structured-worker-event-not-broker-trade',observedAt:now,ledgerVersion:1}))eventWrites++;
     }));
     for(let i=0;i<decisions.length;i+=8)await Promise.all(decisions.slice(i,i+8).map(async d=>{
      if(await persist('liveRobotDecisions',hash('propdao-decision',accountId,d.botId,d.grantId,String(d.candleClose)),
       {...d,source:'structured-worker-decision',observedAt:now,ledgerVersion:1}))decisionWrites++;
     }));
    }
    const documents=trades.filter(validTrade).map(t=>{
     const scope=hash('propdao',accountId,t.id),link=attributeTrade(t,events);
     const {id:providerTradeId,...brokerFields}=t;
     const record={...brokerFields,providerTradeId,accountId,...link,
      localDay:timestamp(t.closedAt)!==null?sastDay(timestamp(t.closedAt)!):null,
      openedAtMillis:timestamp(t.openedAt),closedAtMillis:timestamp(t.closedAt),
      observedAt:now,source:'authenticated-broker',ledgerVersion:1};
     retained.set(scope,{...record,id:providerTradeId});
     return {scope,record};
    });
    if(this.store)for(let i=0;i<documents.length;i+=8){
     await Promise.all(documents.slice(i,i+8).map(async({scope,record})=>{
      const path=root+'/'+scope;
      try{
       if(await this.store!.create(path,record))tradeWrites++;
       else if(record.attribution==='exact-provider-identity'){
        const old=await this.store!.get(path);
        if(old?.providerTradeId===record.providerTradeId&&old?.accountId===record.accountId&&
          old?.attribution!=='exact-provider-identity')await this.store!.put(path,{...old,...record});
       }
      }catch{writeFailures++;}
     }));
    }
   }catch(e){failures.push(accountId+': '+(e instanceof Error?e.message:'history unavailable'));}
  }
  let ledgerAvailable=Boolean(this.store);
  if(this.store){
   try{
    if(this.store.page){
     let after:string|undefined;
     for(let batch=0;batch<5;batch++){
      const page=await this.store.page(root,'localDay',day,after,100);
      for(const r of page.items){
       if(typeof r.accountId!=='string'||!accounts.includes(r.accountId)||typeof r.providerTradeId!=='string')continue;
       const t={...r,id:r.providerTradeId} as Trade&{accountId:string;botId:string|null;attribution:string};
       if(validTrade(t)){const id=hash('propdao',t.accountId,t.id);if(!retained.has(id))retained.set(id,t);}
      }
      if(!page.next)break;after=page.next;
      if(batch===4)journalWarnings.push('Firestore daily query capped at 500 documents');
     }
    }else{
     const records=await this.store.query(root,'localDay',day);
     for(const r of records.slice(0,500)){
      if(typeof r.accountId!=='string'||!accounts.includes(r.accountId)||typeof r.providerTradeId!=='string')continue;
      const t={...r,id:r.providerTradeId} as Trade&{accountId:string;botId:string|null;attribution:string};
      if(validTrade(t)){const id=hash('propdao',t.accountId,t.id);if(!retained.has(id))retained.set(id,t);}
     }
     if(records.length>500)journalWarnings.push('Firestore daily query capped at 500 documents');
    }
   }catch{ledgerAvailable=false;journalWarnings.push('Firestore ledger read unavailable');}
  }
  return {...summarizeDay([...retained.values()],day,{accountsChecked:accounts.length,failures,capped,journalWarnings,ledgerAvailable,writeFailures}),
   fetchedAt:new Date(now).toISOString(),ledger:{tradeWrites,eventWrites,decisionWrites,writeFailures,available:ledgerAvailable}};
 }
}
