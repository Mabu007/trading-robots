import { processPaperCandle, type PaperCandle, type PaperDecision, type PaperRisk, type PaperSpec, type PaperState } from './valr-paper';

type Stored = { state:PaperState; spec:PaperSpec; risk:PaperRisk; lastError:string; attempts:number; nextAlarm:number|null };
type Storage = { get<T>(key:string):Promise<T|undefined>; put(key:string,value:unknown):Promise<void>; setAlarm(time:number):Promise<void>; deleteAlarm():Promise<void> };
type Dependencies = { now:()=>number; next:(lastCandle:number|null)=>Promise<{candle:PaperCandle;decision:PaperDecision}|null> };

// One runtime is owned by one customer and bot. The caller must authorize that
// identity before obtaining the Durable Object stub. No provider credentials
// or privileged operations are exposed to strategy evaluation here.
export class ValrPaperRuntime {
 private tail:Promise<unknown>=Promise.resolve();
 private storage:Storage; private deps:Dependencies;
 constructor(storage:Storage,deps:Dependencies){this.storage=storage;this.deps=deps}
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const result=this.tail.then(fn,fn);this.tail=result.catch(()=>{});return result}
 private async load(){const data=await this.storage.get<Stored>('paper');if(!data)throw Error('Paper robot is not deployed');return data}
 private schedule(data:Stored,delay:number){return this.storage.setAlarm(this.deps.now()+delay)}
 async deploy(state:PaperState,spec:PaperSpec,risk:PaperRisk){return this.serial(async()=>{
  if(await this.storage.get('paper'))throw Error('Paper robot already deployed');
  if(state.running||state.position||state.pending||state.lastCandle!==null||!Number.isFinite(state.balance)||state.balance<=0)throw Error('Invalid initial paper account');
  // Validate parameters before accepting a deployment without executing it.
  const sample:PaperCandle={time:risk.timeframeSeconds,open:1,high:1,low:1,close:1,volume:0};
  processPaperCandle(state,sample,{action:'WAIT'},spec,risk);
  await this.storage.put('paper',{state,spec,risk,lastError:'',attempts:0,nextAlarm:null} satisfies Stored);
  return state;
 })}
 async start(){return this.serial(async()=>{const data=await this.load();data.state.running=true;data.lastError='';data.nextAlarm=this.deps.now()+1000;await this.storage.setAlarm(data.nextAlarm);await this.storage.put('paper',data);return data.state})}
 async stop(){return this.serial(async()=>{const data=await this.load();data.state.running=false;data.state.pending=null;data.nextAlarm=data.state.position?this.deps.now()+1000:null;if(data.nextAlarm)await this.storage.setAlarm(data.nextAlarm);else await this.storage.deleteAlarm();await this.storage.put('paper',data);return data.state})}
 async status(){return this.serial(()=>this.load())}
 async alarm(){return this.serial(async()=>{
  const data=await this.load();
  if(!data.state.running&&!data.state.position){data.nextAlarm=null;await this.storage.put('paper',data);await this.storage.deleteAlarm();return}
  // A fallback alarm is written before processing, so a crash after a state
  // write does not leave the robot unscheduled. Repeated candles are ignored.
  data.nextAlarm=this.deps.now()+Math.max(5000,data.risk.timeframeSeconds*1000);
  await this.storage.setAlarm(data.nextAlarm);
  try{
   const next=await this.deps.next(data.state.lastCandle);
   if(next)data.state=processPaperCandle(data.state,next.candle,next.decision,data.spec,data.risk);
   data.lastError='';data.attempts=0;
  }catch(error){
   data.lastError=(error instanceof Error?error.message:'Paper evaluation failed').slice(0,300);data.attempts=Math.min(data.attempts+1,10);
   data.nextAlarm=this.deps.now()+Math.min(300000,5000*2**Math.min(data.attempts-1,6));await this.storage.setAlarm(data.nextAlarm);
  }
  if(!data.state.running&&!data.state.position){data.nextAlarm=null;await this.storage.deleteAlarm()}
  await this.storage.put('paper',data);
 })}
}
