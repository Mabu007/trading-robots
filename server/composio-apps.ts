import type {Express,Request,Response} from 'express';
import {createHash} from 'node:crypto';
import {tool} from 'ai';
import {z} from 'zod';
import {Composio} from '@composio/core';
import {VercelProvider} from '@composio/vercel';
import {ApprovalIntents} from './approval-intents.ts';
import type {RecordStore} from './firestore-store.ts';
import {FirestoreStore} from './firestore-store.ts';

export const connectedAppToolkits=['telegram','github','googledrive','googlesheets','gmail','notion','discord'] as const;
const blockedToolkits=/^(?:propdao|ctrader|valr|hyperliquid|coinbase|binance|kraken|alpaca|interactivebrokers|tradingview|composio(?:_[a-z0-9_]+)?|webhook|http|http_request|codeinterpreter|code_interpreter|shell|bash|terminal)$/;
export function isConnectedAppToolkit(value:unknown):boolean{
 return typeof value==='string'&&/^[a-z][a-z0-9_-]{1,79}$/.test(value)&&!blockedToolkits.test(value);
}
export const composioIdentity=(uid:string)=>'trading-vibes:'+uid;
let sdk:Composio<VercelProvider>|null=null;
function client(){
 const apiKey=process.env.COMPOSIO_API_KEY?.trim();
 if(!apiKey)return null;
 return sdk??=new Composio({apiKey,provider:new VercelProvider()});
}
class CatalogueHttpError extends Error{
 readonly status:number;
 constructor(status:number){super('Composio catalogue HTTP '+status);this.status=status;}
}
async function composioGet(resource:'toolkits'|'connected_accounts',params:URLSearchParams,signal?:AbortSignal):Promise<unknown>{
 const apiKey=process.env.COMPOSIO_API_KEY?.trim();
 if(!apiKey)throw Error('Composio is not configured.');
 const url=new URL('/api/v3/'+resource,'https://backend.composio.dev');
 url.search=params.toString();
 const response=await fetch(url,{headers:{'x-api-key':apiKey,Accept:'application/json'},signal:opts(signal).signal,redirect:'error'});
 if(!response.ok)throw new CatalogueHttpError(response.status);
 return response.json();
}
const diagnostic=(error:unknown)=>{
 const status=error instanceof CatalogueHttpError?error.status:undefined;
 return status===401||status===403?'Composio rejected the project connection. Check the project API key and permissions.':status===429?'Composio is rate limiting requests. Try again shortly.':'The Composio provider could not return this data.';
};
type Client=NonNullable<ReturnType<typeof client>>;
const toolSlug=z.string().regex(/^[A-Z][A-Z0-9_]{2,119}$/);
const accountId=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const sensitiveKey=/^(?:api[_-]?key|password|secret|(?:access|refresh|auth)[_-]?token|token|authorization|cookie|credentials?|private[_-]?key)$/i;
const barredAction=/(?:^|_)(?:(?:PLACE|SUBMIT|EXECUTE|CANCEL|MODIFY|CLOSE|CREATE)_(?:TRADE|ORDERS?|POSITIONS?)|WITHDRAW|TRANSFER_FUNDS|SEND_MONEY|SEND_PAYMENT|PAY_INVOICE|CREATE_CHARGE|CREATE_PAYMENT|CAPTURE_PAYMENT|ISSUE_REFUND|MAKE_PURCHASE|BUY_CRYPTO|SELL_CRYPTO|EXECUTE_CODE|RUN_CODE|RUN_COMMAND|HTTP_REQUEST|PROXY_REQUEST|RAW_REQUEST|API_REQUEST|GRAPHQL_MUTATION)(?:_|$)/;
const readActions=new Set(['GITHUB_GET_REPOSITORY','GITHUB_LIST_REPOSITORIES','GITHUB_GET_AN_ISSUE','GITHUB_LIST_REPOSITORY_ISSUES','GITHUB_GET_FILE_CONTENTS','GMAIL_FETCH_EMAILS','GMAIL_GET_MESSAGE','GOOGLEDRIVE_LIST_FILES','GOOGLEDRIVE_GET_FILE','GOOGLESHEETS_GET_SPREADSHEET','GOOGLESHEETS_GET_VALUES','NOTION_FETCH_DATA','NOTION_LIST_ALL_USERS','NOTION_GET_PAGE']);
function safeAction(slug:string){return toolSlug.safeParse(slug).success&&!barredAction.test(slug)}
export const requiresAppReview=(slug:string)=>!readActions.has(slug);
const opts=(signal?:AbortSignal)=>({signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12_000)]):AbortSignal.timeout(12_000)});
function jsonArgs(value:Record<string,unknown>){
 const raw=JSON.stringify(value,(key,item)=>{if(sensitiveKey.test(key))throw Error('Connection credentials must be entered through Apps.');return item});
 if(raw.length>8_000)throw Error('App action arguments are too large.');
 return raw;
}
function preview(value:unknown){
 const clean=JSON.stringify(value,(key,item)=>sensitiveKey.test(key)?undefined:item)??'null';
 return {content:clean.slice(0,9_000),truncated:clean.length>9_000};
}
async function activeAccounts(c:Client,uid:string,toolkit?:string,signal?:AbortSignal){
 try{
  const result=await c.connectedAccounts.list({userIds:[composioIdentity(uid)],statuses:['ACTIVE'],limit:100,...(toolkit?{toolkitSlugs:[toolkit]}:{})},opts(signal));
  return result.items.filter(a=>a.status==='ACTIVE'&&!a.isDisabled&&!a.authConfig.isDisabled&&isConnectedAppToolkit(a.toolkit.slug)&&accountId.safeParse(a.id).success)
   .map(a=>({id:a.id,toolkit:a.toolkit.slug,label:a.alias||a.id,connected:true}));
 }catch{
  const query=new URLSearchParams({user_ids:composioIdentity(uid),statuses:'ACTIVE',limit:'100'});
  if(toolkit)query.set('toolkit_slugs',toolkit);
  const page=z.object({items:z.array(z.object({id:z.string(),user_id:z.string().optional(),status:z.string(),is_disabled:z.boolean().optional(),alias:z.string().nullish(),auth_config:z.object({is_disabled:z.boolean().optional()}),toolkit:z.object({slug:z.string()})}))}).parse(await composioGet('connected_accounts',query,signal));
  return page.items.filter(a=>(a.user_id===undefined||a.user_id===composioIdentity(uid))&&a.status==='ACTIVE'&&!a.is_disabled&&!a.auth_config.is_disabled&&isConnectedAppToolkit(a.toolkit.slug)&&accountId.safeParse(a.id).success)
   .map(a=>({id:a.id,toolkit:a.toolkit.slug,label:a.alias||a.id,connected:true}));
 }
}

type Pending={id:string;ownerUid:string;toolkit:string;slug:string;account:string;args:string;version:string;schemaHash:string;expiresAt:number};
const pendingPath=(uid:string,id:string)=>'serverConnectedAppActions/'+createHash('sha256').update(uid+'\0'+id).digest('hex');
function actionFingerprint(p:Omit<Pending,'id'|'expiresAt'|'ownerUid'>){
 return {operation:'app.execute',venue:'composio',connectionId:p.account,accountId:p.account,instrument:p.toolkit,
  strategyId:'connected-app',strategyVersion:createHash('sha256').update(p.args).digest('hex'),
  parameters:{slug:p.slug,version:p.version,schemaHash:p.schemaHash},riskContext:{scope:'external-app'}};
}
async function ownedApp(c:Client,uid:string,id:string,toolkit:string,signal?:AbortSignal){
 const found=(await activeAccounts(c,uid,toolkit,signal)).find(account=>account.id===id&&account.toolkit===toolkit);
 if(!found)throw Error('Connect or reselect an active app account that belongs to you.');
 return found;
}
async function availableAction(c:Client,slug:string,signal?:AbortSignal,version?:string){
 if(!safeAction(slug))throw Error('This operation is unavailable through connected apps.');
 const detail=await c.tools.getRawComposioToolBySlug(slug,version?{version}:{},opts(signal));
 if(detail.slug!==slug||detail.isDeprecated||!isConnectedAppToolkit(detail.toolkit?.slug))throw Error('This app action is unavailable.');
 return {toolkit:detail.toolkit!.slug,version:detail.version||'latest',schemaHash:createHash('sha256').update(JSON.stringify(detail.inputParameters??{})).digest('hex'),detail};
}
async function execute(c:Client,uid:string,p:{slug:string;args:string;account:string;version:string},signal?:AbortSignal){
 const result=await c.tools.execute(p.slug,{userId:composioIdentity(uid),connectedAccountId:p.account,arguments:JSON.parse(p.args),version:p.version},opts(signal));
 if(!result.successful)return {available:false,source:'Composio',action:p.slug,reason:'The external service did not confirm this action.'};
 return {available:true,source:'Composio',action:p.slug,executedAt:new Date().toISOString(),...preview(result.data)};
}

export function connectedAppTools(uid:string,store:RecordStore,signal:AbortSignal){
 const c=client();
 if(!c)return {};
 const proposeOrRead=async({slug,account,args}:{slug:string;account:string;args:Record<string,unknown>})=>{
  try{
   const spec=await availableAction(c,slug,signal);
   const connection=await ownedApp(c,uid,account,spec.toolkit,signal);
   const payload={toolkit:spec.toolkit,slug,account,args:jsonArgs(args),version:spec.version,schemaHash:spec.schemaHash};
   if(!requiresAppReview(slug))return await execute(c,uid,payload,signal);
   if(!FirestoreStore.configured())throw Error('Server approval storage is unavailable.');
   signal.throwIfAborted();
   const approvals=new ApprovalIntents(store);
   const intent=await approvals.create(uid,actionFingerprint(payload),300_000);
   const pending={...payload,id:intent.id,ownerUid:uid,expiresAt:intent.expiresAt};
   try{if(!await store.create(pendingPath(uid,intent.id),pending))throw Error('Could not save the app review.');}
   catch(error){await approvals.deny(uid,intent.id).catch(()=>{});throw error;}
   return {available:true,requiresApproval:true,approvalId:intent.id,expiresAt:intent.expiresAt,toolkit:payload.toolkit,action:slug,account:connection.label,arguments:payload.args,
    note:'Waiting for user review. The action has not executed.'};
  }catch(error){return {available:false,reason:error instanceof Error&&/^(Connect|This|App action|Connection credentials|Server approval)/.test(error.message)?error.message:'The connected app is unavailable or did not accept the request.'}}
 };
 return {
  discoverConnectedAppActions:tool({description:'Find relevant actions and exact account IDs for the signed-in user’s connected apps. Search for the specific task and toolkit. App reads or writes require an actual connected account.',inputSchema:z.object({query:z.string().min(2).max(150),toolkit:z.string().max(80).optional()}),execute:async({query,toolkit})=>{
   try{
    if(toolkit&&!isConnectedAppToolkit(toolkit))return {available:false,reason:'This toolkit is unavailable.'};
    const accounts=await activeAccounts(c,uid,toolkit,signal);
    if(!accounts.length)return {available:false,reason:'No matching app is connected. Open Apps to connect the service.'};
    const toolkits=[...new Set(accounts.map(a=>a.toolkit))].slice(0,12);
    const actions=await c.tools.getRawComposioTools({toolkits,search:query,limit:8},undefined,opts(signal));
    return {available:true,accounts,actions:actions.filter(a=>a.toolkit&&toolkits.includes(a.toolkit.slug)&&safeAction(a.slug)&&!a.isDeprecated).slice(0,6).map(a=>({
     slug:a.slug,toolkit:a.toolkit!.slug,description:a.description?.slice(0,360),parameters:a.inputParameters,requiresApproval:requiresAppReview(a.slug)
    }))};
   }catch{return {available:false,reason:'Connected app discovery is temporarily unavailable.'}}
  }}),
  requestConnectedAppAction:tool({description:'Read with a known read-only app action or stage an exact user review for any other external action. Call discovery first for the action schema and owned account. Never claim a staged action ran. Use only data the user explicitly requested to read or send.',inputSchema:z.object({slug:toolSlug,account:accountId,args:z.record(z.string(),z.unknown())}).strict(),execute:proposeOrRead})
 };
}

export async function telegramWatchOutput(uid:string,account:string,destination:string,text:string){
 const c=client();if(!c)throw Error('Composio is not configured.');
 const spec=await availableAction(c,'TELEGRAM_SEND_MESSAGE');
 if(spec.toolkit!=='telegram')throw Error('Telegram action is unavailable.');
 await ownedApp(c,uid,account,'telegram');
 return execute(c,uid,{slug:'TELEGRAM_SEND_MESSAGE',account,version:spec.version,args:jsonArgs({chat_id:destination,text})});
}
export async function validateTelegramWatchAccount(uid:string,account:string){
 const c=client();if(!c)throw Error('Connect Telegram in Apps.');
 await ownedApp(c,uid,account,'telegram');
}

export function registerComposioApps(app:Express,uidOrReply:(req:Request,res:Response)=>Promise<string|null>,store:RecordStore){
 app.get('/api/apps/catalog',async(req,res)=>{
  const uid=await uidOrReply(req,res);if(!uid)return;
  const c=client();
  const map=(slug:string,name?:string)=>({slug,name,provider:'composio',category:'connected-app'});
  if(!c)return res.json({apps:connectedAppToolkits.map(slug=>map(slug)),configured:false,nextCursor:null});
  const search=typeof req.query.search==='string'?req.query.search.trim():'';
  const cursor=typeof req.query.cursor==='string'?req.query.cursor:'';
  if(search.length>80||cursor.length>512)return res.status(400).json({error:'Choose an app name or catalogue page.'});
  try{
   const params=new URLSearchParams({limit:search?'30':'80',sort_by:'usage'});
   if(search)params.set('search',search);
   if(cursor)params.set('cursor',cursor);
   const page=z.object({items:z.array(z.object({slug:z.string(),name:z.string(),no_auth:z.boolean().optional(),is_local_toolkit:z.boolean().optional()})),next_cursor:z.string().nullish()}).parse(await composioGet('toolkits',params));
   const apps=page.items.filter(item=>isConnectedAppToolkit(item.slug)&&!item.no_auth&&!item.is_local_toolkit).map(item=>map(item.slug,item.name));
   return res.json({apps:cursor||search?apps:[...new Map([...connectedAppToolkits.map(slug=>map(slug)),...apps].map(a=>[a.slug,a])).values()],configured:true,nextCursor:page.next_cursor??null});
  }catch(error){
   console.warn('Composio catalogue unavailable',{status:error instanceof CatalogueHttpError?error.status:null,name:error instanceof Error?error.name:'unknown'});
   if(search||cursor)return res.status(503).json({error:diagnostic(error)});
   return res.json({apps:connectedAppToolkits.map(slug=>map(slug)),configured:true,nextCursor:null,warning:diagnostic(error)});
  }
 });
 app.get('/api/apps/connections',async(req,res)=>{
  const uid=await uidOrReply(req,res);if(!uid)return;
  const c=client();if(!c)return res.status(503).json({error:'Composio is not configured.'});
  try{
   const accounts=await activeAccounts(c,uid);
   return res.json({apps:accounts.map(a=>({slug:a.toolkit,name:a.label,connected:true,connectedAccountId:a.id}))});
  }catch(e){console.error('Composio connection lookup failed',e instanceof Error?e.name:'unknown');return res.status(502).json({error:diagnostic(e)});}
 });
 app.post('/api/apps/connect',async(req,res)=>{
  const uid=await uidOrReply(req,res);if(!uid)return;
  const toolkit=req.body?.toolkit;
  if(typeof toolkit!=='string'||!isConnectedAppToolkit(toolkit))return res.status(400).json({error:'Choose an available connected app.'});
  const c=client();if(!c)return res.status(503).json({error:'Composio is not configured.'});
  try{
   const session=await c.create(composioIdentity(uid),{toolkits:{enable:[toolkit]},multiAccount:{enable:true}});
   const base=process.env.APP_URL||'https://trading-robots.vercel.app';
   const callbackUrl=new URL('/?tvApps=connected',base).toString();
   const auth=await session.authorize(toolkit,{callbackUrl});
   if(typeof auth.redirectUrl!=='string'||new URL(auth.redirectUrl).protocol!=='https:')throw Error('Invalid Composio redirect');
   return res.json({toolkit,redirectUrl:auth.redirectUrl});
  }catch(e){console.error('Composio connection failed',e instanceof Error?e.name:'unknown');return res.status(502).json({error:'Could not begin app authorization. The app may require an auth configuration or provider access.'});}
 });
 for(const decision of ['approve','deny'] as const)app.post('/api/apps/actions/:id/'+decision,async(req,res)=>{
  const uid=await uidOrReply(req,res);if(!uid)return;
  const id=String(req.params.id||'');
  if(!/^[a-f0-9]{32}$/.test(id))return res.status(400).json({error:'Invalid app review.'});
  const c=client();if(!c||!FirestoreStore.configured())return res.status(503).json({error:'Connected app actions are unavailable.'});
  let consumed=false;
  try{
   const p=await store.get(pendingPath(uid,id)) as Pending|null;
   if(!p||p.ownerUid!==uid||p.id!==id||!Number.isFinite(p.expiresAt)||Date.now()>=p.expiresAt)throw Error('Missing or expired app review.');
   const approvals=new ApprovalIntents(store);
   if(decision==='deny'){await approvals.deny(uid,id);return res.json({denied:true});}
   const current=await availableAction(c,p.slug,undefined,p.version);
   if(current.toolkit!==p.toolkit||current.version!==p.version||current.schemaHash!==p.schemaHash)throw Error('The app action version or provider changed.');
   await ownedApp(c,uid,p.account,p.toolkit);
   const action=actionFingerprint(p);
   await approvals.approve(uid,id,action);
   await approvals.consume(uid,id,action);
   consumed=true;
   return res.json(await execute(c,uid,p));
  }catch{
   return res.status(consumed?502:409).json({error:consumed?'Execution was not confirmed. Check the destination before requesting a new action.':'The action was unavailable, expired, changed, or already decided. No new execution was started.'});
  }
 });
}
