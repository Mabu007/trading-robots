import {watchOutputSchema,type WatchOutput} from './watch-outputs.ts';
import type {Express,Request,Response} from 'express';
import type {RecordStore} from './firestore-store.ts';

type Deps={uid:(req:Request,res:Response)=>Promise<string|null>;store:RecordStore;outputs?:{start:(uid:string,id:string,asset:string,timeframe:string,output:WatchOutput)=>Promise<number>;stop:(uid:string,id:string)=>Promise<void>};request?:typeof fetch;env?:NodeJS.ProcessEnv};
const watchId=(v:string)=>/^analysis-[a-z0-9_-]{8,110}$/.test(v);
const coins:Record<string,string>={GOLDUSDC:'xyz:GOLD',BTCUSDC:'BTC',BTCUSDT:'BTC',ETHUSDC:'ETH',ETHUSDT:'ETH',SOLUSDC:'SOL',XRPUSDC:'XRP'};
export function codeWatchRoutes(app:Express,deps:Deps){
 const request=deps.request||fetch,env=deps.env||process.env;
 const config=()=>{const url=String(env.CODE_WATCH_RUNTIME_URL||''),secret=String(env.CODE_WATCH_INTERNAL_SECRET||'');if(env.CODE_WATCH_ENABLED!=='true'||!/^https:\/\//.test(url)||secret.length<32)return null;return {url,secret}};
 const call=async(uid:string,id:string,action:'start'|'stop'|'status',payload?:unknown)=>{
  const live=config();if(!live)throw Error('Code monitoring runtime is not enabled. No watch has been started.');
  const url=new URL('/watches/'+id+'/'+action,live.url);
  const response=await request(url.href,{method:action==='status'?'GET':'POST',headers:{Authorization:'Bearer '+live.secret,'X-TV-UID':uid,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(17000)});
  if(!response.ok)throw Error('Code monitor did not confirm '+action+' (HTTP '+response.status+').');
  const json=await response.json().catch(()=>null) as any;
  if(!json||typeof json.running!=='boolean'||!Array.isArray(json.events))throw Error('Code monitor returned an invalid status.');
  return {running:json.running,verified:true,outputReady:json.outputReady===true,lastCandle:json.lastCandle??null,lastCheck:json.lastCheck??null,nextAlarm:json.nextAlarm??null,error:typeof json.error==='string'?json.error.slice(0,200):null,events:json.events.slice(-50)};
 };
 const authenticate=async(req:Request,res:Response)=>{res.setHeader('Cache-Control','private,no-store');return deps.uid(req,res)};
 app.get('/api/code-watches',async(req,res)=>{
  const uid=await authenticate(req,res);if(!uid)return;
  try{
   const saved=await deps.store.query('users/'+uid+'/codeWatches');
   const rows=await Promise.all(saved.slice(0,20).map(async asset=>{
    const id=String(asset.id||'');if(!watchId(id))return null;
    try{return {id,name:asset.name||id,asset:asset.asset,kind:asset.kind,...await call(uid,id,'status')}}
    catch(e){return {id,name:asset.name||id,asset:asset.asset,kind:asset.kind,running:false,verified:false,state:'unknown',events:[],error:e instanceof Error?e.message:'Status unavailable'}}
   }));
   return res.json({watches:rows.filter(Boolean)});
  }catch{return res.status(503).json({error:'Could not verify your Code monitors.'})}
 });
 app.get('/api/code-watches/:id',async(req,res)=>{
  const uid=await authenticate(req,res);if(!uid)return;const id=String(req.params.id);if(!watchId(id))return res.status(400).json({error:'Invalid Code ID'});
  try{const saved=await deps.store.get('users/'+uid+'/codeWatches/'+id);if(!saved)return res.json({id,running:false,verified:true,events:[],state:'not-deployed'});return res.json({id,...await call(uid,id,'status')})}
  catch(e){return res.status(503).json({error:e instanceof Error?e.message:'Code watch status unavailable',verified:false})}
 });
 app.post('/api/code-watches/:id',async(req,res)=>{
  const uid=await authenticate(req,res);if(!uid)return;const id=String(req.params.id),action=req.body?.action;
  if(!watchId(id)||!['start','stop'].includes(action))return res.status(400).json({error:'Invalid Code monitor request'});
  try{
   const path='users/'+uid+'/codeWatches/'+id;
   if(action==='stop'){
    const saved=await deps.store.get(path);if(!saved)return res.status(404).json({error:'No saved Code watcher was found.'});
    await deps.outputs?.stop(uid,id);
    const state=await call(uid,id,'stop');
    await deps.store.put(path,{...saved,running:false,lastVerifiedAt:Date.now()});
    return res.json({id,...state});
   }
   if(req.body?.confirm!=='START CODE WATCH')return res.status(400).json({error:'Explicit monitor authorization required.'});
   const asset=await deps.store.get('users/'+uid+'/codeAnalyses/'+id);
   if(!asset||!['liquidity_sweeps','volatility_profile'].includes(asset.kind)||!['m1','m5','m15','h1'].includes(asset.timeframe)||!['propdao','hyperliquid'].includes(asset.venue)||!coins[String(asset.asset||'').toUpperCase()])return res.status(400).json({error:'Only saved, validated PropDAO/Hyperliquid Code analysis tools can run continuously.'});
   const records=await deps.store.query('users/'+uid+'/codeWatches');
   if(!records.some(r=>r.id===id)&&records.length>=10)return res.status(409).json({error:'Maximum of ten Code monitors per account.'});
   const watch={uid,id,kind:asset.kind,asset:asset.asset,timeframe:asset.timeframe,coin:coins[String(asset.asset).toUpperCase()],lookback:Math.max(3,Math.min(25,Number(asset.lookback)||5))};
   const output=watchOutputSchema.safeParse(req.body?.output??{type:'log'});
   if(!output.success)return res.status(400).json({error:'Choose a valid monitor output and destination.'});
   if(output.data.type!=='log'&&(req.body?.outputConfirm!=='AUTHORIZE MONITOR OUTPUT'||!deps.outputs||env.CODE_WATCH_OUTPUTS_ENABLED!=='true'))return res.status(503).json({error:'Recurring AI and connected-app monitor outputs are unavailable or unconfirmed.'});
   if(!config())throw Error('Code monitoring runtime is not enabled. No watch has been started.');
   const outputVersion=await deps.outputs?.start(uid,id,watch.asset,watch.timeframe,output.data);
   const state=await call(uid,id,'start',{...watch,emitOutput:output.data.type!=='log',outputVersion}).catch(async error=>{await deps.outputs?.stop(uid,id).catch(()=>{});throw error;});
   if(!state.running||output.data.type!=='log'&&!state.outputReady){
    await deps.outputs?.stop(uid,id).catch(()=>undefined);
    await call(uid,id,'stop').catch(()=>undefined);
    throw Error('Code monitor did not confirm the requested runtime and output.');
   }
   try{await deps.store.put(path,{id,name:asset.name,asset:asset.asset,kind:asset.kind,createdAt:Date.now(),lastVerifiedAt:Date.now()})}
   catch{ // Authorization succeeded but storing the pointer failed; revoke the monitor.
    await deps.outputs?.stop(uid,id).catch(()=>undefined);
    await call(uid,id,'stop').catch(()=>undefined);
    throw Error('Code watcher registration failed. Stop requested; verify status before trying again.');
   }
   return res.json({id,...state});
  }catch(e){return res.status(503).json({error:e instanceof Error?e.message:'Code watcher unavailable',verified:false})}
 });
}
