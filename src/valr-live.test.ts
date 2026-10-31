import {afterEach,expect,it,vi} from 'vitest';
import {parseValrQuote,subscribeValrQuote,type LiveState} from './valr-live';
const update=(pair='ETHZAR')=>JSON.stringify({type:'MARKET_SUMMARY_UPDATE',currencyPairSymbol:pair,data:{currencyPair:pair,lastTradedPrice:'50000',bidPrice:'49990',askPrice:'50010'}});
class FakeSocket {
 static OPEN=1;readyState=1;onopen:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;sent:string[]=[];
 send(v:string){this.sent.push(v)}close(){this.onclose?.()}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});
it('accepts only valid updates for the selected market',()=>{expect(parseValrQuote(update(),'ETHZAR',123)).toMatchObject({pair:'ETHZAR',last:50000,bid:49990,ask:50010,receivedAt:123});expect(parseValrQuote(update('BTCZAR'),'ETHZAR')).toBeNull();expect(parseValrQuote('garbage','ETHZAR')).toBeNull()});
it('subscribes, pings, reconnects and stops without credentials',()=>{vi.useFakeTimers();vi.stubGlobal('WebSocket',FakeSocket);const sockets:FakeSocket[]=[],events:LiveState[]=[];const stop=subscribeValrQuote('ETHZAR',e=>events.push(e),()=>{const s=new FakeSocket();sockets.push(s);return s as unknown as WebSocket});sockets[0].onopen?.();expect(JSON.parse(sockets[0].sent[0])).toEqual({type:'SUBSCRIBE',subscriptions:[{event:'MARKET_SUMMARY_UPDATE',pairs:['ETHZAR']}]});sockets[0].onmessage?.({data:update()});expect(events.at(-1)?.status).toBe('live');vi.advanceTimersByTime(25000);expect(JSON.parse(sockets[0].sent[1])).toEqual({type:'PING'});sockets[0].close();expect(events.at(-1)?.status).toBe('reconnecting');vi.advanceTimersByTime(1000);expect(sockets).toHaveLength(2);sockets[1].onopen?.();expect(JSON.parse(sockets[1].sent[0]).subscriptions[0].pairs).toEqual(['ETHZAR']);stop();vi.advanceTimersByTime(60000);expect(sockets).toHaveLength(2)});
