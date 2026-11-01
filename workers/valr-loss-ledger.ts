// Durable accounting primitive for a single account and quote currency. Callers
// must verify exchange fills and prove their linkage before recording a loss.
// This component is not exposed to users or wired to live execution.
const SCALE=10n**18n;
function amount(value:string):bigint{if(typeof value!=='string'||value.length>40||!/^\d+(?:\.\d{1,18})?$/.test(value))throw Error('Invalid ledger amount');const [whole,fraction='']=value.split('.');return BigInt(whole)*SCALE+BigInt(fraction.padEnd(18,'0'))}
function format(value:bigint){const whole=value/SCALE,rest=(value%SCALE).toString().padStart(18,'0').replace(/0+$/,'');return rest?`${whole}.${rest}`:String(whole)}
type State={utcDay:string;quoteCurrency:string;dayStartEquity:string;dailyLoss:string;processed:Array<{id:string;loss:string}>};
type Storage={get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>};
const validDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&!Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))&&new Date(`${day}T00:00:00.000Z`).toISOString().slice(0,10)===day;
export class ValrLossLedger {
 private tail:Promise<unknown>=Promise.resolve();private store:Storage;
 constructor(store:Storage){this.store=store}
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const result=this.tail.then(fn,fn);this.tail=result.catch(()=>{});return result}
 async beginDay(utcDay:string,quoteCurrency:string,verifiedFlatEquity:string,flatReconciled:boolean){return this.serial(async()=>{
  if(!validDay(utcDay)||! /^[A-Z0-9]{2,15}$/.test(quoteCurrency)||amount(verifiedFlatEquity)<=0n||flatReconciled!==true)throw Error('A reconciled flat account and positive equity are required');
  const current=await this.store.get<State>('loss-ledger');
  if(current){if(current.quoteCurrency!==quoteCurrency)throw Error('Changing quote currency requires account reconciliation');if(utcDay<current.utcDay)throw Error('Cannot move the ledger backwards');if(utcDay===current.utcDay)return current;await this.store.put(`loss-ledger:archive:${current.utcDay}:${current.quoteCurrency}`,current)}
  const next:State={utcDay,quoteCurrency,dayStartEquity:format(amount(verifiedFlatEquity)),dailyLoss:'0',processed:[]};await this.store.put('loss-ledger',next);return next;
 })}
 async recordVerifiedLoss(utcDay:string,quoteCurrency:string,eventId:string,loss:string){return this.serial(async()=>{
  const state=await this.store.get<State>('loss-ledger');if(!state||state.utcDay!==utcDay||state.quoteCurrency!==quoteCurrency)throw Error('Daily ledger is not initialized for this market');
  if(!/^[A-Za-z0-9-]{1,100}$/.test(eventId))throw Error('Invalid fill event');const value=amount(loss),prior=state.processed.find(x=>x.id===eventId);
  if(prior){if(prior.loss!==format(value))throw Error('Fill event differs from the recorded result');return state}
  if(state.processed.length>=5000)throw Error('Daily ledger capacity reached; reconciliation required');
  // One atomic storage write contains both the loss and its deduplication key.
  // Losing this write cannot mark an unrecorded loss as processed.
  state.dailyLoss=format(amount(state.dailyLoss)+value);state.processed.push({id:eventId,loss:format(value)});await this.store.put('loss-ledger',state);return state;
 })}
 async snapshot(utcDay:string,quoteCurrency:string){return this.serial(async()=>{const state=await this.store.get<State>('loss-ledger');if(!state||state.utcDay!==utcDay||state.quoteCurrency!==quoteCurrency)throw Error('Daily ledger is not reconciled');return {utcDay:state.utcDay,dayStartEquity:state.dayStartEquity,dailyLoss:state.dailyLoss,reconciled:true as const}})}
}
