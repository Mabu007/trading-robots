import type {Express,Request,Response} from 'express';
import {Composio} from '@composio/core';
import {VercelProvider} from '@composio/vercel';
export const connectedAppToolkits=['telegram','github','googledrive','googlesheets','gmail','notion','discord'] as const;
export type ConnectedAppToolkit=typeof connectedAppToolkits[number];
export function isConnectedAppToolkit(value:unknown):value is ConnectedAppToolkit{return typeof value==='string'&&(connectedAppToolkits as readonly string[]).includes(value);}
export const composioIdentity=(uid:string)=>'trading-vibes:'+uid;
function client(){
 const apiKey=process.env.COMPOSIO_API_KEY?.trim();
 return apiKey?new Composio({apiKey,provider:new VercelProvider()}):null;
}
const session=(c:Composio<VercelProvider>,uid:string)=>c.create(composioIdentity(uid),{toolkits:{enable:[...connectedAppToolkits]},multiAccount:{enable:true}});
export function registerComposioApps(app:Express,uidOrReply:(req:Request,res:Response)=>Promise<string|null>){
 app.get('/api/apps/catalog',async(req,res)=>{
   const uid=await uidOrReply(req,res);if(!uid)return;
   res.json({apps:connectedAppToolkits.map(slug=>({slug,provider:'composio',category:'connected-app'})),configured:Boolean(process.env.COMPOSIO_API_KEY?.trim())});
 });
 app.get('/api/apps/connections',async(req,res)=>{
   const uid=await uidOrReply(req,res);if(!uid)return;
   const c=client();if(!c)return res.status(503).json({error:'Composio is not configured.'});
   try {
     const s=await session(c,uid);
     const data=await s.toolkits({limit:20});
     return res.json({apps:data.items.filter(x=>isConnectedAppToolkit(x.slug)).map(x=>({slug:x.slug,name:x.name,connected:x.connection?.isActive===true,connectedAccountId:x.connection?.connectedAccount?.id??null}))});
   }catch(e){console.error('Composio connection lookup failed',e instanceof Error?e.name:'unknown');return res.status(502).json({error:'Could not check connected apps.'});}
 });
 app.post('/api/apps/connect',async(req,res)=>{
   const uid=await uidOrReply(req,res);if(!uid)return;
   const toolkit=req.body?.toolkit;
   if(!isConnectedAppToolkit(toolkit))return res.status(400).json({error:'Choose an approved connected app.'});
   const c=client();if(!c)return res.status(503).json({error:'Composio is not configured.'});
   try {
     const s=await session(c,uid);
     const base=process.env.APP_URL||'https://trading-robots.vercel.app';
     const callbackUrl=/^https:\/\//.test(base)?new URL('/?tvApps=connected',base).toString():undefined;
     const auth=await s.authorize(toolkit,callbackUrl?{callbackUrl}:{});
     if(typeof auth.redirectUrl!=='string'||!/^https:\/\//.test(auth.redirectUrl))throw Error('Invalid Composio redirect');
     return res.json({toolkit,redirectUrl:auth.redirectUrl});
   }catch(e){console.error('Composio connection failed',e instanceof Error?e.name:'unknown');return res.status(502).json({error:'Could not begin connected-app authorization.'});}
 });
}
