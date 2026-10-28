import { TF_SECONDS,sizeOrder,validateMargin,validateSignal,type Signal,type RiskLimits,type AccountSnapshot } from '../shared/trading.ts';
export interface DurableStore {get<T>(key:string):Promise<T|undefined>;put(key:string,value:any):Promise<void>;putMany(entries:Record<string,any>):Promise<void>;setAlarm(time:number):Promise<void>;deleteAlarm():Promise<void>;}
export type Deployment={generation:string;botId:string;ownerUid:string;version:string;codeKey:string;strategy:{executionTimeframe:string;timeframes:string[]};asset:string;intervalMinutes:number;publicationDelaySeconds:number;sourceUid:string;sourceAccountId:string;sourceSymbolId:string;replayFrom:Record<string,number>};
type RuntimeState={deployment:Deployment;running:boolean;lastCandle?:number;lastSuccessfulEvaluation?:number;lastSignal?:Signal;lastError?:string;nextAlarm?:number;evaluations:number;lastAttempt?:number;consecutiveFailures?:number;outbox?:{key:string;cursor:number};};
export interface RobotDependencies {now:()=>number;evaluate:(deployment:Deployment,cutoff:number)=>Promise<{decision:any;reference:number;candleClose:number}>;prepareFanout:(signal:Signal)=>Promise<string>;sendFanout:(key:string,cursor:number)=>Promise<{next:number;done:boolean}>;}
export class RobotRuntime {
  constructor(private storage:DurableStore,private deps:RobotDependencies){}
  private next(d:Deployment){const interval=d.intervalMinutes*60000,delay=d.publicationDelaySeconds*1000;return Math.floor((this.deps.now()-delay)/interval)*interval+interval+delay;}
  async deploy(d:Deployment){const old=await this.storage.get<RuntimeState>('state');if(old?.running)throw Error('Stop the bot before updating its pinned strategy.');if(![1,5,15].includes(d.intervalMinutes)||TF_SECONDS[d.strategy.executionTimeframe]!==d.intervalMinutes*60||!d.version||!d.codeKey)throw Error('Live evaluation interval must match the strategy execution timeframe (M1, M5 or M15).');await this.storage.deleteAlarm();await this.storage.put('state',{deployment:d,running:false,evaluations:0} satisfies RuntimeState);return this.status();}
  async control(action:string){const s=await this.storage.get<RuntimeState>('state');if(!s)throw Error('Bot has not been deployed');if(action==='start'||action==='resume'){if(s.lastError==='Undeployed')throw Error('Deploy a validated version before starting');if(s.running)return this.status();s.running=true;s.lastError=undefined;s.lastSuccessfulEvaluation=undefined;s.nextAlarm=this.next(s.deployment);await this.storage.put('state',s);await this.storage.setAlarm(s.nextAlarm);}else if(action==='stop'||action==='undeploy'){s.running=false;s.nextAlarm=undefined;s.outbox=undefined;await this.storage.put('state',s);await this.storage.deleteAlarm();if(action==='undeploy')await this.storage.put('state',{...s,lastError:'Undeployed'});}else throw Error('Invalid lifecycle action');return this.status();}
  async status(){const s=await this.storage.get<RuntimeState>('state');if(!s)return {deployed:false,evaluating:false};const interval=s.deployment.intervalMinutes*60000;return {deployed:s.lastError!=='Undeployed',running:s.running,timeframe:s.deployment.strategy.executionTimeframe,asset:s.deployment.asset,sourceAccountId:s.deployment.sourceAccountId,sourceSymbolId:s.deployment.sourceSymbolId,evaluating:s.running&&!s.lastError&&Boolean(s.lastSuccessfulEvaluation)&&this.deps.now()-s.lastSuccessfulEvaluation!<interval*2+60000,version:s.deployment.version,generation:s.deployment.generation,lastSuccessfulEvaluation:s.lastSuccessfulEvaluation||null,lastCandle:s.lastCandle||null,lastSignal:s.lastSignal||null,lastError:s.lastError||null,lastAttempt:s.lastAttempt||null,consecutiveFailures:s.consecutiveFailures||0,nextAlarm:s.nextAlarm||null,evaluations:s.evaluations};}
  async alarm(){
    const s=await this.storage.get<RuntimeState>('state');if(!s?.running)return;
    // Persist the next wake before any external work. A crash cannot silently lose scheduling.
    s.nextAlarm=this.next(s.deployment);await this.storage.put('state',s);await this.storage.setAlarm(s.nextAlarm);
    try{
      s.lastAttempt=this.deps.now();
      if(s.outbox){const batch=await this.deps.sendFanout(s.outbox.key,s.outbox.cursor);s.outbox=batch.done?undefined:{...s.outbox,cursor:batch.next};if(!s.outbox){s.lastError=undefined;s.consecutiveFailures=0}await this.storage.put('state',s);if(s.outbox){s.nextAlarm=this.deps.now()+1000;await this.storage.put('state',s);await this.storage.setAlarm(s.nextAlarm);return;}}
      const duration=TF_SECONDS[s.deployment.strategy.executionTimeframe]*1000,cutoff=Math.floor((this.deps.now()-s.deployment.publicationDelaySeconds*1000)/duration)*duration;
      if(s.lastCandle===cutoff)return;
      const result=await this.deps.evaluate(s.deployment,cutoff);
      if(result.candleClose!==cutoff)throw Error('Waiting for a newly completed broker candle.');
      const d=result.decision;let signal:Signal|undefined;
      if(d.action!=='WAIT'){
        signal={id:`${s.deployment.botId}_${s.deployment.version.slice(0,16)}_${s.deployment.generation.slice(0,8)}_${cutoff}`,botId:s.deployment.botId,version:s.deployment.version,action:d.action,symbol:s.deployment.asset,timeframe:s.deployment.strategy.executionTimeframe,candleClose:cutoff,createdAt:this.deps.now(),expiresAt:cutoff+Math.min(120000,s.deployment.intervalMinutes*60000),stopLoss:d.stopLoss,takeProfit:d.takeProfit,reason:d.reason||''};validateSignal(signal,result.reference,this.deps.now());
        const key=await this.deps.prepareFanout(signal);s.outbox={key,cursor:0};s.lastSignal=signal;
      }
      s.lastCandle=cutoff;s.lastSuccessfulEvaluation=this.deps.now();s.lastError=undefined;s.consecutiveFailures=0;s.evaluations++;await this.storage.put('state',s);
      if(s.outbox){const batch=await this.deps.sendFanout(s.outbox.key,0);s.outbox=batch.done?undefined:{...s.outbox,cursor:batch.next};await this.storage.put('state',s);if(s.outbox){s.nextAlarm=this.deps.now()+1000;await this.storage.put('state',s);await this.storage.setAlarm(s.nextAlarm);}}
    }catch(error){s.lastError=error instanceof Error?error.message:'Evaluation failed';s.consecutiveFailures=(s.consecutiveFailures||0)+1;const nextCandle=this.next(s.deployment);s.nextAlarm=Math.min(nextCandle,this.deps.now()+Math.min(60000,15000*2**Math.min(s.consecutiveFailures-1,2)));await this.storage.put('state',s);await this.storage.setAlarm(s.nextAlarm);}
  }
}
export type ExecutionJob={uid:string;accountId:string;signal:Signal};
export interface AccountDependencies {now:()=>number;eligible:(job:ExecutionJob)=>Promise<{risk:RiskLimits;symbolId:string}>;snapshot:(job:ExecutionJob,symbolId:string)=>Promise<AccountSnapshot>;margin:(job:ExecutionJob,order:any)=>Promise<number>;submit:(job:ExecutionJob,order:any,risk:RiskLimits)=>Promise<any>;reconcile:(job:ExecutionJob,id:string,since:number)=>Promise<any>;record:(record:any)=>Promise<void>;}
export class AccountRuntime {
  constructor(private storage:DurableStore,private deps:AccountDependencies){}
  async execute(job:ExecutionJob){
    const id=job.signal.id,key=`intent:${id}`,old=await this.storage.get<any>(key);
    if(old){
      if(old.accountId!==job.accountId)throw Error('Intent account mismatch');
      if(['submitting','unknown'].includes(old.state)){const resolved=await this.deps.reconcile(job,old.clientOrderId,old.createdAt);if(resolved.state==='unknown'){await this.deps.record(old);return old;}const updated={...old,...resolved,updatedAt:this.deps.now()};await this.storage.putMany({[key]:updated,unresolved:null});await this.deps.record(updated);return updated;}
      // A rejected, skipped or acknowledged signal is terminal. Never resubmit after an eviction.
      await this.deps.record(old);return old;
    }
    const record:any={id,botId:job.signal.botId,uid:job.uid,accountId:job.accountId,signalId:id,signal:job.signal,state:'checking',createdAt:this.deps.now(),updatedAt:this.deps.now()};
    try{
      if(await this.storage.get('unresolved'))throw Error('A prior broker acknowledgement is unresolved. New orders are paused.');
      const {risk,symbolId}=await this.deps.eligible(job),snapshot=await this.deps.snapshot(job,symbolId);
      if(snapshot.accountId!==job.accountId)throw Error('Broker snapshot ownership mismatch');
      const clientOrderId=await this.clientId(job);const order=sizeOrder(job.signal,snapshot,risk,clientOrderId,this.deps.now());validateMargin(await this.deps.margin(job,order),snapshot.freeMargin);
      // Recheck subscription after market/margin I/O, immediately before persisting an order intent.
      const current=await this.deps.eligible(job);if(JSON.stringify(current.risk)!==JSON.stringify(risk)||current.symbolId!==symbolId)throw Error('Subscription risk settings changed during validation');
      Object.assign(record,{state:'submitting',clientOrderId,order,risk});await this.storage.putMany({[key]:record,unresolved:id});
      let result:any;try{result=await this.deps.submit(job,order,risk)}catch{result={state:'unknown',error:'Broker acknowledgement lost. Reconciliation is required; this intent will not be resubmitted.'};}
      Object.assign(record,result,{updatedAt:this.deps.now()});
      if(result.state==='not_sent'){record.state='skipped';record.error='Transport failed before submission. A future signal may be evaluated.';}
    }catch(error){if(record.state==='submitting')record.state='unknown';else record.state='skipped';record.error=error instanceof Error?error.message:'Order validation failed';}
    if(record.state==='unknown')await this.storage.putMany({[key]:record,unresolved:id});else if(await this.storage.get('unresolved')===id)await this.storage.putMany({[key]:record,unresolved:null});else await this.storage.put(key,record);await this.deps.record(record);return record;
  }
  async reconcilePending(uid:string){const id=await this.storage.get<string>('unresolved');if(!id)return {state:'clear'};const old=await this.storage.get<any>(`intent:${id}`);if(!old||old.uid!==uid||!old.signal)throw Error('Pending intent requires operator review');return this.execute({uid,accountId:old.accountId,signal:old.signal});}
  private async clientId(job:ExecutionJob){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${job.uid}:${job.accountId}:${job.signal.id}`));return 'tv_'+Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,44);}
}
