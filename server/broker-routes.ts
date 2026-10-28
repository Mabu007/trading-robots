import type { Express,Request,Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { brokerTokenKey,BrokerTokenStore } from './broker-tokens.ts';
import { marketplace,accessId,type Marketplace } from './marketplace.ts';
import { FirestoreStore,recordId } from './firestore-store.ts';
export async function gatewayRequest(action:string,body:any){
  if(!process.env.CTRADER_GATEWAY_URL||!process.env.TRADING_INTERNAL_SECRET)throw Error('The persistent cTrader gateway is not configured.');
  const response=await fetch(new URL(`/rpc/${action}`,process.env.CTRADER_GATEWAY_URL),{method:'POST',headers:{Authorization:`Bearer ${process.env.TRADING_INTERNAL_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  const data=await response.json() as any;if(!response.ok)throw Error(data.error||'Broker gateway is unavailable.');return data;
}
export async function gatewayHealth(){
  if(!process.env.CTRADER_GATEWAY_URL||!process.env.TRADING_INTERNAL_SECRET)throw Error('Broker gateway is not configured.');
  const response=await fetch(new URL('/health',process.env.CTRADER_GATEWAY_URL),{headers:{Authorization:`Bearer ${process.env.TRADING_INTERNAL_SECRET}`},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Broker gateway health is unavailable.');
  const data=await response.json() as any;
  return { demoConnected:data.demo?.connected===true, demoLastMessageAt:Number(data.demo?.lastMessageAt)||null, demoExecutionEnabled:data.demoExecutionEnabled===true, realMoneyEnabled:data.realMoneyEnabled===true };
}
export function brokerRoutes(app:Express,deps:{uid:(req:Request,res:Response)=>Promise<string|null>;tokens:BrokerTokenStore;remove:(key:string)=>Promise<void>},service:Marketplace=marketplace){
  const route=(method:'get'|'post',path:string,fn:(uid:string,req:Request)=>Promise<any>)=>app[method](path,async(req,res)=>{const uid=await deps.uid(req,res);if(!uid)return;res.setHeader('Cache-Control','private, no-store');try{return res.json(await fn(uid,req));}catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Broker request failed'});}});
  route('get','/api/brokers/ctrader/accounts',uid=>gatewayRequest('accounts',{uid}));
  route('post','/api/brokers/ctrader/select',async(uid,req)=>{
    if(!FirestoreStore.configured())throw Error('Marketplace server records are not configured.');
    const data=await gatewayRequest('accounts',{uid}),account=data.accounts.find((a:any)=>a.accountId===String(req.body?.accountId));if(!account)throw Error('Choose one of your authorized accounts.');
    const claimPath=`brokerAccountClaims/${account.environment}_${account.accountId}`,claimed=await service.store.create(claimPath,{uid,accountId:account.accountId,environment:account.environment,createdAt:Date.now()});if(!claimed&&(await service.store.get(claimPath))?.uid!==uid)throw Error('This broker account is already connected to a different app account. Contact support to transfer it safely.');
    await service.emergencyPause(uid,'Broker account changed');
    await service.store.put(`brokerConnections/${recordId(uid)}`,{uid,connected:true,accountId:account.accountId,environment:account.environment,broker:account.broker,tradingPermission:data.scope===1||data.scope==='SCOPE_TRADE',mappings:{},emergencyPaused:false,updatedAt:Date.now()});return {selected:account};
  });
  route('get','/api/brokers/ctrader/symbols',async uid=>{const broker=await service.store.get(`brokerConnections/${recordId(uid)}`);if(!broker?.connected||!broker.accountId)throw Error('Select a demo account first');return gatewayRequest('symbols',{uid,accountId:broker.accountId});});
  route('post','/api/brokers/ctrader/mapping',async(uid,req)=>{
    const broker=await service.store.get(`brokerConnections/${recordId(uid)}`),asset=req.body?.asset,symbolId=String(req.body?.symbolId);if(!broker?.connected||!broker.accountId||!['EURUSD','GBPUSD','USDJPY','XAUUSD'].includes(asset))throw Error('Select an account and a supported strategy asset');
    const result=await gatewayRequest('symbols',{uid,accountId:broker.accountId});const symbol=result.symbols.find((s:any)=>s.symbolId===symbolId&&s.enabled);if(!symbol)throw Error('Choose an actual available symbol on this broker.');
    await service.emergencyPause(uid,'Broker symbol mapping changed');const mappings={...broker.mappings,[asset]:symbolId};const current=await service.store.get(`brokerConnections/${recordId(uid)}`);if(!current||current.accountId!==broker.accountId)throw Error('Broker selection record is missing');await service.store.put(`brokerConnections/${recordId(uid)}`,{...broker,mappings,emergencyPaused:false,updatedAt:Date.now()});return {asset,symbol};
  });
  route('post','/api/brokers/ctrader/specification',async(uid,req)=>{const broker=await service.store.get(`brokerConnections/${recordId(uid)}`);if(!broker?.connected||!broker.accountId)throw Error('Select your broker account');return gatewayRequest('specification',{uid,accountId:broker.accountId,symbolId:String(req.body?.symbolId)})});
  route('get','/api/brokers/ctrader/account',async uid=>{const broker=await service.store.get(`brokerConnections/${recordId(uid)}`);if(!broker?.connected||!broker.accountId)throw Error('Select your broker account');return gatewayRequest('inspect',{uid,accountId:broker.accountId});});
  route('post','/api/brokers/ctrader/disconnect',async uid=>{if(FirestoreStore.configured())await service.emergencyPause(uid,'Broker disconnected');await deps.remove(brokerTokenKey(uid));if(FirestoreStore.configured())await service.store.put(`brokerConnections/${recordId(uid)}`,{uid,connected:false,emergencyPaused:true,updatedAt:Date.now()});return {disconnected:true,positionsClosed:false};});
  // Called only by the authenticated Worker. Customer IDs never come from browser input here.
  app.post('/api/internal/trading/:action',async(req,res)=>{
    const expected=`Bearer ${process.env.TRADING_INTERNAL_SECRET||''}`,header=req.header('authorization')||'';
    if(!process.env.TRADING_INTERNAL_SECRET||Buffer.byteLength(header)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(header),Buffer.from(expected)))return res.status(401).json({error:'Internal authorization required'});
    try{
      const {uid,botId,version}=req.body||{};switch(req.params.action){
        case 'broker-event':{const record=req.body.record;if(!record?.uid||!record.id||!record.clientOrderId||!/^[a-f0-9]{64}$/.test(record.id))throw Error('Invalid broker event');await service.store.create(`executionEvents/${record.id}`,record);return res.json({saved:true});}
        case 'subscribers':{const all=await service.store.query('botSubscribers','botId',botId);return res.json({subscribers:all.filter(s=>s.status==='active').map(s=>({uid:s.uid,accountId:s.accountId}))});}
        case 'eligible':return res.json(await service.eligible(uid,botId,version,req.body.signalId,req.body.candleClose));
        case 'signal':{const signal=req.body.signal;if(!signal?.botId||!signal.id)throw Error('Invalid signal');const bot=await service.store.get(`marketplaceBots/${signal.botId}`);if(!bot)throw Error('Unknown bot');await service.store.create(`signals/${signal.id}`,{...signal,creatorId:bot.creatorId});return res.json({saved:true});}
        case 'execution':{const record=req.body.record;if(!record||record.uid!==uid||record.botId!==botId)throw Error('Invalid execution record');await service.store.put(`customerExecutions/${accessId(botId,uid)}_${record.id}`,record);return res.json({saved:true});}
        default:return res.status(404).json({error:'Unknown internal operation'});
      }
    }catch(error){return res.status(503).json({error:error instanceof Error?error.message:'Internal trading operation failed'});}
  });
}
