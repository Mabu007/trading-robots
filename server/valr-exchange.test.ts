import { expect,it,vi } from 'vitest';
import { ValrExchange } from './valr-exchange';
import { valrSignature } from './valr-account';

const creds={apiKey:'a'.repeat(64),apiSecret:'b'.repeat(64)};
it('signs a price-capped spot limit buy and never treats acknowledgement as a fill',async()=>{
 const request=vi.fn(async()=>Response.json({id:'exchange-order'},{status:202}));
 const client=new ValrExchange(creds,request as typeof fetch,()=>1558017528946);
 expect(await client.limitBuy('ETHZAR','0.01','200','bot-signal-1')).toEqual({orderId:'exchange-order'});
 const [url,init]=request.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe('https://api.valr.com/v1/orders/limit');
 expect(JSON.parse(String(init.body))).toEqual({side:'BUY',quantity:'0.01',price:'200',pair:'ETHZAR',customerOrderId:'bot-signal-1',allowMargin:false,postOnly:false,timeInForce:'FOK'});
 expect((init.headers as Record<string,string>)['X-VALR-SIGNATURE']).toBe(valrSignature(creds.apiSecret,'1558017528946','POST','/v1/orders/limit',String(init.body)));
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
it('recovers a conditional by customer ID and verifies the exact status record',async()=>{
 const request=vi.fn(async(url:string|URL|Request)=>{const path=String(url).replace('https://api.valr.com','');if(path==='/v1/orders/conditionals')return Response.json([]);if(path==='/v1/orders/conditionals/ETHZAR/history')return Response.json([{orderId:'valr-p1',customerOrderId:'protect-1',currencyPair:'ETHZAR'}]);return Response.json({orderId:'valr-p1',customerOrderId:'protect-1',currencyPair:'ETHZAR',orderStatusType:'Placed'})});
 const client=new ValrExchange(creds,request as typeof fetch,()=>1558017528946);expect(await client.protectionStatus('ETHZAR','protect-1')).toMatchObject({orderId:'valr-p1',orderStatusType:'Placed'});expect(request).toHaveBeenCalledTimes(3);expect(String(request.mock.calls[2][0])).toContain('/conditional/ETHZAR/orderid/valr-p1');
});
it('never treats absent conditional history as proof it was not submitted',async()=>{const request=vi.fn(async()=>Response.json([]));const client=new ValrExchange(creds,request as typeof fetch);expect(await client.protectionStatus('ETHZAR','protect-1')).toBeNull();expect(request).toHaveBeenCalledTimes(2)});
it('builds a verified read-only spot snapshot with signed account calls and unsigned public calls',async()=>{
 const request=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{const path=String(url).replace('https://api.valr.com','');if(path.startsWith('/v1/public/'))expect(init?.headers).toBeUndefined();else expect((init?.headers as Record<string,string>)['X-VALR-SIGNATURE']).toBe(valrSignature(creds.apiSecret,'1558017528946','GET',path));
 const responses:Record<string,unknown>={
 '/v1/public/pairs':[{symbol:'ETHZAR',baseCurrency:'ETH',quoteCurrency:'ZAR',active:true,currencyPairType:'SPOT',minBaseAmount:'0.001',maxBaseAmount:'100',minQuoteAmount:'10',maxQuoteAmount:'100000',tickSize:'0.1',baseDecimalPlaces:'3'}],
 '/v1/account/balances?excludeZeroBalances=false':[{currency:'ETH',total:'0',available:'0'},{currency:'ZAR',total:'1000',available:'1000'}],
 '/v1/orders/open':[],'/v1/orders/conditionals':[], '/v1/public/ETHZAR/ordertypes':['LIMIT','STOP_LOSS_LIMIT','TAKE_PROFIT_LIMIT'],
 '/v1/account/fees/trade':[{currencyPair:'ETHZAR',takerPercentage:'0.1'}], '/v1/public/slippage':[{currencyPair:'ETHZAR',currencyPairType:'SPOT',marketSlippagePercent:'5',limitSlippagePercent:'5'}],
 '/v1/marketdata/ETHZAR/orderbook':{Bids:[{price:'99.9'}],Asks:[{price:'100'}],LastChange:'2026-10-31T00:00:00Z'}};
 if(!(path in responses))throw Error('unexpected URL');return Response.json(responses[path]);});
 const client=new ValrExchange(creds,request as typeof fetch,()=>1558017528946);const s=await client.snapshot('ETHZAR',{dayStartEquity:'1000',dailyLoss:'0',reconciled:true});expect(s).toMatchObject({baseCurrency:'ETH',quoteCurrency:'ZAR',takerFeeBps:10,protectiveSlippageBps:500,account:{openOrders:0,openPositions:0}});expect(request).toHaveBeenCalledTimes(8);
});
