// Durable, per-customer order journal. This module is not wired to live trading.
// It deliberately never retries an ambiguous submission: only reconciliation
// can resolve it, because VALR's customer order IDs are unique among open orders.
export type ValrIntent={customerOrderId:string;pair:string;side:'BUY'|'SELL';baseAmount:string;signalId:string};
export type JournalRecord={intent:ValrIntent;state:'submitting'|'unknown'|'accepted'|'filled'|'failed'|'cancelled';exchangeOrderId?:string;updatedAt:number;error?:string};
type Store={get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>};
type Exchange={submit:(intent:ValrIntent)=>Promise<{orderId:string}>;lookup:(intent:ValrIntent)=>Promise<{state:'open'|'filled'|'failed'|'cancelled';orderId:string}|null>};

export class ValrOrderJournal {
 private store:Store;private exchange:Exchange;private now:()=>number;private tail:Promise<unknown>=Promise.resolve();
 constructor(store:Store,exchange:Exchange,now=Date.now){this.store=store;this.exchange=exchange;this.now=now}
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const result=this.tail.then(fn,fn);this.tail=result.catch(()=>{});return result}
 private key(id:string){if(!/^[A-Za-z0-9-]{1,50}$/.test(id))throw Error('Invalid customer order ID');return `valr-order:${id}`}
 async submit(intent:ValrIntent){return this.serial(async()=>{
  const key=this.key(intent.customerOrderId);
  if(!/^[A-Z0-9]{3,30}$/.test(intent.pair)||!['BUY','SELL'].includes(intent.side)||intent.baseAmount.length>50||!/^\d+(?:\.\d+)?$/.test(intent.baseAmount)||!Number.isFinite(Number(intent.baseAmount))||Number(intent.baseAmount)<=0||!intent.signalId||intent.signalId.length>200)throw Error('Invalid order intent');
  const old=await this.store.get<JournalRecord>(key);
  if(old){if(old.intent.pair!==intent.pair||old.intent.side!==intent.side||old.intent.baseAmount!==intent.baseAmount||old.intent.signalId!==intent.signalId)throw Error('Order ID already belongs to a different intent');return old}
  const record:JournalRecord={intent,state:'submitting',updatedAt:this.now()};
  await this.store.put(key,record); // Commit before any network request.
  try{const result=await this.exchange.submit(intent);if(!result.orderId)throw Error('Missing order ID');record.state='accepted';record.exchangeOrderId=result.orderId}
  catch{record.state='unknown';record.error='Submission outcome is unknown; reconcile before any further order.'}
  record.updatedAt=this.now();await this.store.put(key,record);return record;
 })}
 async reconcile(id:string){return this.serial(async()=>{
  const key=this.key(id),record=await this.store.get<JournalRecord>(key);if(!record)throw Error('Order intent not found');
  if(['filled','failed','cancelled'].includes(record.state))return record;
  let result:Awaited<ReturnType<Exchange['lookup']>>;try{result=await this.exchange.lookup(record.intent)}catch{return record}
  if(!result){record.state='unknown';record.error='Exchange status is not yet known; do not resubmit.'}
  else{record.state=result.state==='open'?'accepted':result.state;record.exchangeOrderId=result.orderId;delete record.error}
  record.updatedAt=this.now();await this.store.put(key,record);return record;
 })}
}
