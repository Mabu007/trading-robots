import {randomUUID} from 'node:crypto';
import type {RecordStore} from './firestore-store.ts';

// No automatic lease expiry: a crashed credential/deployment mutation needs
// operator reconciliation, rather than allowing a delayed write to race a trade.
export class ValrAccountLock {
  private store:RecordStore;
  private namespace:string;
  private label:string;
  constructor(store:RecordStore,namespace='valrAccountLocks',label='VALR account change') {this.store=store;this.namespace=namespace;this.label=label}
  async run<T>(uid:string, task:()=>Promise<T>):Promise<T> {
    const env=process.env.VERCEL_ENV||'development';
    const path=`${this.namespace}/${env}_${Buffer.from(uid).toString('base64url')}`;
    const token=randomUUID();
    if(!await this.store.create(path,{token,createdAt:Date.now()}))throw Error(`Another ${this.label} is pending. Retry after it completes; an interrupted change requires operator reconciliation.`);
    try{return await task()}
    finally{
      const lock=await this.store.get(path);
      if(lock?.token!==token||!this.store.remove)throw Error(`${this.label} requires operator reconciliation.`);
      await this.store.remove(path);
    }
  }
}
