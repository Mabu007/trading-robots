import {it,expect} from 'vitest';
import {biquoteSnapshot} from '../shared/biquote';
const now=Date.parse('2026-11-11T10:00:05Z');
const request=(q:any={},b:any={})=>async(url:any)=>Response.json(String(url).includes('/ohlc')?{symbol:'XAUUSD',interval:'5m',bars:[{openTime:'2026-11-11T09:55:00Z',open:100,high:110,low:99,close:105,isOpen:false},{openTime:'2026-11-11T10:00:00Z',open:105,high:110,low:104,close:108,isOpen:true}],...b}:{symbol:'XAUUSD',bid:105,ask:106,marketState:'open',stale:false,timestamp:new Date(now).toISOString(),...q});
it('uses only the latest completed candle and retains feed identity',async()=>{const s=await biquoteSnapshot('XAUUSD','m5',request() as any,now);expect(s.bars).toHaveLength(1);expect(s.source).toBe('BiQuote');});
it('suspends on stale, closed, future, incorrect or malformed data',async()=>{for(const q of [{stale:true},{marketState:'closed'},{timestamp:'invalid'},{symbol:'EURUSD'},{timestamp:new Date(now+10000).toISOString()}])await expect(biquoteSnapshot('XAUUSD','m5',request(q) as any,now)).rejects.toThrow();await expect(biquoteSnapshot('XAUUSD','m5',request({}, {bars:[]}) as any,now)).rejects.toThrow();});
