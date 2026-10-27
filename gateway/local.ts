import 'dotenv/config';
import {createHash} from 'node:crypto';
import { BrokerTokenStore } from '../server/broker-tokens.ts';
import { readR2Object,writeR2Object } from '../server/r2.ts';
import { BrokerGateway } from './broker.ts';
import { createGateway } from './app.ts';
const port=Number(process.env.GATEWAY_PORT||8790),secret=process.env.TRADING_INTERNAL_SECRET||'';
if(secret.length<32||!BrokerTokenStore.configured()||!process.env.CTRADER_CLIENT_ID||!(process.env.CTRADER_CLIENT_SECRET||process.env.CTRADER_SECRET_KEY))throw Error('Configure gateway authentication, token encryption, and cTrader application credentials before starting.');
const broker=new BrokerGateway(new BrokerTokenStore({read:readR2Object,write:writeR2Object}),undefined,{
  intent:(id,data)=>writeR2Object(`broker-intents/${id}.json`,JSON.stringify(data)),
  event:async(environment,payload)=>{
    const clientOrderId=payload.order?.clientOrderId||payload.position?.tradeData?.label;
    if(typeof clientOrderId!=='string'||!/^tv_[a-f0-9]{44}$/.test(clientOrderId))return;
    const saved=await readR2Object(`broker-intents/${clientOrderId}.json`);if(!saved)return;
    const owner=JSON.parse(saved),id=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const record={...owner,id,clientOrderId,environment,payload,observedAt:Date.now()};
    await writeR2Object(`broker-execution-events/${id}.json`,JSON.stringify(record));
    if(!process.env.CONTROL_API_URL)return;
    for(let attempt=0;attempt<3;attempt++){try{
      const response=await fetch(new URL('/api/internal/trading/broker-event',process.env.CONTROL_API_URL),{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({record}),signal:AbortSignal.timeout(10000)});if(response.ok)return;
    }catch{}await new Promise(r=>setTimeout(r,250*(attempt+1)));}
    console.warn(JSON.stringify({event:'broker.audit_mirror_pending',id}));
  }
});
const server=createGateway(broker,secret).listen(port,process.env.GATEWAY_HOST||'127.0.0.1',()=>console.log(JSON.stringify({event:'gateway.started',port,realMoneyEnabled:false})));
const stop=()=>{broker.demo.close();broker.live.close();server.close(()=>process.exit(0));};process.on('SIGTERM',stop);process.on('SIGINT',stop);
