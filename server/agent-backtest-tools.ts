import {tool} from 'ai';
import {z} from 'zod';
import {getQuickJSWASMModule} from '@cf-wasm/quickjs/node';
import {evaluateStrategyInSandbox} from '../workers/strategy-sandbox.ts';
import {parseStrategyConfig,validateCandles} from '../src/strategy.ts';
import {simulate} from '../src/engine.ts';
import {intervalMs,isTimeframe} from './market-data.ts';
import type {Candle} from '../src/types.ts';
import {createHash} from 'node:crypto';

const botId=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const agentBacktestInputSchema=z.object({
 botId,lookbackCandles:z.number().int().min(120).max(600).default(240)
}).strict();

type OwnedBot={id:string;asset:string;venue?:string;userId?:string;ownerUid?:string};
type Dependencies={
 readObject:(key:string)=>Promise<string|null>;
 getOwnedBot:(uid:string,botId:string)=>Promise<OwnedBot|null>;
 market:{hyperliquidCandles:(input:{asset:string;timeframe:string;from:string;to:string})=>Promise<{source:string;asset:string;timeframe:string;candles:Candle[];missingCandles:number;observedGaps:number}>};
 now?:()=>number;
};

let wasm:ReturnType<typeof getQuickJSWASMModule>|undefined;
const modulePromise=()=>{wasm??=getQuickJSWASMModule();return wasm};
function validOwner(uid:string,stored:unknown,expectedId:string){
 if(!stored||typeof stored!=='object')throw Error('Saved strategy is unavailable');
 const data=stored as Record<string,unknown>;
 if(data.userId!==uid||data.botId!==expectedId||typeof data.code!=='string'||data.code.length>180000||!data.code.trim())throw Error('Saved strategy failed ownership or code validation');
 return data.code;
}
function assetId(value:unknown){
 return typeof value==='string'&&/^[A-Za-z0-9_:.@-]{1,64}$/.test(value);
}
/** A read-only simulated backtest. Never executes orders or treats proxy prices as broker fills.
 * QuickJS evaluates user code without network/broker/R2/Node host APIs.
 */
export function createAgentBacktestTool(uid:string,deps:Dependencies){
 return tool({
  description:'Run a bounded read-only backtest of an owned Hyperliquid strategy using genuine, completed Hyperliquid OHLC candles and isolated QuickJS. Does not place orders, save a live trade, or claim broker execution parity. Other broker venues require a matching data source.',
  inputSchema:agentBacktestInputSchema,
  execute:async({botId,lookbackCandles},options)=>{
   const abortSignal=options?.abortSignal;
   try{
    abortSignal?.throwIfAborted();
    if(!uid||uid.length>128||uid.includes('/'))throw Error('Invalid account');
    const bot=await deps.getOwnedBot(uid,botId);
    if(!bot||bot.id!==botId||bot.userId&&bot.userId!==uid||bot.ownerUid&&bot.ownerUid!==uid||!assetId(bot.asset)){
      return {available:false,reason:'Saved strategy metadata could not be verified.'};
    }
    if(bot.venue!=='hyperliquid')return {available:false,reason:'This backtest tool only supports exact Hyperliquid market data. Do not substitute Hyperliquid for another broker instrument.',venue:bot.venue??null};
    const key='user-bots/'+Buffer.from(uid).toString('base64url')+'/'+botId+'/current.json';
    const raw=await deps.readObject(key);
    if(!raw||raw.length>250000)throw Error('Saved strategy is missing or oversized');
    const saved=JSON.parse(raw);
    const code=validOwner(uid,saved,botId);
    if(saved.venue!=='hyperliquid')throw Error('Saved strategy venue does not match owned metadata');
    const config=parseStrategyConfig(code);
    if(!Array.isArray(config.timeframes)||config.timeframes.length>4||config.timeframes.some((t:string)=>!isTimeframe(t)))throw Error('Unsupported strategy timeframes');
    const clock=(deps.now||Date.now)();
    const datasets:Record<string,any[]>={},gaps:Record<string,number>={};
    const lineage:{timeframe:string;first:string;last:string;count:number;missing:number}[]=[];
    for(const timeframe of config.timeframes){
      abortSignal?.throwIfAborted();
      const duration=intervalMs[timeframe as keyof typeof intervalMs];
      const end=Math.floor(clock/duration)*duration,from=end-lookbackCandles*duration;
      const market=await deps.market.hyperliquidCandles({asset:bot.asset,timeframe,from:new Date(from).toISOString(),to:new Date(end).toISOString()});
      if(market.source!=='Hyperliquid'||market.asset!==bot.asset||market.timeframe!==timeframe||market.missingCandles>0||market.observedGaps>0)throw Error('Incomplete or mismatched Hyperliquid candle history');
      const rows=validateCandles(market.candles);
      if(rows.length!==lookbackCandles)throw Error('Historical candle count differs from requested range');
      datasets[timeframe]=rows;
      gaps[timeframe]=0;
      lineage.push({timeframe,first:new Date(rows[0].time*1000).toISOString(),last:new Date(rows.at(-1)!.time*1000).toISOString(),count:rows.length,missing:0});
    }
    const quickjs=await modulePromise();
    abortSignal?.throwIfAborted();
    const decisions=evaluateStrategyInSandbox(quickjs,code,datasets,config);
    const execution=datasets[config.executionTimeframe];
    if(!execution||decisions.length!==execution.length)throw Error('Strategy produced incomplete decisions');
    const result=simulate(execution,decisions,0,{
      spread:config.backtestSpread||0,slippage:config.backtestSlippage||0,commissionR:config.backtestCommissionR||0
    },config.riskReward);
    const metrics=result.metrics;
    const preview=result.trades.slice(0,10).map(t=>({id:t.id,side:t.side,entryTime:t.entryTime,exitTime:t.exitTime,entry:t.entry,exit:t.exit,pnlR:t.pnl,reason:t.reason}));
    return {available:true,kind:'simulation',venue:'hyperliquid',asset:bot.asset,botId,
      source:'Hyperliquid public completed candles',sourceType:'exact Hyperliquid instrument, not broker fills',
      codeHash:createHash('sha256').update(code).digest('hex'),
      evaluatedAt:new Date(clock).toISOString(),executionTimeframe:config.executionTimeframe,coverage:lineage,
      tradeCount:result.trades.length,tradeSample:preview,metrics:{...metrics,netReturnUnit:'R',maxDrawdownUnit:'R',endingBalanceUnit:'R'},
      assumptions:{spread:config.backtestSpread||0,slippage:config.backtestSlippage||0,commissionR:config.backtestCommissionR||0,riskReward:config.riskReward},
      caveat:'Simulated R performance from complete Hyperliquid OHLC candles. No live broker fills, account currency, contract sizing, funding, partial fills or intrabar execution sequence is verified.'};
   }catch(e){
    return {available:false,reason:e instanceof Error?e.message.slice(0,180):'Backtest could not be verified.'};
   }
  }
 });
}
