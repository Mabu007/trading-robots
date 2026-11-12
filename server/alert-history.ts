import {getHistoricalRates} from 'dukascopy-node';
import {ALERT_TF,checkedBars,type AlertBar} from '../shared/market-alerts.ts';
type Store={read:(key:string)=>Promise<string|null>;write:(key:string,value:string)=>Promise<void>};
export class AlertHistory{
 private store:Store;private download:typeof getHistoricalRates;
 private pending=new Map<string,Promise<{bars:AlertBar[];cached:boolean}>>();
 constructor(store:Store,download:typeof getHistoricalRates=getHistoricalRates){this.store=store;this.download=download;}
 async day(day:string,timeframe:keyof typeof ALERT_TF){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Object.hasOwn(ALERT_TF,timeframe))throw Error('Choose a valid UTC day and timeframe');
 const start=Date.parse(day+'T00:00:00Z'),end=start+86400000;if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==day||end>Date.now())throw Error('Select a completed historical UTC day');
 const {bars,cached}=await this.loadMinuteDay(day,start,end);
 const missingIntervals=1440-bars.length,seconds=ALERT_TF[timeframe],groups=new Map<number,AlertBar[]>();for(const b of bars){const t=Math.floor(b.time/seconds)*seconds;groups.set(t,[...(groups.get(t)||[]),b]);}
 const candles=[...groups.entries()].filter(([,items])=>items.length===seconds/60).map(([time,items])=>({time,open:items[0].open,high:Math.max(...items.map(b=>b.high)),low:Math.min(...items.map(b=>b.low)),close:items.at(-1)!.close,volume:0}));
 return {source:'Dukascopy',asset:'XAUUSD',priceBasis:'bid',volumeAvailable:false,day,timeframe,candles,cached,missingIntervals,coverage:'Observed candles only. Missing minutes may reflect closures or data gaps; not filled.',estimate:true};
 }
 private async loadMinuteDay(day:string,start:number,end:number):Promise<{bars:AlertBar[];cached:boolean}>{
  const existing=this.pending.get(day);if(existing)return existing;
  const task=(async()=>{
 const path=`market-alert-history/v1/dukascopy/XAUUSD/bid/m1/${day}.json`;let bars:AlertBar[]|null=null,cached=false;const raw=await this.store.read(path);
  if(raw){const saved=JSON.parse(raw);if(saved.schema===1&&saved.day===day&&saved.source==='Dukascopy'&&Array.isArray(saved.bars)){bars=checkedBars(saved.bars,60);cached=true;}}
  if(!bars){let timer:ReturnType<typeof setTimeout>|undefined;try{const rows=await Promise.race([this.download({instrument:'xauusd',dates:{from:new Date(start),to:new Date(end)},timeframe:'m1',priceType:'bid',format:'json',volumes:false,ignoreFlats:false,useCache:false,batchSize:4,retryCount:1,failAfterRetryCount:true,wafMode:'off'}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Dukascopy download timed out; try this day again')),20000)})]);
  const seen=new Map<number,AlertBar>();for(const r of rows as any[]){const b={time:r.timestamp/1000,open:r.open,high:r.high,low:r.low,close:r.close};if(b.time*1000<start||b.time*1000>=end)continue;const old=seen.get(b.time);if(old&&JSON.stringify(old)!==JSON.stringify(b))throw Error('Conflicting Dukascopy candle');seen.set(b.time,b);}
  bars=checkedBars([...seen.values()].sort((a,b)=>a.time-b.time),60);if(bars.length)await this.store.write(path,JSON.stringify({schema:1,source:'Dukascopy',day,priceBasis:'bid',bars,fetchedAt:Date.now()}));
  }finally{if(timer)clearTimeout(timer);}}

  return {bars:bars!,cached};
  })().finally(()=>this.pending.delete(day));
  this.pending.set(day,task);return task;
 }
 async ticks(day:string,hour:number){const start=Date.parse(day+'T00:00:00Z')+hour*3600000;if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isInteger(hour)||hour<0||hour>23||!Number.isFinite(start)||start+3600000>Date.now())throw Error('Choose a completed historical UTC hour');const key=`market-alert-history/v1/dukascopy/XAUUSD/ticks/${day}/${hour}.json`;const cached=await this.store.read(key);if(cached){const r=JSON.parse(cached);if(r.source==='Dukascopy'&&r.start===start&&Array.isArray(r.ticks))return r;}
 const rows=await this.download({instrument:'xauusd',dates:{from:new Date(start),to:new Date(start+3600000)},timeframe:'tick',format:'json',volumes:false,useCache:false,retryCount:1,failAfterRetryCount:true,wafMode:'off'});const ticks=(rows as any[]).map(t=>({timestamp:t.timestamp,mid:(t.askPrice+t.bidPrice)/2})).filter(t=>t.timestamp>=start&&t.timestamp<start+3600000);let previous=0;for(const t of ticks){if(!Number.isSafeInteger(t.timestamp)||t.timestamp<previous||!Number.isFinite(t.mid)||t.mid<=0)throw Error('Invalid historical tick data');previous=t.timestamp;}if(ticks.length>15000)throw Error('Tick hour exceeds replay limit');const r={source:'Dukascopy',start,ticks};if(ticks.length)await this.store.write(key,JSON.stringify(r));return r;
 }

}
