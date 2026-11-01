import type {Express,Request,Response} from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {FirestoreStore,recordId,type RecordStore} from './firestore-store.ts';
import {verifiedRevenue,type Payment} from '../shared/trading.ts';
export const accessId=(botId:string,uid:string)=>`${botId}_${recordId(uid)}`;
export class Marketplace {
  readonly store:RecordStore;
  constructor(store:RecordStore,_unused?:unknown){this.store=store;}
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
  async unpublish(uid:string,id:string){
    const bot=await this.store.get(`marketplaceBots/${id}`);if(!bot)return;
    await this.owned(uid,id);await this.store.put(`marketplaceBots/${id}`,{...bot,published:false,publicCreatorId:'',updatedAt:Date.now()});
  }
}
export const marketplace=new Marketplace(new FirestoreStore());
type Dependencies={uid:(req:Request,res:Response)=>Promise<string|null>;read:(key:string)=>Promise<string|null>;write:(key:string,body:string)=>Promise<void>;root:(uid:string,id:string)=>string};
export function marketplaceRoutes(app:Express,deps:Dependencies,service=marketplace){
 const route=(method:'get'|'post',path:string,handler:(uid:string,req:Request)=>Promise<any>)=>app[method](path,async(req,res)=>{const uid=await deps.uid(req,res);if(!uid)return;res.setHeader('Cache-Control','private, no-store');try{if(!FirestoreStore.configured()&&service===marketplace)return res.status(503).json({error:'Marketplace server credentials are not configured yet.'});res.json(await handler(uid,req));}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Marketplace request failed.'})}});
 route('get','/api/marketplace/creator',async uid=>{const [bots,transactions]=await Promise.all([service.store.query('marketplaceBots','creatorId',uid),service.store.query('marketplaceTransactions','creatorId',uid)]);const revenue=verifiedRevenue(transactions.filter(t=>t.currency==='ZAR') as Payment[]);return {bots,revenue};});
 route('post','/api/marketplace/drafts/:id/register',async(uid,req)=>{
  const privateId=String(req.params.id);if(!/^[A-Za-z0-9_-]{1,100}$/.test(privateId))throw Error('Invalid private robot ID');const bot=await service.store.get(`users/${uid}/bots/${privateId}`);if(!bot)throw Error('Save your robot before publishing.');
  const pointerKey=`${deps.root(uid,privateId)}/publication.json`,pointer=await deps.read(pointerKey),id=pointer?JSON.parse(pointer).id:randomUUID();if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid publication pointer');
  const existing=await service.store.get(`marketplaceBots/${id}`);if(existing&&existing.creatorId!==uid)throw Error('Creator ownership mismatch');
  if(!pointer)await deps.write(pointerKey,JSON.stringify({id}));if(!existing)await service.store.put(`marketplaceBots/${id}`,{id,privateBotId:privateId,creatorId:uid,name:bot.name,asset:bot.asset,description:bot.prompt,access:'free',published:false,createdAt:Date.now()});return {id};
 });
}
