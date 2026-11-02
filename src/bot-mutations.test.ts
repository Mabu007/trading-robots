import {expect,it} from 'vitest';
import {BotMutationQueue} from './bot-mutations';
it('waits for an in-flight save before deleting and blocks later resurrection',async()=>{
 const queue=new BotMutationQueue(),events:string[]=[];let release!:()=>void;const wait=new Promise<void>(r=>release=r);
 const save=queue.run('alice:bot',async()=>{events.push('saving');await wait;events.push('saved')});await Promise.resolve();
 const remove=queue.remove('alice:bot',async()=>{events.push('deleted')});await expect(queue.run('alice:bot',async()=>{events.push('resurrected')})).rejects.toThrow('deleted');expect(events).toEqual(['saving']);release();await Promise.all([save,remove]);expect(events).toEqual(['saving','saved','deleted']);
});
it('keeps saves ordered while allowing other bots and users to proceed',async()=>{
 const queue=new BotMutationQueue(),events:string[]=[];let release!:()=>void;const wait=new Promise<void>(r=>release=r);const first=queue.run('alice:bot',()=>wait);const second=queue.run('alice:bot',async()=>events.push('second'));await queue.run('bob:bot',async()=>events.push('other user'));expect(events).toEqual(['other user']);release();await Promise.all([first,second]);expect(events).toEqual(['other user','second']);
});
it('allows deletion after a failed save and permits retry after a failed deletion',async()=>{
 const queue=new BotMutationQueue();await expect(queue.run('bot',async()=>{throw Error('offline')})).rejects.toThrow('offline');await expect(queue.remove('bot',async()=>{throw Error('offline')})).rejects.toThrow('offline');await expect(queue.remove('bot',async()=>true)).resolves.toBe(true);
});
