import { expect,it,vi } from 'vitest';
import { ValrOrderJournal,type ValrIntent } from '../workers/valr-order-journal';

class Memory{data=new Map<string,unknown>();async get<T>(key:string){return structuredClone(this.data.get(key)) as T|undefined}async put(key:string,value:unknown){this.data.set(key,structuredClone(value))}}
const intent:ValrIntent={customerOrderId:'robot-signal-123',pair:'ETHZAR',side:'BUY',baseAmount:'0.001',limitPrice:'50000',signalId:'signal-123'};
it('persists an intent before submission and never resubmits a lost acknowledgement',async()=>{
 const storage=new Memory(),submit=vi.fn(async()=>{expect(storage.data.has('valr-order:robot-signal-123')).toBe(true);throw Error('connection lost')});
 const lookup=vi.fn(async()=>({state:'filled' as const,orderId:'exchange-id'}));
 const journal=new ValrOrderJournal(storage,{submit,lookup});
 expect((await journal.submit(intent)).state).toBe('unknown');
 const restarted=new ValrOrderJournal(storage,{submit,lookup});
 expect((await restarted.submit(intent)).state).toBe('unknown');expect(submit).toHaveBeenCalledTimes(1);
 expect((await restarted.reconcile(intent.customerOrderId)).state).toBe('filled');
 expect((await restarted.submit(intent)).state).toBe('filled');expect(submit).toHaveBeenCalledTimes(1);
});
it('serializes duplicate attempts and refuses to resend unresolved orders',async()=>{
 const storage=new Memory(),submit=vi.fn(async()=>({orderId:'exchange-id'})),lookup=vi.fn(async()=>null);
 const journal=new ValrOrderJournal(storage,{submit,lookup});
 const [a,b]=await Promise.all([journal.submit(intent),journal.submit(intent)]);
 expect(a.state).toBe('accepted');expect(b.state).toBe('accepted');expect(submit).toHaveBeenCalledTimes(1);
 expect((await journal.reconcile(intent.customerOrderId)).state).toBe('unknown');
 expect((await journal.submit(intent)).state).toBe('unknown');expect(submit).toHaveBeenCalledTimes(1);
 await expect(journal.submit({...intent,baseAmount:'0.002'})).rejects.toThrow('different intent');
 await expect(journal.submit({...intent,limitPrice:'60000'})).rejects.toThrow('different intent');
});
