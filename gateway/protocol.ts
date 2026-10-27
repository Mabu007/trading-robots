import { randomUUID } from 'node:crypto';
import type { Environment } from '../shared/trading.ts';
export class BrokerRequestError extends Error { constructor(message:string,public uncertain=false){super(message)} }
export type WireSocket={readyState:number;send:(data:string)=>void;close:()=>void;addEventListener:(type:string,handler:(event:any)=>void)=>void};
type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;sent:boolean;mutation:boolean};
export class CTraderConnection {
  private socket?:WireSocket;private connecting?:Promise<void>;private pending=new Map<string,Pending>();private heartbeat?:ReturnType<typeof setInterval>;
  private regular:number[]=[];private historical:number[]=[];private authenticated=new Map<string,string>();private wanted=new Map<string,Set<string>>();
  private authorizing=new Map<string,Promise<void>>();
  private quotes=new Map<string,{bid?:number;ask?:number;time:number}>();private events=new Set<(type:number,payload:any)=>void>();private lastMessage=0;
  constructor(readonly environment:Environment,private clientId:string,private secret:string,private socketFactory:(url:string)=>WireSocket=url=>new WebSocket(url) as any){}
  health(){return {environment:this.environment,connected:this.socket?.readyState===1,lastMessageAt:this.lastMessage,pendingRequests:this.pending.size,accounts:this.authenticated.size};}
  onEvent(listener:(type:number,payload:any)=>void){this.events.add(listener);return()=>this.events.delete(listener)}
  async connect(){
    if(this.socket?.readyState===1&&this.heartbeat)return;if(this.connecting)return this.connecting;
    if(!this.clientId||!this.secret)throw Error('cTrader application credentials are missing.');
    this.connecting=(async()=>{
      const socket=this.socketFactory(`wss://${this.environment}.ctraderapi.com:5036`);this.socket=socket;
      socket.addEventListener('message',event=>{
        let m:any;try{m=JSON.parse(String(event.data))}catch{return}this.lastMessage=Date.now();
        if(m.payloadType===2131){const p=m.payload,key=`${p.ctidTraderAccountId}:${p.symbolId}`,old=this.quotes.get(key)||{time:0};this.quotes.set(key,{bid:p.bid===undefined?old.bid:Number(p.bid)/100000,ask:p.ask===undefined?old.ask:Number(p.ask)/100000,time:Number(p.timestamp)||Date.now()});}
        if([2147,2148,2164].includes(m.payloadType)){this.authenticated.clear();this.quotes.clear();}
        for(const listener of this.events){try{Promise.resolve(listener(m.payloadType,m.payload)).catch(()=>console.warn(JSON.stringify({event:'broker.event_handler_failed',type:m.payloadType})))}catch{console.warn(JSON.stringify({event:'broker.event_handler_failed',type:m.payloadType}))}}
        if(m.payloadType===2148){socket.close();return;}
        const pending=this.pending.get(m.clientMsgId);if(!pending)return;
        clearTimeout(pending.timer);this.pending.delete(m.clientMsgId);
        if([50,2142,2132].includes(m.payloadType)||m.payloadType===2126&&([7,8,'ORDER_REJECTED','ORDER_CANCEL_REJECTED'].includes(m.payload?.executionType)||m.payload?.errorCode))pending.reject(new BrokerRequestError(`cTrader rejected request: ${String(m.payload?.errorCode||'BROKER_ERROR')}`,false));else pending.resolve(m.payload);
      });
      const closed=()=>{if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=undefined;this.authenticated.clear();this.quotes.clear();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new BrokerRequestError('Broker connection interrupted',p.sent&&p.mutation));}this.pending.clear();};
      socket.addEventListener('close',closed);
      await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>{socket.close();reject(Error('cTrader connection timed out.'))},10000);socket.addEventListener('open',()=>{clearTimeout(t);resolve()});socket.addEventListener('error',()=>{clearTimeout(t);reject(Error('cTrader connection failed.'))});});
      await this.send(2100,{clientId:this.clientId,clientSecret:this.secret});
      this.heartbeat=setInterval(()=>{if(Date.now()-this.lastMessage>30000){socket.close();return}if(socket.readyState===1)socket.send(JSON.stringify({payloadType:51,payload:{}}));},8000);this.heartbeat.unref?.();
    })();try{await this.connecting}catch(error){this.socket?.close();throw error}finally{this.connecting=undefined}
  }
  private async throttle(historical:boolean){const list=historical?this.historical:this.regular,limit=historical?4:40;while(true){const now=Date.now();while(list.length&&list[0]<=now-1000)list.shift();if(list.length<limit){list.push(now);return}await new Promise(resolve=>setTimeout(resolve,Math.max(1,1001-(now-list[0]))));}}
  private async send(type:number,payload:any,mutation=false,historical=false){
    await this.throttle(historical);const socket=this.socket;if(socket?.readyState!==1)throw new BrokerRequestError('Broker connection is not ready',false);
    const clientMsgId=randomUUID();return new Promise<any>((resolve,reject)=>{const item:Pending={resolve,reject,sent:false,mutation,timer:setTimeout(()=>{this.pending.delete(clientMsgId);reject(new BrokerRequestError('Broker acknowledgement timed out',item.sent&&mutation))},10000)};this.pending.set(clientMsgId,item);try{socket.send(JSON.stringify({clientMsgId,payloadType:type,payload}));item.sent=true;}catch{clearTimeout(item.timer);this.pending.delete(clientMsgId);reject(new BrokerRequestError('Could not send broker request',false));}});
  }
  async request(type:number,payload:any,options:{mutation?:boolean;historical?:boolean}={}){await this.connect();return this.send(type,payload,options.mutation,options.historical)}
  async authorize(accountId:string,token:string){
    const pending=this.authorizing.get(accountId);if(pending){await pending;if(this.authenticated.get(accountId)===token)return;}
    const run=(async()=>{await this.connect();if(this.authenticated.get(accountId)===token)return;
      if(this.authenticated.has(accountId))await this.request(2162,{ctidTraderAccountId:accountId});
      await this.request(2102,{ctidTraderAccountId:accountId,accessToken:token});this.authenticated.set(accountId,token);
      const symbols=this.wanted.get(accountId);if(symbols?.size)await this.request(2127,{ctidTraderAccountId:accountId,symbolId:[...symbols],subscribeToSpotTimestamp:true});
    })();this.authorizing.set(accountId,run);try{await run}finally{if(this.authorizing.get(accountId)===run)this.authorizing.delete(accountId)}
  }
  async spot(accountId:string,symbolId:string){
    const key=`${accountId}:${symbolId}`;let wanted=this.wanted.get(accountId);if(!wanted){wanted=new Set();this.wanted.set(accountId,wanted)}
    if(!wanted.has(symbolId)){await this.request(2127,{ctidTraderAccountId:accountId,symbolId:[symbolId],subscribeToSpotTimestamp:true});wanted.add(symbolId);}
    const deadline=Date.now()+5000;while(Date.now()<deadline){const q=this.quotes.get(key);if(q?.bid&&q.ask&&Date.now()-q.time<5000)return {...q,bid:q.bid,ask:q.ask};await new Promise(resolve=>setTimeout(resolve,50));}throw Error('No fresh authorized broker quote is available.');
  }
  async forget(accountId:string){this.authenticated.delete(accountId);this.wanted.delete(accountId);for(const key of this.quotes.keys())if(key.startsWith(`${accountId}:`))this.quotes.delete(key);if(this.socket?.readyState===1)await this.request(2162,{ctidTraderAccountId:accountId});}
  close(){if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=undefined;this.socket?.close();}
}
