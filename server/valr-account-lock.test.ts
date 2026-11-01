import {expect,it} from 'vitest';
import {ValrAccountLock} from './valr-account-lock';
import type {RecordStore} from './firestore-store';
it('serializes credential and deployment changes across separate service instances',async()=>{
 const rows=new Map<string,any>(),store={create:async(k:string,v:unknown)=>{if(rows.has(k))return false;rows.set(k,v);return true},get:async(k:string)=>rows.get(k)||null,remove:async(k:string)=>{rows.delete(k)}} as RecordStore;
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r),first=new ValrAccountLock(store),second=new ValrAccountLock(store);const work=first.run('alice',async()=>waiting);await Promise.resolve();await expect(second.run('alice',async()=>{})).rejects.toThrow('pending');await expect(second.run('bob',async()=>42)).resolves.toBe(42);release();await work;await expect(second.run('alice',async()=>42)).resolves.toBe(42);expect(rows.size).toBe(0);
});
it('never expires an interrupted mutation and releases a normally failed operation',async()=>{
 const rows=new Map<string,any>(),store={create:async(k:string,v:unknown)=>{if(rows.has(k))return false;rows.set(k,v);return true},get:async(k:string)=>rows.get(k)||null,remove:async(k:string)=>{rows.delete(k)}} as RecordStore;const lock=new ValrAccountLock(store);
 await expect(lock.run('alice',async()=>{throw Error('provider failed')})).rejects.toThrow('provider failed');expect(rows.size).toBe(0);const env=process.env.VERCEL_ENV||'development';rows.set(`valrAccountLocks/${env}_${Buffer.from('alice').toString('base64url')}`,{createdAt:1,token:'interrupted'});await expect(lock.run('alice',async()=>{})).rejects.toThrow('reconciliation');expect(rows.size).toBe(1);
});
