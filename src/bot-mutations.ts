// Keep writes ordered per bot, and let deletion finish after all earlier saves.
export class BotMutationQueue {
 private pending=new Map<string,Promise<unknown>>();
 private deleted=new Set<string>();
 private enqueue<T>(key:string,task:()=>Promise<T>){
  const next=(this.pending.get(key)||Promise.resolve()).catch(()=>{}).then(task);
  this.pending.set(key,next);
  void next.finally(()=>{if(this.pending.get(key)===next)this.pending.delete(key)}).catch(()=>{});
  return next;
 }
 run<T>(key:string,task:()=>Promise<T>){if(this.deleted.has(key))return Promise.reject(new Error('This robot has been deleted.'));return this.enqueue(key,task)}
 async remove<T>(key:string,task:()=>Promise<T>){this.deleted.add(key);try{return await this.enqueue(key,task)}catch(e){this.deleted.delete(key);throw e}}
}
