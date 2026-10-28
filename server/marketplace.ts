import type { Express,Request,Response } from 'express';
import { createHash,randomUUID } from 'node:crypto';
import { DEFAULT_RISK,riskLimits,verifiedRevenue,TF_SECONDS,type Payment } from '../shared/trading.ts';
import { FirestoreStore,recordId,type RecordStore,type RecordData } from './firestore-store.ts';
export const accessId=(botId:string,uid:string)=>`${botId}_${recordId(uid)}`;
export class Marketplace {
  readonly store:RecordStore;private runtime:(path:string,body?:unknown)=>Promise<any>;
  constructor(store:RecordStore,runtime:(path:string,body?:unknown)=>Promise<any>){this.store=store;this.runtime=runtime;}
  async publish(publication:any){
    const current=await this.store.get(`marketplaceBots/${publication.id}`);
    if(current&&current.creatorId!==publication.ownerUid)throw Error('Creator ownership mismatch');
    await this.store.put(`marketplaceBots/${publication.id}`,{...current,id:publication.id,privateBotId:publication.botId,creatorId:publication.ownerUid,name:publication.name,creator:publication.creator||'Bot creator',description:publication.description,asset:publication.asset,timeframe:publication.timeframe,access:publication.access,priceMinor:publication.priceMinor||0,currency:publication.currency||'ZAR',published:publication.published,updatedAt:Date.now(),createdAt:current?.createdAt||Date.now()});
    await this.store.create(`creatorProfiles/${recordId(publication.ownerUid)}`,{uid:publication.ownerUid,createdAt:Date.now()});
  }
  async owned(uid:string,botId:string){const bot=await this.store.get(`marketplaceBots/${botId}`);if(!bot||bot.creatorId!==uid)throw Error('You do not own this published bot.');return bot;}
  async acquire(uid:string,botId:string){
    const bot=await this.store.get(`marketplaceBots/${botId}`),member=await this.store.get(`botMembers/${accessId(botId,uid)}`);const invited=member?.status==='active'&&member.accessType!=='public_join'&&(!member.expiresAt||member.expiresAt>Date.now());if(!bot||!bot.published&&bot.creatorId!==uid&&!invited)throw Error('This bot is unavailable.');
    const key=accessId(botId,uid),existing=await this.store.get(`entitlements/${key}`);
    if(existing?.status==='active')return existing;
    if(existing)throw Error('Access has been revoked. Contact support.');
    if(bot.access!=='free'&&bot.creatorId!==uid)throw Error('Paid checkout is coming soon. Access requires verified payment.');
    const entitlement={id:key,botId,uid,creatorId:bot.creatorId,type:bot.creatorId===uid?'owner':'free',status:'active',createdAt:Date.now()};
    await this.store.create(`entitlements/${key}`,entitlement);
    if(entitlement.type==='free')await this.store.create(`marketplaceEvents/acquired_${key}`,{id:`acquired_${key}`,type:'acquisition',botId,creatorId:bot.creatorId,createdAt:Date.now()});
    return entitlement;
  }
  async view(bot:any,visitorKey:string){if(!await this.store.get(`marketplaceBots/${bot.id}`))await this.publish(bot);const day=new Date().toISOString().slice(0,10),id=createHash('sha256').update(`${bot.id}:${visitorKey}:${day}`).digest('hex');await this.store.create(`marketplaceEvents/view_${id}`,{id,type:'view',botId:bot.id,creatorId:bot.ownerUid,createdAt:Date.now()});}
  async deployment(uid:string,id:string,action:string,body:any={}){
    const bot=await this.owned(uid,id),path=`deployments/${id}`,previous=await this.store.get(path);
    // Record a possible deployment before contacting the runtime. If the response
    // or a later write fails, editors must still verify the durable object's state.
    if(['deploy','update','start','resume'].includes(action))await this.store.put(path,{...previous,id,botId:id,creatorId:uid,requestedAction:action,attemptedAt:Date.now(),provisional:true});
    const status=await this.runtime(`/bots/${id}/${action}`,{...body,botId:id,ownerUid:uid});
    if(['deploy','update'].includes(action))await this.store.create(`deploymentReleases/${randomUUID()}`,{botId:id,creatorId:uid,sourceVersionId:body.sourceVersionId||null,version:body.version,intervalMinutes:body.intervalMinutes,createdAt:Date.now()});
    if(['deploy','update'].includes(action))await this.store.create(`botVersions/${id}_${body.version}`,{botId:id,creatorId:uid,version:body.version,codeKey:`runtime-code/${id}/${body.version}.js`,strategy:body.strategy,createdAt:Date.now()});
    await this.store.put(path,{...previous,id,botId:id,creatorId:uid,sourceVersionId:['deploy','update'].includes(action)?body.sourceVersionId||null:previous?.sourceVersionId||null,previousVersion:['deploy','update'].includes(action)?previous?.version||null:previous?.previousVersion||null,requestedAction:action,version:status.version||body.version||previous?.version||'',updatedAt:Date.now(),observed:status,provisional:false});
    await this.store.create(`resourceUsage/${randomUUID()}`,{uid,kind:'deployment',botId:id,action,plan:'free_test',billingStatus:'unbilled',createdAt:Date.now()});
    await this.store.create(`auditLogs/${randomUUID()}`,{uid,botId:id,action:`deployment.${action}`,createdAt:Date.now()});return {...status,name:bot.name};
  }
  async deploymentStatus(uid:string,id:string){
    const bot=await this.owned(uid,id),status=await this.runtime(`/bots/${id}/status`),deployment=await this.store.get(`deployments/${id}`);
    return {...status,privateBotId:bot.privateBotId,sourceVersionId:deployment?.sourceVersionId||null};
  }
  async readiness(uid:string,id:string,gateway:(action:string,body?:any)=>Promise<any>,gatewayHealth?:()=>Promise<any>){
    const bot=await this.owned(uid,id),broker=await this.store.get(`brokerConnections/${recordId(uid)}`),sub=await this.store.get(`botSubscribers/${accessId(id,uid)}`),deployment=await this.store.get(`deployments/${id}`);
    let runtime:any={available:false,deployed:false,running:false,evaluating:false,error:'Robot runtime is not configured or is unreachable.'};
    let sourceAccountId='',sourceSymbolId='';try{const raw=await this.runtime(`/bots/${id}/status`);({sourceAccountId='',sourceSymbolId='',...runtime}=raw);runtime.available=true}catch{/* A failed probe is unknown, never healthy. */}
    let gatewayState:any=null,accountVerified=false,mappingVerified=false;
    if(gatewayHealth)try{gatewayState=await gatewayHealth()}catch{/* A failed probe is unknown, never healthy. */}
    if(broker?.connected&&broker.accountId&&broker.environment==='demo')try{
      const symbols=await gateway('symbols',{uid,accountId:broker.accountId});accountVerified=Array.isArray(symbols.symbols);
      mappingVerified=accountVerified&&symbols.symbols.some((s:any)=>s.enabled&&String(s.symbolId)===String(broker.mappings?.[bot.asset]||''));
      if(gatewayHealth)try{gatewayState=await gatewayHealth()}catch{gatewayState=null}
    }catch{/* Token, account authorization or gateway is unavailable. */}
    const connection={connected:Boolean(broker?.connected),environment:broker?.environment||null,broker:broker?.broker||null,accountSuffix:broker?.accountId?String(broker.accountId).slice(-4):null,permission:Boolean(broker?.tradingPermission),accountVerified,mappingVerified,sourceMatches:Boolean(sourceAccountId&&sourceSymbolId&&String(broker?.accountId)===String(sourceAccountId)&&String(broker?.mappings?.[runtime.asset||bot.asset])===String(sourceSymbolId)),emergencyPaused:Boolean(broker?.emergencyPaused),gatewayAvailable:Boolean(gatewayState),gatewayConnected:gatewayState?.demoConnected===true,gatewayLastMessageAt:gatewayState?.demoLastMessageAt||null,demoExecutionEnabled:gatewayState?.demoExecutionEnabled===true};
    const following=sub?.status==='active'&&sub.accountId===broker?.accountId&&sub.risk?.enabled===true;
    return {bot:{id:bot.id,name:bot.name,asset:bot.asset,privateBotId:bot.privateBotId,published:Boolean(bot.published)},runtime,locked:runtime.available?Boolean(runtime.running):Boolean(deployment),broker:connection,following,live:Boolean(runtime.available&&runtime.running&&runtime.evaluating&&runtime.demoExecutionEnabled===true&&connection.environment==='demo'&&connection.accountVerified&&connection.mappingVerified&&connection.sourceMatches&&connection.permission&&!connection.emergencyPaused&&connection.gatewayConnected&&connection.demoExecutionEnabled&&following),realMoneyEnabled:false,observedAt:Date.now()};
  }
  async brokerCandles(uid:string,id:string,gateway:(action:string,body?:any)=>Promise<any>){
    const bot=await this.owned(uid,id),status=await this.runtime(`/bots/${id}/status`),timeframe=String(status.timeframe||'');
    if(!status.running||!TF_SECONDS[timeframe])throw Error('A running strategy with a supported timeframe is required.');
    const broker=await this.store.get(`brokerConnections/${recordId(uid)}`),symbolId=broker?.mappings?.[status.asset||bot.asset];
    if(!broker?.connected||broker.environment!=='demo'||!broker.accountId||!symbolId)throw Error('Connect a demo account and map the strategy symbol first.');
    if(!status.sourceAccountId||!status.sourceSymbolId||String(broker.accountId)!==String(status.sourceAccountId)||String(symbolId)!==String(status.sourceSymbolId))throw Error('The broker account or symbol changed. Stop and redeploy before displaying this instance’s prices.');
    const to=Date.now(),from=to-TF_SECONDS[timeframe]*1000*1100;
    const result=await gateway('candles',{uid,accountId:broker.accountId,symbolId,timeframe,from,to});if(!Array.isArray(result.candles))throw Error('Broker candles are unavailable.');
    const {validateCandles}=await import('../src/strategy.ts');const candles=validateCandles(result.candles.slice(-1000));
    return {candles,timeframe,source:'cTrader broker',observedAt:Date.now()};
  }
  async unpublish(uid:string,id:string){
    const exists=await this.store.get(`marketplaceBots/${id}`);if(!exists)return;await this.owned(uid,id);const deployed=await this.store.get(`deployments/${id}`);if(deployed)await this.deployment(uid,id,'stop');
    const subs=await this.store.query('botSubscribers','botId',id);
    for(const sub of subs)await this.store.put(`botSubscribers/${sub.id}`,{...sub,status:'paused',reason:'Creator unpublished this bot',updatedAt:Date.now()});
    const bot=await this.owned(uid,id);await this.store.put(`marketplaceBots/${id}`,{...bot,published:false,publicCreatorId:'',updatedAt:Date.now()});
  }
  private async verifySource(bot:RecordData,health:any){
    const source=await this.store.get(`brokerConnections/${recordId(bot.creatorId)}`);
    if(!source?.connected||source.environment!=='demo'||!health.sourceAccountId||!health.sourceSymbolId||health.asset!==bot.asset||String(source.accountId)!==String(health.sourceAccountId)||String(source.mappings?.[health.asset])!==String(health.sourceSymbolId))throw Error('The strategy broker data source changed or cannot be verified. Stop and redeploy before resuming.');
  }
  async subscribe(uid:string,id:string,input:any){
    if(!['start','resume','pause'].includes(input.action||'start'))throw Error('Invalid subscription action');
    await this.acquire(uid,id);const key=accessId(id,uid),risk=riskLimits(input.risk),broker=await this.store.get(`brokerConnections/${recordId(uid)}`);
    const status=input.action==='pause'?'paused':'active';
    const member=await this.store.get(`botMembers/${key}`);if(status==='active'&&member&&(member.status!=='active'||member.expiresAt&&member.expiresAt<=Date.now()))throw Error('Bot membership is inactive or expired.');
    if(status==='active'){
      if(!risk.enabled||input.approveDemoTrading!==true)throw Error('Explicitly approve demo trading and risk settings.');
      if(!broker?.connected||broker.environment!=='demo'||!broker.accountId||broker.emergencyPaused||!broker.tradingPermission)throw Error('Select an authorized demo broker account with trading permissions first.');
      const health=await this.runtime(`/bots/${id}/status`);if(!health.evaluating)throw Error('The creator’s strategy is not currently evaluating healthy market candles.');await this.verifySource((await this.store.get(`marketplaceBots/${id}`))!,health);
    }
    const previous=await this.store.get(`botSubscribers/${key}`);
    const sub={id:key,botId:id,uid,creatorId:(await this.store.get(`marketplaceBots/${id}`))!.creatorId,accountId:broker?.accountId||'',environment:'demo',status,risk,createdAt:previous?.createdAt||Date.now(),updatedAt:Date.now()};
    await this.store.put(`botSubscribers/${key}`,sub);return sub;
  }
  async eligible(uid:string,id:string,version:string,signalId:string,candleClose:number){
    const [entitlement,sub,bot,broker]=await Promise.all([this.store.get(`entitlements/${accessId(id,uid)}`),this.store.get(`botSubscribers/${accessId(id,uid)}`),this.store.get(`marketplaceBots/${id}`),this.store.get(`brokerConnections/${recordId(uid)}`)]);
    const member=await this.store.get(`botMembers/${accessId(id,uid)}`),invited=member?.status==='active'&&member.accessType!=='public_join'&&(!member.expiresAt||member.expiresAt>Date.now());
    if(!bot||(!bot.published&&bot.creatorId!==uid&&!invited)||entitlement?.status!=='active'||sub?.status!=='active'||!sub.risk?.enabled||!broker?.connected||!broker.tradingPermission||broker.emergencyPaused||broker.environment!=='demo'||sub.accountId!==broker.accountId)throw Error('Subscription, entitlement, or broker permission is inactive.');
    if(member&&(member.status!=='active'||member.expiresAt&&member.expiresAt<=Date.now()))throw Error('Bot membership is inactive or expired.');
    const health=await this.runtime(`/bots/${id}/status`);if(!health.evaluating||health.version!==version||health.lastSignal?.id!==signalId||health.lastCandle!==candleClose)throw Error('Deployment is stopped, stale, or has changed version or candle.');await this.verifySource(bot,health);return {subscription:sub,broker};
  }
  async emergencyPause(uid:string,reason='Customer emergency pause'){
    const broker=await this.store.get(`brokerConnections/${recordId(uid)}`);if(broker)await this.store.put(`brokerConnections/${recordId(uid)}`,{...broker,emergencyPaused:true,updatedAt:Date.now()});
    const subs=await this.store.query('botSubscribers','uid',uid);for(const s of subs)await this.store.put(`botSubscribers/${s.id}`,{...s,status:'paused',reason,updatedAt:Date.now()});
  }
  async creator(uid:string){
    const [bots,deployments,subscribers,events,transactions,drafts]=await Promise.all([this.store.query('marketplaceBots','creatorId',uid),this.store.query('deployments','creatorId',uid),this.store.query('botSubscribers','creatorId',uid),this.store.query('marketplaceEvents','creatorId',uid),this.store.query('marketplaceTransactions','creatorId',uid),this.store.query(`users/${uid}/bots`)]);
    const seenPayments=new Set<string>(),verifiedTransactions=transactions.filter(t=>{if(!verifiedRevenue([t] as Payment[]).paidSales||seenPayments.has(t.providerEventId))return false;seenPayments.add(t.providerEventId);return true});const revenueByCurrency=Object.fromEntries([...new Set(verifiedTransactions.map(t=>t.currency).filter(c=>typeof c==='string'&&/^[A-Z]{3}$/.test(c)))].map(currency=>[currency,verifiedRevenue(verifiedTransactions.filter(t=>t.currency===currency) as Payment[])]));const revenue=revenueByCurrency.ZAR||verifiedRevenue([]);const revenueOverTime:Record<string,Record<string,number>>={},seenRevenue=new Set<string>();for(const t of verifiedTransactions){if(!t.currency||seenRevenue.has(t.providerEventId)||!verifiedRevenue([t] as Payment[]).paidSales)continue;seenRevenue.add(t.providerEventId);const day=new Date(t.verifiedAt).toISOString().slice(0,10);revenueOverTime[t.currency]??={};revenueOverTime[t.currency][day]=(revenueOverTime[t.currency][day]||0)+t.creatorMinor;}
    const growth:Record<string,number>={},views:Record<string,number>={},acquisitions:Record<string,number>={};for(const e of events){if(e.type==='view')views[e.botId]=(views[e.botId]||0)+1;if(e.type==='acquisition'){acquisitions[e.botId]=(acquisitions[e.botId]||0)+1;const date=new Date(e.createdAt).toISOString().slice(0,10);growth[date]=(growth[date]||0)+1;}}
    // Creators get aggregates only, never subscriber account IDs, balances, credentials, or fills.
    return {drafts:drafts.filter(d=>!bots.some(b=>b.privateBotId===d.id&&b.published)),bots:bots.map(bot=>({...bot,views:views[bot.id]||0,acquisitions:acquisitions[bot.id]||0,subscribers:subscribers.filter(s=>s.botId===bot.id).length,activeSubscribers:subscribers.filter(s=>s.botId===bot.id&&s.status==='active').length,deployment:deployments.find(d=>d.botId===bot.id)||null})),totalSubscribers:subscribers.length,activeSubscribers:subscribers.filter(s=>s.status==='active').length,freeAcquisitions:events.filter(e=>e.type==='acquisition').length,subscriberGrowth:growth,revenue,revenueByCurrency,revenueOverTime,mostPopularBots:bots.map(b=>({id:b.id,name:b.name,acquisitions:acquisitions[b.id]||0,views:views[b.id]||0})).sort((a,b)=>b.acquisitions-a.acquisitions||b.views-a.views).slice(0,5),currency:'ZAR',paidCheckout:'coming_soon',payouts:'coming_soon'};
  }
  async customer(uid:string){
    const [access,subs,executions,broker,events]=await Promise.all([this.store.query('entitlements','uid',uid),this.store.query('botSubscribers','uid',uid),this.store.query('customerExecutions','uid',uid),this.store.get(`brokerConnections/${recordId(uid)}`),this.store.query('executionEvents','uid',uid)]);
    const bots=await Promise.all(access.map(async e=>({entitlement:e,bot:await this.store.get(`marketplaceBots/${e.botId}`),subscription:subs.find(s=>s.botId===e.botId)||null})));
    const states=await Promise.all(bots.map(async row=>{try{return {...row,runtime:await this.runtime(`/bots/${row.entitlement.botId}/status`)}}catch{return {...row,runtime:{evaluating:false,error:'Scheduler status unavailable'}}}}));
    return {bots:states,broker,events:events.sort((a,b)=>b.observedAt-a.observedAt).slice(0,100),executions:executions.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,100),realMoneyEnabled:false};
  }
}
/** Fail closed when a registered deployment cannot be checked. */
export async function assertProjectEditable(service:Marketplace,read:(key:string)=>Promise<string|null>,root:(uid:string,id:string)=>string,uid:string,privateId:string){
  const raw=await read(`${root(uid,privateId)}/publication.json`);if(!raw)return;
  const pointer=JSON.parse(raw),id=String(pointer.id||'');if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('Robot identity could not be verified.');
  const deployment=await service.store.get(`deployments/${id}`);if(!deployment)return;
  const bot=await service.owned(uid,id);if(bot.privateBotId!==privateId)throw Error('Robot identity could not be verified.');
  let status:any;try{status=await service.deploymentStatus(uid,id)}catch{throw Error('Cannot verify whether this robot is running. Restore the runtime connection before editing, deleting or saving a backtest.');}
  if(status.running)throw Error('This robot is running. Stop it or create a copy before editing, deleting or saving a backtest.');
}
export async function runtimeRequest(path:string,body?:unknown){
  if(!process.env.ROBOT_RUNTIME_URL||!process.env.TRADING_INTERNAL_SECRET)throw Error('Cloudflare robot runtime is not configured.');
  const r=await fetch(new URL(path,process.env.ROBOT_RUNTIME_URL),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${process.env.TRADING_INTERNAL_SECRET}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const d=await r.json() as any;if(!r.ok)throw Error(d.error||'Robot runtime is unavailable.');return d;
}
export const marketplace=new Marketplace(new FirestoreStore(),runtimeRequest);
type Dependencies={uid:(req:Request,res:Response)=>Promise<string|null>;read:(key:string)=>Promise<string|null>;write:(key:string,body:string)=>Promise<void>;root:(uid:string,id:string)=>string;gateway:(path:string,body?:any)=>Promise<any>;gatewayHealth?:()=>Promise<any>;checkLicense?:(uid:string,botId:string,code:string)=>Promise<void>;versionSource?:(uid:string,versionId:string)=>Promise<any>;ensureMember?:(uid:string,botId:string,req:Request)=>Promise<void>};
export function marketplaceRoutes(app:Express,deps:Dependencies,service=marketplace){
  const route=(method:'get'|'post',path:string,handler:(uid:string,req:Request)=>Promise<any>)=>app[method](path,async(req,res)=>{const uid=await deps.uid(req,res);if(!uid)return;res.setHeader('Cache-Control','private, no-store');try{if(req.params.id&&!/^[A-Za-z0-9_-]{1,100}$/.test(String(req.params.id)))throw Error('Invalid robot ID');if(!FirestoreStore.configured()&&service===marketplace&&path!=='/api/marketplace/drafts/:id/readiness')return res.status(503).json({error:'Marketplace server credentials are not configured yet.'});res.json(await handler(uid,req));}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Marketplace request failed.'})}});
  route('get','/api/marketplace/creator',uid=>service.creator(uid));
  route('get','/api/marketplace/customer',uid=>service.customer(uid));
  route('post','/api/marketplace/drafts/:id/register',async(uid,req)=>{
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(String(req.params.id)))throw Error('Invalid private robot ID');const bot=await service.store.get(`users/${uid}/bots/${String(req.params.id)}`);if(!bot)throw Error('Save your robot before deploying.');
    const pointerKey=`${deps.root(uid,String(req.params.id))}/publication.json`,pointer=await deps.read(pointerKey),id=pointer?JSON.parse(pointer).id:randomUUID();if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid publication pointer');
    const existing=await service.store.get(`marketplaceBots/${id}`);if(existing&&existing.creatorId!==uid)throw Error('Creator ownership mismatch');
    if(!pointer)await deps.write(pointerKey,JSON.stringify({id}));if(!existing)await service.store.put(`marketplaceBots/${id}`,{id,privateBotId:String(req.params.id),creatorId:uid,name:bot.name,asset:bot.asset,description:bot.prompt,access:'free',published:false,createdAt:Date.now()});return {id};
  });
  route('get','/api/marketplace/bots/:id/deployment',(uid,req)=>service.deploymentStatus(uid,String(req.params.id)));
  const readiness=async(uid:string,id:string)=>{const state=await service.readiness(uid,id,deps.gateway,deps.gatewayHealth);let strategyTimeframe:string|null=null;try{const raw=await deps.read(`${deps.root(uid,state.bot.privateBotId)}/current.json`),saved=raw?JSON.parse(raw):null;if(saved?.userId===uid&&saved?.botId===state.bot.privateBotId){const {parseStrategyConfig}=await import('../src/strategy.ts');strategyTimeframe=parseStrategyConfig(saved.code).executionTimeframe}}catch{/* A malformed or unsaved strategy is reported during deployment. */}return {...state,strategyTimeframe};};
  route('get','/api/marketplace/bots/:id/readiness',(uid,req)=>readiness(uid,String(req.params.id)));
  route('get','/api/marketplace/drafts/:id/readiness',async(uid,req)=>{
    const privateId=String(req.params.id);if(!/^[A-Za-z0-9_-]{1,100}$/.test(privateId))throw Error('Invalid robot ID');
    const raw=await deps.read(`${deps.root(uid,privateId)}/publication.json`);if(!raw)return {registered:false};
    const pointer=JSON.parse(raw);if(!/^[A-Za-z0-9_-]{1,100}$/.test(String(pointer.id)))throw Error('Invalid robot pointer');
    const bot=await service.owned(uid,pointer.id);if(bot.privateBotId!==privateId)throw Error('Robot pointer does not match this project.');
    return {registered:true,...await readiness(uid,pointer.id)};
  });
  route('get','/api/marketplace/bots/:id/candles',(uid,req)=>service.brokerCandles(uid,String(req.params.id),deps.gateway));
  route('get','/api/marketplace/bots/:id/executions',async(uid,req)=>{const id=String(req.params.id);await service.owned(uid,id);const records=await service.store.query('customerExecutions','uid',uid);return {items:records.filter(r=>r.botId===id).sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0)).slice(0,100).map(r=>({id:r.id,state:r.state,updatedAt:r.updatedAt,action:r.signal?.action||r.order?.action||null,entryPrice:r.order?.entryPrice??null,volume:r.order?.volume??null,error:r.error||null}))};});
  route('post','/api/marketplace/bots/:id/acquire',(uid,req)=>service.acquire(uid,String(req.params.id)));
  route('post','/api/marketplace/bots/:id/subscribe',async(uid,req)=>{if(req.body?.action!=='pause')await deps.ensureMember?.(uid,String(req.params.id),req);return service.subscribe(uid,String(req.params.id),req.body||{});});
  route('post','/api/marketplace/emergency-pause',async uid=>{await service.emergencyPause(uid);return {paused:true,positionsClosed:false}});
  route('post','/api/marketplace/bots/:id/deployment',async(uid,req)=>{
    const bot=await service.owned(uid,String(req.params.id)),action=req.body?.action;
    if(!['deploy','start','stop','resume','update','undeploy'].includes(action))throw Error('Invalid deployment action.');
    let config:any={};
    if(action==='deploy'||action==='update'){
      const saved=await deps.read(`${deps.root(uid,bot.privateBotId)}/current.json`);if(!saved)throw Error('Save your strategy first.');const current=JSON.parse(saved);if(req.body.versionId){if(!deps.versionSource)throw Error('Version deployment unavailable.');const selected=await deps.versionSource(uid,String(req.body.versionId));const metadata=await service.store.get(`sourceVersions/${String(req.body.versionId)}`);if(!metadata||metadata.privateBotId!==bot.privateBotId)throw Error('Select a version from this project.');current.code=selected.code;}if(current.userId!==uid||current.botId!==bot.privateBotId)throw Error('Strategy ownership mismatch');
      await deps.checkLicense?.(uid,bot.privateBotId,current.code);
      const {parseStrategyConfig}=await import('../src/strategy.ts');const strategy=parseStrategyConfig(current.code);
      const broker=await service.store.get(`brokerConnections/${recordId(uid)}`);if(!broker?.connected||broker.environment!=='demo')throw Error('Connect a demo account to supply live evaluation candles.');
      const interval=Number(req.body.intervalMinutes||5),delay=Number(req.body.publicationDelaySeconds??5);if(![1,5,15].includes(interval)||strategy.executionTimeframe!==`m${interval}`||!Number.isInteger(delay)||delay<2||delay>60)throw Error('Use an interval matching the strategy execution timeframe (M1, M5 or M15) and a 2–60 second publication delay.');
      const mapped=broker.mappings?.[bot.asset];if(!mapped)throw Error('Map this asset to an actual broker symbol in your account settings.');
      config={code:current.code,version:createHash('sha256').update(current.code).digest('hex'),strategy,sourceVersionId:req.body.versionId||null,asset:bot.asset,intervalMinutes:interval,publicationDelaySeconds:delay,sourceUid:uid,sourceAccountId:broker.accountId,sourceSymbolId:mapped};
    }
    return service.deployment(uid,String(req.params.id),action,config);
  });
  route('post','/api/marketplace/customer/reconcile',uid=>runtimeRequest(`/accounts/${recordId(uid)}/reconcile`,{uid}));
  route('post','/api/marketplace/customer/manage',async(uid,req)=>{
    if(!['close','cancel','protection'].includes(req.body?.action)||req.body?.confirmed!==true)throw Error('Explicit confirmation is required for broker position changes.');
    const broker=await service.store.get(`brokerConnections/${recordId(uid)}`);if(!broker?.connected||broker.environment!=='demo')throw Error('Select your demo broker account.');
    return runtimeRequest(`/accounts/${recordId(uid)}/manage`,{...req.body,uid,accountId:broker.accountId});
  });
}
