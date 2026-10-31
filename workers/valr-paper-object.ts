import { DurableObject } from 'cloudflare:workers';
import { getQuickJSWASMModule } from '@cf-wasm/quickjs/workerd';
import { parseStrategyConfig } from '../src/strategy';
import { TF_SECONDS } from '../shared/trading';
import { evaluateStrategyInSandbox } from './strategy-sandbox';
import { fetchValrCandles } from './valr-candles';
import { ValrPaperRuntime } from './valr-paper-runtime';
import type { PaperCandle, PaperDecision, PaperRisk, PaperSpec, PaperState } from './valr-paper';

type Deployment={pair:string;code:string;config:ReturnType<typeof parseStrategyConfig>};
const reply=(value:unknown,status=200)=>Response.json(value,{status});

// One instance must be addressed by a server-derived user-and-bot identifier.
// This object only simulates spot trades. It never receives exchange secrets.
export class ValrPaper extends DurableObject<any> {
 private runtime:ValrPaperRuntime;
 private tail:Promise<unknown>=Promise.resolve();
 private valrBase='https://api.valr.com';
 constructor(ctx:DurableObjectState,env:any){super(ctx,env);
  // The loopback override is only accepted alongside the local-only control URL.
  // Production uses VALR directly and does not accept arbitrary upstream hosts.
  if(typeof env.VALR_TEST_ENDPOINT==='string'&&typeof env.CONTROL_API_URL==='string'){
   const test=new URL(env.VALR_TEST_ENDPOINT),control=new URL(env.CONTROL_API_URL);
   if(test.protocol==='http:'&&test.hostname==='127.0.0.1'&&control.protocol==='http:'&&control.hostname==='127.0.0.1')this.valrBase=test.origin;
  }
  this.runtime=new ValrPaperRuntime({get:key=>ctx.storage.get(key),put:(key,value)=>ctx.storage.put(key,value),setAlarm:time=>ctx.storage.setAlarm(time),deleteAlarm:()=>ctx.storage.deleteAlarm()},{now:Date.now,next:last=>this.next(last)})}
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const next=this.tail.then(fn,fn);this.tail=next.catch(()=>{});return next}
 async fetch(req:Request){return this.serial(async()=>{
  try{
   const action=new URL(req.url).pathname.split('/').at(-1);
   if(action==='status'&&req.method==='GET')return reply(await this.runtime.status());
   if(req.method!=='POST')return reply({error:'POST required'},405);
   if(action==='deploy')return reply(await this.deploy(await req.json()));
   if(action==='start')return reply(await this.runtime.start());
   if(action==='stop')return reply(await this.runtime.stop());
   return reply({error:'Unknown paper action'},404);
  }catch(e){return reply({error:e instanceof Error?e.message:'Paper operation failed'},400)}
 })}
 async alarm(){return this.serial(()=>this.runtime.alarm())}
 private async deploy(input:unknown){
  const data=input as {pair?:unknown;code?:unknown;balance?:unknown;allocation?:unknown;riskPercent?:unknown;dailyLossPercent?:unknown};
  if(!data||typeof data.pair!=='string'||!/^[A-Z0-9]{3,30}$/.test(data.pair)||typeof data.code!=='string'||data.code.length>180_000||!data.code.trim())throw Error('Invalid paper deployment');
  if(await this.ctx.storage.get('paper'))throw Error('Paper robot already deployed');
  const config=parseStrategyConfig(data.code);if(!/export\s+function\s+onCandle\s*\(/.test(data.code))throw Error('Missing onCandle export');
  const response=await fetch(`${this.valrBase}/v1/public/pairs`,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('VALR market specifications unavailable');
  const pairs=await response.json<unknown>();if(!Array.isArray(pairs))throw Error('Invalid VALR market specifications');
  const pair=pairs.find((p:any)=>p.symbol===data.pair&&p.active===true&&p.currencyPairType==='SPOT');if(!pair)throw Error('Paper execution currently supports active VALR spot markets only');
  const spec:PaperSpec={baseDecimalPlaces:Number(pair.baseDecimalPlaces),minBaseAmount:Number(pair.minBaseAmount),maxBaseAmount:Number(pair.maxBaseAmount),minQuoteAmount:Number(pair.minQuoteAmount),maxQuoteAmount:Number(pair.maxQuoteAmount)};
  const risk:PaperRisk={allocation:Number(data.allocation),riskPercent:Number(data.riskPercent),dailyLossPercent:Number(data.dailyLossPercent),timeframeSeconds:TF_SECONDS[config.executionTimeframe]};
  const balance=Number(data.balance);
  if(!Number.isFinite(balance)||balance<=0||!Number.isFinite(risk.allocation)||risk.allocation<=0||risk.allocation>balance||!Number.isFinite(risk.riskPercent)||risk.riskPercent<0.01||risk.riskPercent>Math.min(2,config.riskPercent)||!Number.isFinite(risk.dailyLossPercent)||risk.dailyLossPercent<0.1||risk.dailyLossPercent>10)throw Error('Invalid paper allocation or risk limits');
  const state:PaperState={running:false,balance,lastCandle:null,day:'',dayStartBalance:balance,pending:null,position:null,lastResult:'Paper robot deployed; stopped'};
  const deployment:Deployment={pair:data.pair,code:data.code,config};
  await this.ctx.storage.put('paper-deployment',deployment);
  try{await this.runtime.deploy(state,spec,risk)}catch(e){await this.ctx.storage.delete('paper-deployment');throw e}
  return {deployed:true,mode:'paper',pair:data.pair,state};
 }
 private async next(last:number|null):Promise<{candle:PaperCandle;decision:PaperDecision;discardPending?:boolean}|null>{
  const deployment=await this.ctx.storage.get<Deployment>('paper-deployment');if(!deployment)throw Error('Paper strategy is missing');
  const saved=await this.ctx.storage.get<{state:PaperState}>('paper');
  const period=TF_SECONDS[deployment.config.executionTimeframe],latest=Math.floor((Date.now()/1000-5)/period)*period;
  const cutoff=last===null||saved?.state.resumeLatest?latest:last+2*period;if(cutoff>latest||last!==null&&cutoff<=last+period)return null;
  const stored=await this.ctx.storage.get<Record<string,PaperCandle[]>>('paper-history')||{};
  const datasets:Record<string,PaperCandle[]>={};let total=0;
  for(const tf of deployment.config.timeframes as string[]){
   const duration=TF_SECONDS[tf],end=Math.floor(cutoff/duration)*duration,old=stored[tf]||[];
   const from=old.length?old.at(-1)!.time+duration:end-200*duration;
   if(from>end)throw Error('Stored VALR history is ahead of the next candle');
   const added=from<end?await fetchValrCandles(deployment.pair,tf,from,end,fetch,this.valrBase):[];
   datasets[tf]=[...old,...added];total+=datasets[tf].length;
   if(total>5000)throw Error('Paper replay history limit reached; stop and redeploy after reviewing the strategy');
   if(!datasets[tf].length)throw Error(`No completed ${tf} history`);
  }
  await this.ctx.storage.put('paper-history',datasets);
  const candle=datasets[deployment.config.executionTimeframe].at(-1);if(!candle||candle.time+period!==cutoff)throw Error('Execution candle is missing');
  if(!saved?.state.running||cutoff<latest)return {candle,decision:{action:'WAIT'},discardPending:true};
  const quick=await getQuickJSWASMModule();const decisions=evaluateStrategyInSandbox(quick,deployment.code,datasets,deployment.config);
  return {candle,decision:decisions.at(-1) as PaperDecision};
 }
}
