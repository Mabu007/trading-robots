import {it,expect,vi} from 'vitest';
import {CTraderConnection,type WireSocket} from '../gateway/protocol';
class Socket implements WireSocket{
 readyState=0;listeners=new Map<string,((e:any)=>void)[]>();sent:any[]=[];
 constructor(){queueMicrotask(()=>{this.readyState=1;this.emit('open',{})})}
 addEventListener(t:string,h:(e:any)=>void){this.listeners.set(t,[...(this.listeners.get(t)||[]),h])}
 emit(t:string,e:any){for(const h of this.listeners.get(t)||[])h(e)}
 send(text:string){const m=JSON.parse(text);this.sent.push(m);queueMicrotask(()=>this.emit('message',{data:JSON.stringify({clientMsgId:m.clientMsgId,payloadType:m.payloadType+1,payload:{ok:true}})}))}
 close(){this.readyState=3;this.emit('close',{})}
}
it('shares one environment socket and authenticates concurrent requests once per account',async()=>{const sockets:Socket[]=[],factory=vi.fn(()=>{const s=new Socket();sockets.push(s);return s}),pool=new CTraderConnection('demo','id','secret',factory);try{await Promise.all([pool.authorize('101','token'),pool.authorize('101','token')]);expect(factory).toHaveBeenCalledTimes(1);expect(sockets[0].sent.filter(m=>m.payloadType===2100)).toHaveLength(1);expect(sockets[0].sent.filter(m=>m.payloadType===2102)).toHaveLength(1)}finally{pool.close()}});
it('reconnects on demand and restores account authorization and wanted price subscriptions',async()=>{const sockets:Socket[]=[],pool=new CTraderConnection('demo','id','secret',()=>{const s=new Socket();sockets.push(s);return s});try{await pool.authorize('101','token');const pending=pool.spot('101','1');queueMicrotask(()=>sockets[0].emit('message',{data:JSON.stringify({payloadType:2131,payload:{ctidTraderAccountId:'101',symbolId:'1',bid:10000000,ask:10010000,timestamp:Date.now()}})}));expect((await pending).bid).toBe(100);sockets[0].close();await pool.authorize('101','token');expect(sockets).toHaveLength(2);expect(sockets[1].sent.some(m=>m.payloadType===2127)).toBe(true)}finally{pool.close()}});
it('logs out before re-authorizing a refreshed account token',async()=>{const s=new Socket(),pool=new CTraderConnection('demo','id','secret',()=>s);try{await pool.authorize('101','old');await pool.authorize('101','new');expect(s.sent.map(m=>m.payloadType)).toEqual([2100,2102,2162,2102])}finally{pool.close()}});
