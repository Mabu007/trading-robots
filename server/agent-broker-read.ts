import {tool} from 'ai';
import {z} from 'zod';

export const brokerReadInputSchema=z.object({venue:z.enum(['all','propdao','ctrader','valr']).default('all')}).strict();

type Dependencies={
 propdao:(uid:string)=>Promise<{connected:boolean;accounts?:unknown[]}>;
 ctrader:(uid:string)=>Promise<{connected:boolean;accounts?:unknown[];gatewayConfigured?:boolean}>;
 valr:(uid:string)=>Promise<boolean>;
 now?:()=>number;
};
const str=(value:unknown,length=90)=>typeof value==='string'?value.slice(0,length):null;
const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(value)?value:null;
/** This tool never obtains or returns keys, tokens, balances, live positions or order powers.
 * Connection presence is not a broker health or execution readiness check.
 */
export function createBrokerConnectionReadTool(uid:string,deps:Dependencies){
 return tool({
  description:'Inspect user-owned native broker connection metadata and selected account IDs. Read-only. A saved connection is not proof of live order readiness. No credentials, balances, orders or positions returned.',
  inputSchema:brokerReadInputSchema,
  execute:async({venue})=>{
   if(!uid||uid.length>128||uid.includes('/'))return {available:false,reason:'Invalid signed-in identity'};
   const sources=venue==='all'?['propdao','ctrader','valr'] as const:[venue];
   const results:Record<string,unknown>={};
   for(const name of sources){
    try{
     if(name==='propdao'){
      const v=await deps.propdao(uid);
      results.propdao={available:true,connected:v.connected,source:'PropDAO authorized account list',accounts:(Array.isArray(v.accounts)?v.accounts:[]).slice(0,25).map((a:any)=>({accountId:id(a?.accountId),status:str(a?.status,40)}))};
     }else if(name==='ctrader'){
      const v=await deps.ctrader(uid);
      results.ctrader={available:true,connected:v.connected,gatewayConfigured:v.gatewayConfigured===true,source:'cTrader authorized OAuth metadata',accounts:(Array.isArray(v.accounts)?v.accounts:[]).slice(0,25).map((a:any)=>({accountId:id(a?.ctidTraderAccountId),isLive:a?.isLive===true,broker:str(a?.brokerTitleShort,90)}))};
     }else{
      results.valr={available:true,connected:await deps.valr(uid),source:'VALR encrypted connection presence',accounts:[],notice:'Balance and live broker status not checked'};
     }
    }catch{
      results[name]={available:false,connected:null,source:name,reason:'Connection status could not be verified'};
    }
   }
   return {available:true,checkedAt:new Date((deps.now||Date.now)()).toISOString(),connections:results,notice:'Connection metadata is not confirmation of account equity, broker fills or readiness to place orders.'};
  }
 });
}
