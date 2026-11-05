import {DurableObject} from 'cloudflare:workers';
import {analyzeMarket,type AnalysisKind,type MarketBar} from '../src/code-analysis';

type WatchConfig={uid:string;id:string;kind:AnalysisKind;asset:string;timeframe:'m1'|'m5'|'m15'|'h1';coin:string;lookback:number};
type WatchState={running:boolean;config:WatchConfig|null;lastCandle:number|null;lastCheck:number|null;nextAlarm:number|null;error:string|null;events:{id:string;time:number;kind:string;level:number;price:number}[]};
const intervals:{[k:string]:[string,number]}={m1:['1m',60],m5:['5m',300],m15:['15m',900],h1:['1h',3600]};
const valid=(c:any):c is WatchConfig=>c&&typeof c.uid==='string'&&c.uid.length>5&&c.uid.length<150&&/^analysis-[a-z0-9_-]{8,110}$/.test(c.id)&&['liquidity_sweeps','volatility_profile'].includes(c.kind)&&['m1','m5','m15','h1'].includes(c.timeframe)&&['BTC','ETH','SOL','XRP','xyz:GOLD'].includes(c.coin)&&Number.isInteger(c.lookback)&&c.lookback>=3&&c.lookback<=25&&typeof c.asset==='string'&&c.asset.length<=50;
export class CodeWatch extends DurableObject<any>{
 private async getState():Promise<WatchState>{
  return {running:await this.ctx.storage.get('running')===true,config:(await this.ctx.storage.get<WatchConfig>('config'))||null,lastCandle:(await this.ctx.storage.get<number>('lastCandle'))||null,lastCheck:(await this.ctx.storage.get<number>('lastCheck'))||null,nextAlarm:(await this.ctx.storage.get<number>('nextAlarm'))||null,error:(await this.ctx.storage.get<string>('lastError'))||null,events:(await this.ctx.storage.get<WatchState['events']>('events'))||[]};
 }
 async fetch(req:Request){
  const op=new URL(req.url).pathname;
  if(op==='/status'&&req.method==='GET')return Response.json(await this.getState());
  if(op==='/start'&&req.method==='POST'){
   const config=await req.json().catch(()=>null);if(!valid(config))return Response.json({error:'Invalid monitor specification'},{status:400});
   const current=await this.ctx.storage.get<WatchConfig>('config');
   if(current&&current.uid!==config.uid)return Response.json({error:'Wrong owner'},{status:403});
   await this.ctx.storage.put('config',config);await this.ctx.storage.put('running',true);await this.ctx.storage.delete('lastError');
   const next=Date.now()+1500;await this.ctx.storage.setAlarm(next);await this.ctx.storage.put('nextAlarm',next);
   return Response.json(await this.getState());
  }
  if(op==='/stop'&&req.method==='POST'){
   await this.ctx.storage.put('running',false);await this.ctx.storage.deleteAlarm();await this.ctx.storage.delete('nextAlarm');
   return Response.json(await this.getState());
  }
  return Response.json({error:'Unknown monitor action'},{status:404});
 }
 async alarm(){
  const state=await this.getState();if(!state.running||!state.config)return;
  const config=state.config,interval=intervals[config.timeframe],seconds=interval[1],lastClosed=Math.floor(Date.now()/1000/seconds)*seconds-seconds;
  try{
   const start=(lastClosed-210*seconds)*1000,end=(lastClosed+seconds)*1000-1;
   const response=await fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'candleSnapshot',req:{coin:config.coin,interval:interval[0],startTime:start,endTime:end}}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Market provider unavailable (HTTP '+response.status+')');
   const rows=await response.json() as any[];
   if(!Array.isArray(rows))throw Error('Invalid market candle response');
   const candles:MarketBar[]=rows.filter(r=>r.s===config.coin&&r.i===interval[0]).map(r=>({time:Number(r.t)/1000,open:Number(r.o),high:Number(r.h),low:Number(r.l),close:Number(r.c)})).filter(b=>b.time<=lastClosed&&b.time+seconds<=Math.floor(Date.now()/1000));
   candles.sort((a,b)=>a.time-b.time);
   if(candles.length<20)throw Error('Insufficient closed candle history');
   const latest=candles.at(-1)!.time;
   if(latest>Number(state.lastCandle||0)){
    const report=analyzeMarket({kind:config.kind,asset:config.asset,timeframe:config.timeframe,from:new Date((latest-201*seconds)*1000).toISOString(),to:new Date((latest+seconds)*1000).toISOString(),lookback:config.lookback},candles);
    const findings=report.findings.filter(f=>f.time===latest);
    const events=state.events;
    if(config.kind==='liquidity_sweeps')for(const f of findings)events.push({id:config.id+':'+f.time+':'+f.kind,time:f.time,kind:f.kind,level:f.level,price:f.price});
    if(config.kind==='volatility_profile'){const prior=await this.ctx.storage.get<string>('lastVolRegime');if(report.regime==='High relative volatility'&&prior!=='High relative volatility')events.push({id:config.id+':'+latest+':high-vol',time:latest,kind:'High relative volatility',level:report.atrPercent||0,price:candles.at(-1)!.close});await this.ctx.storage.put('lastVolRegime',report.regime);}
    await this.ctx.storage.put('events',events.slice(-100));await this.ctx.storage.put('lastCandle',latest);
   }
   await this.ctx.storage.put('lastCheck',Date.now());await this.ctx.storage.delete('lastError');
  }catch(error){await this.ctx.storage.put('lastError',error instanceof Error?error.message.slice(0,180):'Monitor data unavailable');await this.ctx.storage.put('lastCheck',Date.now());}
  finally{
   if(await this.ctx.storage.get('running')===true){const now=Date.now(),next=Math.max(now+15000,(Math.floor(now/(seconds*1000))+1)*seconds*1000+4000);await this.ctx.storage.setAlarm(next);await this.ctx.storage.put('nextAlarm',next);}
  }
 }
}
