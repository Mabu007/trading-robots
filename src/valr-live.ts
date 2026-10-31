export type LiveQuote={pair:string;last:number;bid:number;ask:number;receivedAt:number};
export type LiveState={status:'connecting'|'live'|'reconnecting';quote:LiveQuote|null};
export function parseValrQuote(raw:string,pair:string,now=Date.now()):LiveQuote|null{
 try{const msg=JSON.parse(raw);if(msg.type!=='MARKET_SUMMARY_UPDATE'||msg.currencyPairSymbol!==pair||msg.data?.currencyPair!==pair)return null;const last=Number(msg.data.lastTradedPrice),bid=Number(msg.data.bidPrice),ask=Number(msg.data.askPrice);if(![last,bid,ask].every(Number.isFinite)||last<=0||bid<=0||ask<bid)return null;return {pair,last,bid,ask,receivedAt:now}}catch{return null}
}
// Public trade stream only: no user credentials are sent to the browser or socket.
export function subscribeValrQuote(pair:string,onChange:(value:LiveState)=>void,create:(url:string)=>WebSocket=url=>new WebSocket(url)){
 if(!/^[A-Z0-9]{3,30}$/.test(pair))throw Error('Invalid VALR market');
 let stopped=false,socket:WebSocket|null=null,ping:ReturnType<typeof setInterval>|undefined,retry:ReturnType<typeof setTimeout>|undefined,attempt=0,quote:LiveQuote|null=null;
 function connect(){if(stopped)return;onChange({status:attempt?'reconnecting':'connecting',quote});try{socket=create('wss://api.valr.com/ws/trade')}catch{schedule();return}const current=socket;
 current.onopen=()=>{if(stopped||socket!==current)return;current.send(JSON.stringify({type:'SUBSCRIBE',subscriptions:[{event:'MARKET_SUMMARY_UPDATE',pairs:[pair]}]}));ping=setInterval(()=>{if(current.readyState===WebSocket.OPEN)current.send(JSON.stringify({type:'PING'}))},25000)};
 current.onmessage=event=>{if(stopped||socket!==current||typeof event.data!=='string')return;const next=parseValrQuote(event.data,pair);if(next){attempt=0;quote=next;onChange({status:'live',quote})}};
 current.onerror=()=>{current.close()};current.onclose=()=>{if(socket!==current)return;socket=null;if(ping)clearInterval(ping);ping=undefined;if(!stopped)schedule()};
 }
 function schedule(){if(stopped||retry)return;attempt++;onChange({status:'reconnecting',quote});const delay=Math.min(30000,1000*2**Math.min(attempt-1,5));retry=setTimeout(()=>{retry=undefined;connect()},delay)}
 connect();return ()=>{stopped=true;if(ping)clearInterval(ping);if(retry)clearTimeout(retry);if(socket){socket.onclose=null;socket.close();socket=null}};
}
