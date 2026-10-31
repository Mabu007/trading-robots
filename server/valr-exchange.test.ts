import { expect,it,vi } from 'vitest';
import { ValrExchange } from './valr-exchange';
import { valrSignature } from './valr-account';

const creds={apiKey:'a'.repeat(64),apiSecret:'b'.repeat(64)};
it('signs a spot market buy and never treats acknowledgement as a fill',async()=>{
 const request=vi.fn(async()=>Response.json({id:'exchange-order'},{status:202}));
 const client=new ValrExchange(creds,request as typeof fetch,()=>1558017528946);
 expect(await client.marketBuy('ETHZAR','0.01','bot-signal-1')).toEqual({orderId:'exchange-order'});
 const [url,init]=request.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe('https://api.valr.com/v1/orders/market');
 expect(JSON.parse(String(init.body))).toEqual({side:'BUY',baseAmount:'0.01',pair:'ETHZAR',customerOrderId:'bot-signal-1',allowMargin:false,timeInForce:'FOK'});
 expect((init.headers as Record<string,string>)['X-VALR-SIGNATURE']).toBe(valrSignature(creds.apiSecret,'1558017528946','POST','/v1/orders/market',String(init.body)));
});
it('builds one OCO conditional with no margin and refuses invalid levels',async()=>{
 const request=vi.fn(async()=>Response.json({id:'protection-id'},{status:202}));
 const client=new ValrExchange(creds,request as typeof fetch);
 await client.spotProtection('ETHZAR','0.01','200','300','protect-1');
 const [,init]=request.mock.calls[0] as unknown as [string,RequestInit];
 expect(JSON.parse(String(init.body))).toMatchObject({side:'SELL',allowMargin:false,stopLossTriggerPrice:'200',stopLossOrderPrice:'-1',takeProfitTriggerPrice:'300',takeProfitOrderPrice:'-1'});
 await expect(client.spotProtection('ETHZAR','0.01','300','200','protect-2')).rejects.toThrow('Invalid');
 expect(request).toHaveBeenCalledTimes(1);
});
it('rejects a mismatched order status instead of claiming reconciliation',async()=>{
 const request=vi.fn(async()=>Response.json({orderId:'id',customerOrderId:'other',currencyPair:'ETHZAR',orderStatusType:'Filled'}));
 const client=new ValrExchange(creds,request as typeof fetch);
 await expect(client.orderStatus('ETHZAR','bot-signal-1')).rejects.toThrow('mismatched');
});
