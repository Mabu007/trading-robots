import type { Express, Request, Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { FirestoreStore, recordId, type RecordData, type RecordStore } from './firestore-store.ts';
import { LICENSES, LICENSE_REVISION, type LicenseKind } from '../shared/economy.ts';
import { parseStrategyConfig } from '../src/strategy.ts';
import { validCover } from './shared-bots.ts';
import { accessId, type Marketplace } from './marketplace.ts';
export type Identity={uid:string;email?:string;emailVerified?:boolean;name?:string};
type Storage={read:(key:string)=>Promise<string|null>;write:(key:string,body:string)=>Promise<void>;root:(uid:string,id:string)=>string};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const id=(value:unknown)=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,240}$/.test(value))throw Error('Invalid record ID.');return value;};
const text=(value:unknown,max:number,required=false)=>{if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error(`Text must be ${required?'1':'0'}–${max} characters.`);return value.trim();};
const kind=(value:unknown):LicenseKind=>{if(typeof value!=='string'||!Object.hasOwn(LICENSES,value))throw Error('Choose a source-code license.');return value as LicenseKind;};
const publicProfile=(p:RecordData)=>({uid:p.uid,username:p.username,displayName:p.displayName,bio:p.bio||'',avatar:p.avatar||'',cover:p.cover||'',createdAt:p.createdAt,updatedAt:p.updatedAt});
const publicPackage=(p:RecordData):RecordData=>{const {privateBotId:_,provenance,...view}=p;return {...view,provenance:provenance?{originalCreator:provenance.originalCreator,botId:provenance.botId,versionId:provenance.versionId,license:provenance.license}:null};};
const versionView=(v:RecordData)=>({id:v.id,label:v.label,description:v.description,createdAt:v.createdAt,hash:v.hash,asset:v.asset,timeframes:v.config?.timeframes||[],releaseNotes:v.releaseNotes||''});
export class BotEconomy {
  readonly store:RecordStore;readonly storage:Storage;readonly trading:Marketplace;
  constructor(store:RecordStore,storage:Storage,trading:Marketplace){this.store=store;this.storage=storage;this.trading=trading;}
  async page(collection:string,field?:string,value?:string|boolean,after?:string,limit=30){if(!this.store.page)throw Error('Paginated records are unavailable.');return this.store.page(collection,field,value,after,limit);}
  async count(collection:string,field?:string,value?:string){if(!this.store.count)throw Error('Record counts are unavailable.');return this.store.count(collection,field,value);}
  async atomic(paths:string[],update:(records:(RecordData|null)[])=>Record<string,RecordData>){if(!this.store.transaction)throw Error('Transactional storage is unavailable.');return this.store.transaction(paths,update);}
  async activity(uid:string,type:string,botId='',detail='') {const key=randomUUID();await this.store.create(`botActivity/${key}`,{id:key,uid,type,botId,detail,createdAt:Date.now()});}
  async profile(who:Identity){
    const path=`creatorProfiles/${recordId(who.uid)}`;let p=await this.store.get(path);
    if(!p?.username){
      // Deterministic usernames avoid collisions and require no destructive user migration.
      const username=`creator_${hash(who.uid).slice(0,20)}`,now=Date.now();
      await this.atomic([path,`creatorUsernames/${username}`],([old,claim])=>{
        if(old?.username)return {};
        if(claim&&claim.uid!==who.uid)throw Error('Username is unavailable.');
        return {[path]:{...old,uid:who.uid,username,displayName:who.name||'Bot creator',bio:'',avatar:'',cover:'',createdAt:old?.createdAt||now,updatedAt:now},[`creatorUsernames/${username}`]:{uid:who.uid}};
      });p=await this.store.get(path);
    }
    return publicProfile(p!);
  }
  async editProfile(who:Identity,input:RecordData){
    await this.profile(who);const username=text(input.username,30,true).toLowerCase();
    if(!/^[a-z][a-z0-9_]{2,29}$/.test(username))throw Error('Username: 3–30 letters, numbers or underscores, starting with a letter.');
    const displayName=text(input.displayName,60,true),bio=text(input.bio,400),avatar=input.avatar??'',cover=input.cover??'';
    const previous=await this.store.get(`creatorProfiles/${recordId(who.uid)}`);if(!(avatar===previous?.avatar||validCover(avatar))||!(cover===previous?.cover||validCover(cover)))throw Error('Choose a valid JPG, PNG or WebP under 500 KB.');
    const avatarUrl=avatar===previous?.avatar?avatar:await this.image(avatar),coverUrl=cover===previous?.cover?cover:await this.image(cover);
    const path=`creatorProfiles/${recordId(who.uid)}`,claim=`creatorUsernames/${username}`;
    // Old handles remain reserved to prevent impersonation through a previously shared URL.
    await this.atomic([path,claim],([current,owner])=>{
      if(owner&&owner.uid!==who.uid)throw Error('That username is already taken.');
      return {[claim]:{uid:who.uid},[path]:{...current,uid:who.uid,username,displayName,bio,avatar:avatarUrl,cover:coverUrl,updatedAt:Date.now()}};
    });return this.profile(who);
  }
  async image(data:string){if(!data)return '';if(!validCover(data))throw Error('Invalid image.');const key=hash(data);await this.storage.write(`bot-economy/images/${key}.json`,JSON.stringify({data}));return `/api/economy/images/${key}`;}
  async creator(username:string){
    username=text(username,30,true).toLowerCase();if(!/^[a-z][a-z0-9_]{2,29}$/.test(username))throw Error('Creator unavailable.');const claim=await this.store.get(`creatorUsernames/${username}`);if(!claim)throw Error('Creator unavailable.');
    const p=await this.store.get(`creatorProfiles/${recordId(claim.uid)}`);if(!p?.username)throw Error('Creator unavailable.');
    const [published,followers]=await Promise.all([this.count('marketplaceBots','publicCreatorId',p.uid),this.count('creatorFollows','activeCreatorId',p.uid)]);
    return {...publicProfile(p),published,followers};
  }
  async follow(who:Identity,username:string,following:boolean){
    const p=await this.creator(username);if(p.uid===who.uid)throw Error('You cannot follow yourself.');
    const path=`creatorFollows/${recordId(who.uid)}_${recordId(p.uid)}`;
    let newlyFollowed=false;await this.atomic([path],([old])=>{newlyFollowed=following&&!old?.active;return {[path]:{id:path.split('/')[1],uid:who.uid,creatorId:p.uid,activeCreatorId:following?p.uid:'',active:following,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()}};});if(newlyFollowed)await this.activity(p.uid,'creator.followed');
    return {following,followers:await this.count('creatorFollows','activeCreatorId',p.uid)};
  }
  async current(uid:string,botId:string){
    id(botId);const raw=await this.storage.read(`${this.storage.root(uid,botId)}/current.json`),v=raw?JSON.parse(raw):null;
    if(!v||v.userId!==uid||v.botId!==botId||typeof v.code!=='string')throw Error('Save this strategy in your workspace first.');return v;
  }
  async setBotCover(who:Identity,botId:string,data:unknown){
    id(botId);if(botId.length>100)throw Error('Invalid robot ID.');
    if(typeof data!=='string'||!validCover(data))throw Error('Choose a valid JPG, PNG or WebP under 500 KB.');
    const bot=await this.store.get(`users/${who.uid}/bots/${botId}`);
    if(!bot)throw Error('Save this robot to your account before changing its cover.');
    const raw=await this.storage.read(`${this.storage.root(who.uid,botId)}/publication.json`);
    const listingId=raw?JSON.parse(raw).id:null;
    if(listingId&&(typeof listingId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(listingId)))throw Error('Invalid publication pointer.');
    const url=await this.image(data),coverPath=`botCovers/${recordId(who.uid)}_${botId}`,listingPath=listingId?`marketplaceBots/${listingId}`:null;
    // Older shared pages keep their snapshot in R2. Update it as well as the
    // marketplace record so both public views show the same cover.
    if(listingId){const key=`shared-bots/v1/${listingId}.json`,snapshot=await this.storage.read(key);if(snapshot){const shared=JSON.parse(snapshot);if(shared.ownerUid!==who.uid||shared.botId!==botId)throw Error('Publication ownership mismatch.');await this.storage.write(key,JSON.stringify({...shared,coverImage:data}));}}
    await this.atomic(listingPath?[coverPath,listingPath]:[coverPath],([_old,listing])=>{
      if(listing&&(listing.creatorId!==who.uid||listing.privateBotId!==botId))throw Error('Publication ownership mismatch.');
      return {[coverPath]:{uid:who.uid,botId,coverImage:url},...(listingPath&&listing?{[listingPath]:{...listing,coverImage:url,updatedAt:Date.now()}}:{})};
    });
    return {coverImage:url};
  }
  async publishProject(who:Identity,botId:string,input:RecordData={}){
    id(botId);
    if(botId.length>100)throw Error('Invalid robot ID.');
    const [saved,bot,profile,cover]=await Promise.all([this.current(who.uid,botId),this.store.get(`users/${who.uid}/bots/${botId}`),this.profile(who),this.store.get(`botCovers/${recordId(who.uid)}_${botId}`)]);
    if(!bot)throw Error('Save this robot to your account before making it public.');
    if(!saved.code.trim())throw Error('Save a strategy before making this robot public.');
    await this.checkLicense(who.uid,botId,saved.code);
    const name=text(bot.name,64,true),defaultDescription=text(typeof bot.prompt==='string'?bot.prompt.slice(0,2000):'',2000),description=input.description===undefined?undefined:text(input.description,2000),asset=bot.asset;
    if(typeof asset!=='string'||!/^[A-Z0-9]{3,30}$/.test(asset))throw Error('This robot has an unsupported asset.');
    let timeframe:string|undefined;try{timeframe=parseStrategyConfig(saved.code).executionTimeframe}catch{/* A profile listing does not execute source. */}
    const pointerKey=`${this.storage.root(who.uid,botId)}/publication.json`,raw=await this.storage.read(pointerKey);
    // A stable UUID keeps retries idempotent and shares the existing publication link.
    const digest=hash(`${who.uid}\0${botId}`),generated=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
    const listingId=raw?JSON.parse(raw).id:generated;
    if(typeof listingId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(listingId))throw Error('Invalid publication pointer.');
    if(!raw)await this.storage.write(pointerKey,JSON.stringify({id:listingId}));
    const path=`marketplaceBots/${listingId}`,now=Date.now();
    await this.atomic([path],([current])=>{
      if(current&&(current.creatorId!==who.uid||current.privateBotId!==botId))throw Error('Publication ownership mismatch.');
      // Restoring a legacy link or a source package could grant access the creator
      // did not intend when making a profile-only listing public.
      if(current&&!current.published&&(current.packageId||(current.managedAccess&&!current.livePublic)))throw Error('Use sharing or releases to republish this existing bot and its access settings.');
      if(current?.published&&(current.packageId||(current.managedAccess&&!current.livePublic)))return {};
      return {[path]:{...current,id:listingId,privateBotId:botId,creatorId:who.uid,name,description:description??current?.description??defaultDescription,asset,timeframe,coverImage:cover?.coverImage||current?.coverImage||'',creator:profile.displayName,username:profile.username,access:'free',priceMinor:0,currency:'ZAR',managedAccess:true,livePublic:true,published:true,publicCreatorId:who.uid,createdAt:current?.createdAt||now,updatedAt:now}};
    });
    return {id:listingId,username:profile.username};
  }
  async version(uid:string,botId:string,input:RecordData={}){
    const current=await this.current(uid,botId);let code=current.code;
    if(input.legacyVersionId){const raw=await this.storage.read(`${this.storage.root(uid,botId)}/versions/${id(input.legacyVersionId)}.json`);const old=raw?JSON.parse(raw):null;if(!old||old.userId!==uid||old.botId!==botId)throw Error('Saved version unavailable.');code=old.code;}
    if(!code.trim()||code.length>180000)throw Error('Strategy must contain 1–180,000 characters.');
    const config=parseStrategyConfig(code),key=randomUUID(),createdAt=Date.now(),codeKey=`bot-economy/versions/${key}.json`;
    const fork=await this.store.get(`botForks/${recordId(uid)}_${botId}`);
    const v={id:key,creatorId:uid,privateBotId:botId,projectKey:`${recordId(uid)}_${botId}`,label:text(input.label||`Version ${new Date(createdAt).toISOString()}`,64,true),description:text(input.description||'',2000),releaseNotes:text(input.releaseNotes||'',2000),asset:typeof input.asset==='string'&&/^[A-Z0-9]{3,30}$/.test(input.asset)?input.asset:'XAUUSD',config,hash:hash(code),codeKey,createdAt,provenance:fork?.provenance||null};
    await this.storage.write(codeKey,JSON.stringify({code}));if(!await this.store.create(`sourceVersions/${key}`,v))throw Error('Version collision. Please retry.');
    await this.activity(uid,'version.saved',botId,v.label);return versionView(v);
  }
  async source(uid:string,versionId:string,acquisitionId?:string){
    const v=await this.store.get(`sourceVersions/${id(versionId)}`);if(!v)throw Error('Version unavailable.');
    if(v.creatorId!==uid){const a=acquisitionId?await this.store.get(`botAcquisitions/${id(acquisitionId)}`):null;if(!a||a.uid!==uid||a.status!=='active'||!a.versionIds.includes(versionId))throw Error('This version is not included in your acquisition.');}
    const raw=await this.storage.read(v.codeKey);if(!raw)throw Error('Source temporarily unavailable.');const code=JSON.parse(raw).code;if(hash(code)!==v.hash)throw Error('Source integrity check failed.');return {code,version:versionView(v)};
  }
  async checkLicense(uid:string,botId:string,code:string,license?:LicenseKind){
    const fork=await this.store.get(`botForks/${recordId(uid)}_${id(botId)}`);if(!fork){if(botId.startsWith('shared-'))throw Error('Legacy shared copies are private Personal Use projects.');return;}
    const p=fork.provenance;if(p.license==='personal')throw Error('Personal Use copies cannot be published or offered as managed bots.');
    if(p.license==='commercial'){
      const {code:original}=await this.source(uid,p.versionId,p.acquisitionId);
      // Conservative comparison; executable differences still require creator review under the license.
      const normalize=(s:string)=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/\s/g,'');
      if(normalize(original)===normalize(code))throw Error('Commercial Remix requires changes to executable source, beyond branding, comments or whitespace.');
      if(license&&license!=='commercial')throw Error('Commercial derivatives must preserve Commercial Remix restrictions.');
    }
  }
  async package(who:Identity,botId:string,input:RecordData){
    const saved=await this.current(who.uid,botId),license=kind(input.license);await this.checkLicense(who.uid,botId,saved.code,license);
    if(!Array.isArray(input.versionIds))throw Error('Select versions.');const ids=[...new Set(input.versionIds)] as string[];if(!ids.length||ids.length>20)throw Error('Select 1–20 versions.');
    const versions=await Promise.all(ids.map(async key=>{const v=await this.store.get(`sourceVersions/${id(key)}`);if(!v||v.creatorId!==who.uid||v.privateBotId!==botId)throw Error('Select only versions belonging to this project.');const {code}=await this.source(who.uid,v.id);await this.checkLicense(who.uid,botId,code,license);return v;}));
    const profile=await this.profile(who),key=randomUUID(),priceMinor=input.priceMinor??0;
    if(!Number.isSafeInteger(priceMinor)||priceMinor<0||priceMinor>100000000)throw Error('Invalid ZAR price.');
    const listingId=id(input.listingId),listing=await this.trading.owned(who.uid,listingId);if(listing.privateBotId!==botId)throw Error('Listing/project mismatch.');
    const category=text(input.category||'Experimental',40),cover=input.coverImage||'';if(!validCover(cover))throw Error('Invalid bot cover.');
    const coverPath=`botCovers/${recordId(who.uid)}_${botId}`,existingCover=await this.store.get(coverPath),storedCover=existingCover?.coverImage||listing.coverImage||'',coverImage=cover?await this.image(cover):validCover(storedCover)?await this.image(storedCover):/^\/api\/economy\/images\/[a-f0-9]{64}$/.test(storedCover)?storedCover:'';
    const p={id:key,botId:listingId,privateBotId:botId,creatorId:who.uid,creator:profile.displayName,username:profile.username,name:text(input.name||listing.name,64,true),description:text(input.description||listing.description||'',2000),coverImage,asset:listing.asset,category,versionIds:ids,versions:versions.map(versionView),license,licenseRevision:LICENSE_REVISION,licenseTerms:LICENSES[license].terms,priceMinor,currency:'ZAR',futureUpdates:false,published:true,provenance:versions[0]?.provenance||null,createdAt:Date.now()};
    await this.atomic([`botPackages/${key}`,`marketplaceBots/${listingId}`,coverPath],([existing,latest])=>{if(existing||!latest||latest.creatorId!==who.uid)throw Error('Package ownership changed.');return {[`botPackages/${key}`]:p,[`marketplaceBots/${listingId}`]:{...latest,coverImage:p.coverImage,category,access:priceMinor?'paid':'free',priceMinor,currency:'ZAR',creator:profile.displayName,username:profile.username,packageId:key,published:true,publicCreatorId:who.uid,updatedAt:Date.now()},[coverPath]:{uid:who.uid,botId,coverImage:p.coverImage}};});
    await this.activity(who.uid,'bot.published',listingId,p.name);return p;
  }
  async packagePublic(packageId:string){const p=await this.store.get(`botPackages/${id(packageId)}`);if(!p?.published)throw Error('Package unavailable.');const b=await this.store.get(`marketplaceBots/${p.botId}`);if(!b?.published)throw Error('Bot unavailable.');return publicPackage(p);}
  async acquire(who:Identity,packageId:string){
    const p=await this.packagePublic(packageId),key=`${p.id}_${recordId(who.uid)}`,path=`botAcquisitions/${key}`,old=await this.store.get(path);
    if(old){if(old.status!=='active')throw Error('This acquisition is revoked.');return old;}
    if(p.priceMinor!==0&&p.creatorId!==who.uid)throw Error('Yoco checkout is not connected. Paid source acquisition is disabled.');
    const a={id:key,uid:who.uid,creatorId:p.creatorId,botId:p.botId,packageId:p.id,name:p.name,creator:p.creator,versionIds:[...p.versionIds],versions:p.versions,license:p.license,licenseRevision:p.licenseRevision,licenseTerms:p.licenseTerms,futureUpdates:false,status:'active',type:p.creatorId===who.uid?'owner':'free',createdAt:Date.now()};
    await this.atomic([path,`marketplaceBots/${p.botId}`],([existing,listing])=>{if(existing)return {};if(!listing?.published)throw Error('Bot unavailable.');return {[path]:a,[`marketplaceBots/${p.botId}`]:{...listing,sourceAcquisitions:(listing.sourceAcquisitions||0)+(p.creatorId===who.uid?0:1)}};});await this.store.create(`botActivity/acquire_${key}`,{id:`acquire_${key}`,uid:p.creatorId,type:'bot.acquired',botId:p.botId,createdAt:a.createdAt});return (await this.store.get(path))!;
  }
  async remix(who:Identity,acquisitionId:string,versionId:string){
    const a=await this.store.get(`botAcquisitions/${id(acquisitionId)}`);if(!a||a.uid!==who.uid||a.status!=='active'||!a.versionIds.includes(versionId))throw Error('You do not own this acquired version.');
    const {code}=await this.source(who.uid,versionId,a.id),botId=`remix-${randomUUID()}`,storageKey=`${this.storage.root(who.uid,botId)}/current.json`;
    const provenance={originalCreatorId:a.creatorId,originalCreator:a.creator,botId:a.botId,packageId:a.packageId,versionId,acquisitionId:a.id,license:a.license,licenseRevision:a.licenseRevision};
    // Provenance lives outside editable user documents and survives deletion/recreation of a draft.
    await this.store.create(`botForks/${recordId(who.uid)}_${botId}`,{id:botId,uid:who.uid,creatorId:a.creatorId,botId:a.botId,provenance,createdAt:Date.now()});
    await this.storage.write(storageKey,JSON.stringify({schemaVersion:1,userId:who.uid,botId,code,updatedAt:new Date().toISOString()}));
    const v=await this.store.get(`sourceVersions/${versionId}`),bot={id:botId,name:`${a.name} · My copy`.slice(0,64),asset:v?.asset||'XAUUSD',prompt:'Licensed private copy',storage:{provider:'r2',key:storageKey},updatedAt:new Date().toISOString()};
    await this.store.create(`users/${who.uid}/bots/${botId}`,bot);await this.atomic([`marketplaceBots/${a.botId}`],([listing])=>listing?{[`marketplaceBots/${a.botId}`]:{...listing,remixCount:(listing.remixCount||0)+1}}:{});await this.activity(who.uid,'bot.remixed',a.botId,a.name);return {...bot,storageKey,code};
  }
  async copyProject(who:Identity,botId:string){
    id(botId);const saved=await this.current(who.uid,botId),original=await this.store.get(`users/${who.uid}/bots/${botId}`);if(!original)throw Error('Robot unavailable.');
    let code=saved.code;const pointerRaw=await this.storage.read(`${this.storage.root(who.uid,botId)}/publication.json`);
    if(pointerRaw){const listingId=id(JSON.parse(pointerRaw).id),listing=await this.trading.owned(who.uid,listingId);if(listing.privateBotId!==botId)throw Error('Robot pointer mismatch.');const deployment=await this.store.get(`deployments/${listingId}`);
      if(deployment){const observed=await this.trading.deploymentStatus(who.uid,listingId);if(observed.running){if(!/^[a-f0-9]{64}$/.test(String(observed.version)))throw Error('Running version is unavailable.');const pinned=await this.storage.read(`runtime-code/${listingId}/${observed.version}.js`);if(!pinned||hash(pinned)!==observed.version)throw Error('Running strategy snapshot is unavailable or failed integrity validation.');code=pinned;}}
    }
    const fork=await this.store.get(`botForks/${recordId(who.uid)}_${botId}`);if(botId.startsWith('shared-')&&!fork)throw Error('This shared copy has no verified license record.');
    const copyId=`copy-${randomUUID()}`,storageKey=`${this.storage.root(who.uid,copyId)}/current.json`,now=new Date().toISOString();
    if(fork)await this.store.create(`botForks/${recordId(who.uid)}_${copyId}`,{...fork,id:copyId,uid:who.uid,createdAt:Date.now()});
    await this.storage.write(storageKey,JSON.stringify({schemaVersion:1,userId:who.uid,botId:copyId,code,updatedAt:now}));
    const copy={id:copyId,name:`${String(original.name||'Robot').slice(0,54)} · Copy`,asset:original.asset,prompt:original.prompt||'',storage:{provider:'r2',key:storageKey},updatedAt:now};
    if(!await this.store.create(`users/${who.uid}/bots/${copyId}`,copy))throw Error('Could not create a unique copy. Retry.');return {...copy,storageKey,code};
  }
  async invite(who:Identity,botId:string,input:RecordData){
    await this.trading.owned(who.uid,id(botId));const email=text(input.email||'',254).toLowerCase();if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid recipient email.');
    const expiresAt=Number(input.expiresAt||Date.now()+30*86400000);if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+30*86400000)throw Error('Invitations expire within 30 days.');
    const memberExpiresAt=input.memberExpiresAt?Number(input.memberExpiresAt):null;if(memberExpiresAt&&(!Number.isFinite(memberExpiresAt)||memberExpiresAt<=Date.now()))throw Error('Invalid membership expiration.');
    const token=randomBytes(32).toString('base64url'),key=hash(token);
    const quotaPath=`botInvitationQuota/${botId}`, invitationPath=`botInvitations/${key}`;
    await this.atomic([quotaPath,invitationPath],([quota,existing])=>{if(existing)throw Error('Invitation collision. Please retry.');const pending=Number(quota?.pending||0);if(!Number.isSafeInteger(pending)||pending<0||pending>=100)throw Error('This bot already has 100 unused access codes. Revoke an unused or expired code to create another.');return {[quotaPath]:{botId,creatorId:who.uid,pending:pending+1},[invitationPath]:{id:key,botId,creatorId:who.uid,email,expiresAt,memberExpiresAt,status:'pending',quotaTracked:true,createdAt:Date.now()}};});
    return {id:key,token,expiresAt};
  }
  async accept(who:Identity,token:string){
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('Invitation unavailable.');const invitationPath=`botInvitations/${hash(token)}`,inv=await this.store.get(invitationPath);if(!inv)throw Error('Invitation unavailable.');
    const memberPath=`botMembers/${accessId(inv.botId,who.uid)}`,entitlementPath=`entitlements/${accessId(inv.botId,who.uid)}`;
    const quotaPath=`botInvitationQuota/${inv.botId}`;
    await this.atomic([invitationPath,memberPath,entitlementPath,quotaPath],([current,member,entitlement,quota])=>{
      if(!current||current.status!=='pending'||current.expiresAt<=Date.now())throw Error('Invitation expired, revoked or already accepted.');
      if(current.email&&(!who.emailVerified||who.email?.toLowerCase()!==current.email))throw Error('Sign in with the intended verified email address to accept.');
      if(entitlement?.status==='revoked')throw Error('Access has been revoked. Contact the creator.');
      if(member&&['revoked','suspended'].includes(member.status))throw Error('Ask the creator to restore access first.');
      return {...(current.quotaTracked?{[quotaPath]:{...quota,pending:Math.max(0,Number(quota?.pending||0)-1)}}:{}),[invitationPath]:{...current,status:'accepted',acceptedBy:who.uid,acceptedAt:Date.now()},[memberPath]:{...member,id:accessId(inv.botId,who.uid),uid:who.uid,creatorId:inv.creatorId,botId:inv.botId,email:who.emailVerified?who.email||'':'',displayName:who.name||'',status:'active',accessType:current.email?'email_invitation':'invitation_link',expiresAt:current.memberExpiresAt,createdAt:member?.createdAt||Date.now(),executionEnabled:false},[entitlementPath]:{...entitlement,id:accessId(inv.botId,who.uid),uid:who.uid,botId:inv.botId,creatorId:inv.creatorId,type:'membership',status:'active',createdAt:entitlement?.createdAt||Date.now()}};
    });await this.activity(inv.creatorId,'member.joined',inv.botId);return {botId:inv.botId};
  }
  async revokeInvitation(who:Identity,invitationId:string){
    const invitationPath=`botInvitations/${id(invitationId)}`,inv=await this.store.get(invitationPath);if(!inv||inv.creatorId!==who.uid)throw Error('Invitation unavailable.');
    const quotaPath=`botInvitationQuota/${inv.botId}`;
    await this.atomic([invitationPath,quotaPath],([current,quota])=>{if(!current||current.creatorId!==who.uid)throw Error('Invitation unavailable.');if(current.status!=='pending')return {};return {[invitationPath]:{...current,status:'revoked'},...(current.quotaTracked?{[quotaPath]:{...quota,pending:Math.max(0,Number(quota?.pending||0)-1)}}:{})};});return {revoked:true};
  }
  async member(who:Identity,memberId:string,input:RecordData){
    const path=`botMembers/${id(memberId)}`,m=await this.store.get(path);if(!m||m.creatorId!==who.uid)throw Error('Member unavailable.');
    if(!['active','suspended','revoked'].includes(input.status))throw Error('Invalid access status.');
    const expiresAt=input.expiresAt?Number(input.expiresAt):null;if(expiresAt&&(!Number.isFinite(expiresAt)||expiresAt<=Date.now()))throw Error('Choose a future expiration.');
    await this.atomic([path],([latest])=>({[path]:{...latest,status:input.status,expiresAt,executionEnabled:false,updatedAt:Date.now()}}));
    // Eligibility reads membership again immediately before submitting each new intent.
    const sub=await this.store.get(`botSubscribers/${memberId}`);if(sub)await this.store.put(`botSubscribers/${memberId}`,{...sub,status:'paused',updatedAt:Date.now()});
    await this.activity(who.uid,`member.${input.status}`,m.botId);return {updated:true};
  }
  async memberList(who:Identity,after?:string){
    const page=await this.page('botMembers','creatorId',who.uid,after);
    const items:RecordData[]=await Promise.all(page.items.map(async m=>{const [broker,sub,bot]=await Promise.all([this.store.get(`brokerConnections/${recordId(m.uid)}`),this.store.get(`botSubscribers/${m.id}`),this.store.get(`marketplaceBots/${m.botId}`)]);return {...m,botName:bot?.name||m.botId,status:m.expiresAt&&m.expiresAt<=Date.now()?'expired':m.status,brokerConnected:Boolean(broker?.connected),executionEnabled:m.status==='active'&&(!m.expiresAt||m.expiresAt>Date.now())&&sub?.status==='active'};}));return {...page,items};
  }
  async summary(who:Identity){
    const profile=await this.profile(who);const [published,acquired,followers,members]=await Promise.all([this.count('marketplaceBots','publicCreatorId',who.uid),this.count('botAcquisitions','uid',who.uid),this.count('creatorFollows','activeCreatorId',who.uid),this.count('botMembers','creatorId',who.uid)]);
    return {profile,counts:{published,acquired,followers,members},billing:{mode:'free_test',paidAI:false,paidDeployment:false,payments:'not_connected'}};
  }
  async ensureMember(who:Identity,botId:string){
    const bot=await this.trading.store.get(`marketplaceBots/${botId}`);if(!bot)throw Error('Bot unavailable.');
    const path=`botMembers/${accessId(botId,who.uid)}`;
    await this.atomic([path],([member])=>{
      if(member){if(!bot.published&&bot.creatorId!==who.uid&&member.accessType==='public_join')throw Error('This bot is private. Ask for a creator invitation.');if(member.status!=='active'||member.expiresAt&&member.expiresAt<=Date.now())throw Error('Membership is inactive or expired.');return {};}
      if((!bot.published||!bot.managedAccess)&&bot.creatorId!==who.uid)throw Error('Join this live bot using a creator invitation. Source acquisition is separate.');
      return {[path]:{id:accessId(botId,who.uid),uid:who.uid,creatorId:bot.creatorId,botId,email:who.emailVerified?who.email||'':'',displayName:who.name||'',status:'active',accessType:'public_join',expiresAt:null,createdAt:Date.now(),executionEnabled:false}};
    });
  }
  async checkDeployment(uid:string,privateBotId:string,code:string){
    const fork=await this.store.get(`botForks/${recordId(uid)}_${privateBotId}`);if(!fork&&!privateBotId.startsWith('shared-'))return;
    const listings=await this.page('marketplaceBots','creatorId',uid,undefined,100);
    if(listings.next)throw Error('Deployment license review exceeds the current project limit.');
    const listing=listings.items.find(b=>b.privateBotId===privateBotId);
    if(listing?.published)await this.checkLicense(uid,privateBotId,code);
  }
  async legacyPublish(bot:RecordData){const fork=await this.store.get(`botForks/${recordId(bot.ownerUid)}_${bot.botId}`);if(fork?.provenance?.license==='commercial')throw Error('Publish Commercial Remix copies through a licensed source package in Releases.');await this.checkLicense(bot.ownerUid,bot.botId,bot.code);const coverImage=await this.image(bot.coverImage||'');await this.trading.publish(bot);const profile=await this.profile({uid:bot.ownerUid,name:bot.creator});const saved=await this.store.get(`marketplaceBots/${bot.id}`);await this.store.put(`marketplaceBots/${bot.id}`,{...saved,coverImage,managedAccess:true,publicCreatorId:bot.ownerUid,username:profile.username});await this.store.put(`botCovers/${recordId(bot.ownerUid)}_${bot.botId}`,{uid:bot.ownerUid,botId:bot.botId,coverImage});}
  async legacyCopy(uid:string,bot:RecordData){
    await this.trading.acquire(uid,bot.id);
    const privateId=`shared-${bot.id}`,path=`botForks/${recordId(uid)}_${privateId}`;
    await this.store.create(path,{uid,botId:bot.id,creatorId:bot.ownerUid,provenance:{originalCreatorId:bot.ownerUid,originalCreator:bot.creator||'Bot creator',botId:bot.id,license:'personal',licenseRevision:LICENSE_REVISION,legacy:true},createdAt:Date.now()});
  }
}

export function economyRoutes(app:Express,economy:BotEconomy,authenticate:(req:Request,res:Response)=>Promise<Identity|null>){
  app.get('/api/economy/images/:imageId',async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');if(!/^[a-f0-9]{64}$/.test(String(req.params.imageId)))return res.sendStatus(404);try{const raw=await economy.storage.read(`bot-economy/images/${req.params.imageId}.json`);const data=raw?JSON.parse(raw).data:null;if(!validCover(data)||!data)return res.sendStatus(404);const [head,body]=data.split(',');res.setHeader('Cache-Control','public, max-age=31536000, immutable');return res.type(head.slice(5,head.indexOf(';'))).send(Buffer.from(body,'base64'));}catch{return res.sendStatus(502);}});
  const route=(method:'get'|'post'|'put',path:string,privateRoute:boolean,handler:(who:Identity,req:Request)=>Promise<unknown>)=>app[method](`/api/economy${path}`,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');const who=privateRoute?await authenticate(req,res):{uid:''};if(!who)return;
    if(economy.store instanceof FirestoreStore&&!FirestoreStore.configured())return res.status(503).json({error:'Creator services need server Firebase credentials. Your saved workspace remains available.'});
    try{for(const key of ['id','botId','versionId'])if((req.params as Record<string,string>)[key])id((req.params as Record<string,string>)[key]);const after=req.query.after;if(after!==undefined&&(typeof after!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(after)))throw Error('Invalid page cursor.');res.json(await handler(who,req));}catch(e){res.status(400).json({error:e instanceof Error?e.message:'Creator request failed.'});}
  });
  const after=(req:Request)=>typeof req.query.after==='string'?req.query.after:undefined;
  route('get','/me',true,who=>economy.summary(who));
  route('put','/me',true,(who,req)=>economy.editProfile(who,req.body));
  route('get','/creators',false,async(_,req)=>{const page=await economy.page('creatorProfiles',undefined,undefined,after(req));return {...page,items:page.items.filter(p=>p.username).map(publicProfile)};});
  route('get','/creators/:username',false,(_,req)=>economy.creator(String(req.params.username)));
  route('get','/creators/:username/bots',false,async(_,req)=>{const p=await economy.creator(String(req.params.username));const page=await economy.page('marketplaceBots','publicCreatorId',p.uid,after(req));return {...page,items:page.items.map(publicBot)};});
  route('post','/creators/:username/follow',true,(who,req)=>economy.follow(who,String(req.params.username),req.body?.following===true));
  route('get','/creators/:username/follow',true,async(who,req)=>{const p=await economy.creator(String(req.params.username));return {following:Boolean((await economy.store.get(`creatorFollows/${recordId(who.uid)}_${recordId(p.uid)}`))?.active)};});
  route('get','/bots',false,async(_,req)=>{const page=await economy.page('marketplaceBots','published',true,after(req));return {...page,items:page.items.map(publicBot)};});
  route('get','/bots/:id',false,async(_,req)=>{const b=await economy.store.get(`marketplaceBots/${req.params.id}`);if(!b?.published)throw Error('Bot unavailable.');const [packages,acquisitions,remixes]=await Promise.all([economy.page('botPackages','botId',b.id,after(req)),economy.count('botAcquisitions','botId',b.id),economy.count('botForks','botId',b.id)]);return {bot:publicBot(b),packages:{...packages,items:packages.items.filter(p=>p.published).map(publicPackage)},acquisitions,remixes};});
  route('post','/projects/:botId/publish',true,(who,req)=>economy.publishProject(who,String(req.params.botId),req.body||{}));
  route('put','/projects/:botId/cover',true,(who,req)=>economy.setBotCover(who,String(req.params.botId),req.body?.coverImage));
  route('get','/covers',true,(who,req)=>economy.page('botCovers','uid',who.uid,after(req),100));
  route('post','/projects/:botId/copy',true,(who,req)=>economy.copyProject(who,String(req.params.botId)));
  route('post','/projects/:botId/versions',true,(who,req)=>economy.version(who.uid,String(req.params.botId),req.body));
  route('get','/projects/:botId/versions',true,(who,req)=>economy.page('sourceVersions','projectKey',`${recordId(who.uid)}_${req.params.botId}`,after(req)));
  route('post','/projects/:botId/packages',true,(who,req)=>economy.package(who,String(req.params.botId),req.body));
  route('get','/versions/:versionId/source',true,(who,req)=>economy.source(who.uid,String(req.params.versionId),typeof req.query.acquisition==='string'?req.query.acquisition:undefined));
  route('get','/packages/:id',false,(_,req)=>economy.packagePublic(String(req.params.id)));
  route('post','/packages/:id/acquire',true,(who,req)=>economy.acquire(who,String(req.params.id)));
  route('get','/listings',true,(who,req)=>economy.page('marketplaceBots','creatorId',who.uid,after(req)));
  route('get','/acquisitions',true,(who,req)=>economy.page('botAcquisitions','uid',who.uid,after(req)));
  route('post','/acquisitions/:id/remix',true,(who,req)=>economy.remix(who,String(req.params.id),id(req.body?.versionId)));
  route('get','/members',true,(who,req)=>economy.memberList(who,after(req)));
  route('post','/members/:id',true,(who,req)=>economy.member(who,String(req.params.id),req.body));
  route('get','/memberships',true,async(who,req)=>{const page=await economy.page('botMembers','uid',who.uid,after(req));const items=await Promise.all(page.items.map(async m=>{const bot=await economy.store.get(`marketplaceBots/${m.botId}`);return {...m,botName:bot?.name||m.botId,asset:bot?.asset||''};}));return {...page,items};});
  route('post','/bots/:id/unpublish',true,async(who,req)=>{const b=await economy.trading.owned(who.uid,String(req.params.id));const key=`${economy.storage.root(who.uid,b.privateBotId)}/publication.json`;const raw=await economy.storage.read(key);if(raw){const pointer=JSON.parse(raw);if(pointer.id===b.id){const snapshotKey=`shared-bots/v1/${b.id}.json`,published=await economy.storage.read(snapshotKey);if(published){const snapshot=JSON.parse(published);if(snapshot.ownerUid!==who.uid||snapshot.botId!==b.privateBotId)throw Error('Publication ownership mismatch.');await economy.storage.write(snapshotKey,JSON.stringify({...snapshot,published:false}));}}}await economy.trading.unpublish(who.uid,b.id);return {unpublished:true};});
  route('post','/bots/:id/invitations',true,(who,req)=>economy.invite(who,String(req.params.id),req.body));
  route('get','/invitations',true,(who,req)=>economy.page('botInvitations','creatorId',who.uid,after(req)));
  route('post','/invitations/:id/revoke',true,(who,req)=>economy.revokeInvitation(who,String(req.params.id)));
  route('post','/invitations/accept',true,(who,req)=>economy.accept(who,text(req.body?.token,100,true)));
  route('get','/activity',true,(who,req)=>economy.page('botActivity','uid',who.uid,after(req)));
  route('get','/usage',true,async(who,req)=>({...(await economy.page('resourceUsage','uid',who.uid,after(req))),billingEnabled:false}));
}
export function publicBot(b:RecordData){return {id:b.id,name:b.name,description:b.description,asset:b.asset,creator:b.creator,username:b.username,coverImage:b.coverImage||'',category:b.category||'Experimental',packageId:b.packageId||null,sourceAcquisitions:b.sourceAcquisitions??null,remixCount:b.remixCount??null,managedAccess:Boolean(b.managedAccess),livePublic:Boolean(b.livePublic),access:b.access,priceMinor:b.priceMinor||0,timeframe:b.timeframe,updatedAt:b.updatedAt};}
