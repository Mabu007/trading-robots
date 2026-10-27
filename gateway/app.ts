import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { BrokerGateway } from './broker.ts';
import { BrokerRequestError } from './protocol.ts';
export function createGateway(broker:BrokerGateway,secret:string){
  const app=express();app.use(express.json({limit:'2mb'}));
  app.use((req,res,next)=>{const expected=`Bearer ${secret}`,actual=req.header('authorization')||'';if(!secret||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.status(401).json({error:'Internal authorization required'});next();});
  app.get('/health',(_req,res)=>res.json({demo:broker.demo.health(),live:broker.live.health(),demoExecutionEnabled:process.env.DEMO_TRADING_ENABLED==='true',realMoneyEnabled:false}));
  app.post('/rpc/:action',async(req,res)=>{
    const {uid,accountId,symbolId}=req.body||{};if(typeof uid!=='string'||!uid||uid.length>128)return res.status(400).json({error:'Invalid customer identity'});
    try{
      switch(req.params.action){
        case 'authorizeTokens':return res.json(await broker.authorizeTokens(uid,req.body.tokens));
        case 'accounts':return res.json(await broker.accounts(uid));
        case 'symbols':return res.json({symbols:await broker.symbols(uid,accountId)});
        case 'specification':return res.json(await broker.specification(uid,accountId,String(symbolId)));
        case 'inspect':return res.json(await broker.inspect(uid,accountId));
        case 'snapshot':return res.json(await broker.snapshot(uid,accountId,String(symbolId)));
        case 'candles':return res.json({candles:await broker.candles(uid,accountId,String(symbolId),req.body.timeframe,req.body.from,req.body.to),source:'cTrader authorized broker account'});
        case 'margin':return res.json({margin:await broker.margin(uid,accountId,req.body.order)});
        case 'reconcile':return res.json(await broker.reconcile(uid,accountId,req.body.clientOrderId,req.body.since));
        case 'submit':{
          try{const result=await broker.submit(uid,accountId,req.body.order,req.body.signal,req.body.risk);return res.json({state:'acknowledged',result});}
          catch(error){if(error instanceof BrokerRequestError)return res.json({state:error.uncertain?'unknown':error.message.startsWith('cTrader rejected')?'rejected':'not_sent',error:error.message});throw error;}
        }
        case 'manage':return res.json(await broker.manage(uid,accountId,req.body));
        default:return res.status(404).json({error:'Unknown broker operation'});
      }
    }catch(error){return res.status(502).json({error:error instanceof Error?error.message:'Broker operation failed'});}
  });return app;
}
