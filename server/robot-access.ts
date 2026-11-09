import type { Express, Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { RecordStore, RecordData } from './firestore-store.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const validId = (value: string) => /^[A-Za-z0-9_-]{1,100}$/.test(value);
const validShareId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const validRequestId = (value: string) => /^[a-f0-9]{64}$/.test(value);
const requestPath = (id: string) => 'robotAccessRequests/' + id;
const grantPath = (id: string) => 'robotAccessGrants/' + id;
const publicPath = (id: string) => 'shared-bots/v1/' + id + '.json';
export const revisionPath = (id: string, hash: string) => 'shared-bots/revisions/' + id + '/' + hash + '.json';
const requestIdFor = (publicationId: string, uid: string, revision: string) => digest(publicationId + '\0' + uid + '\0' + revision);
const copyIdFor = (publicationId: string, revision: string) => 'shared-' + publicationId + '-' + revision.slice(0, 12);

export type ShareAccessStorage = {
  store: RecordStore;
  read: (key: string) => Promise<string | null>;
  write: (key: string, data: string) => Promise<void>;
  root: (uid: string, botId: string) => string;
  uid: (req: Request, res: Response) => Promise<string | null>;
};
type Publication = {
  id: string; ownerUid: string; botId: string; code: string; codeHash?: string;
  revisionId?: string; venue?: string; name: string; asset: string; description: string;
  creator?: string; access?:'free'|'paid'; published: boolean;
};
type AccessRequest = RecordData & {
  id: string; publicationId: string; ownerUid: string; requesterUid: string;
  revision: string; status: 'pending'|'provisioning'|'approved'|'rejected'|'revoked';
};
const statusError = (message: string, status: number) => Object.assign(new Error(message), { status });
function respondError(res: Response, cause: unknown) {
  const status = cause && typeof cause === 'object' && 'status' in cause && typeof cause.status === 'number' ? cause.status : 503;
  return res.status(status).json({ error: status === 503 ? 'Robot access services are temporarily unavailable. Please retry.' : cause instanceof Error ? cause.message : 'Robot access failed.' });
}

export function shareAccessRoutes(app: Express, storage: ShareAccessStorage) {
  const store = storage.store;
  async function readPublication(id: string) {
    if (!validShareId(id)) throw statusError('Robot link is invalid.', 404);
    const raw = await storage.read(publicPath(id));
    const publication = raw ? JSON.parse(raw) as Publication : null;
    if (!publication || publication.id !== id) throw statusError('This robot is unavailable.', 404);
    return publication;
  }
  async function ownerPublication(uid: string, botId: string) {
    if (!validId(botId)) throw statusError('Invalid robot ID.', 400);
    const pointer = await storage.read(storage.root(uid, botId) + '/publication.json');
    if (!pointer) throw statusError('Publish this robot first.', 404);
    const id = JSON.parse(pointer)?.id;
    const publication = await readPublication(id);
    if (publication.ownerUid !== uid || publication.botId !== botId) throw statusError('Robot ownership mismatch.', 403);
    return publication;
  }
  function currentRevision(pub: Publication) {
    const hash = digest(pub.code);
    if (pub.codeHash && pub.codeHash !== hash) throw statusError('Published strategy failed integrity verification.', 409);
    return hash;
  }
  async function readRevision(pub: Publication, revision: string) {
    const archived = await storage.read(revisionPath(pub.id, revision));
    let code: string;
    if (archived) {
      const data = JSON.parse(archived);
      code = data.code;
      if (data.ownerUid !== pub.ownerUid || data.publicationId !== pub.id) throw statusError('Revision ownership mismatch.', 409);
    } else if (currentRevision(pub) === revision) {
      // Backward-compatible fallback for publications created before immutable revision archives.
      code = pub.code;
    } else throw statusError('Requested revision is unavailable.', 409);
    if (typeof code !== 'string' || digest(code) !== revision) throw statusError('Published code integrity check failed.', 409);
    return code;
  }
  async function findRequest(pub: Publication, uid: string) {
    const hash = currentRevision(pub);
    return { revision: hash, id: requestIdFor(pub.id, uid, hash), record: await store.get(requestPath(requestIdFor(pub.id, uid, hash))) as AccessRequest | null };
  }
  app.get('/api/shared-bots/:shareId/my-access', async(req,res) => {
    res.setHeader('Cache-Control','private, no-store');
    const uid=await storage.uid(req,res);if(!uid)return;
    try {
      const pub=await readPublication(req.params.shareId);
      if(pub.ownerUid===uid)return res.json({status:'owner'});
      const {id,record}=await findRequest(pub,uid);
      if(!record)return res.json({status:'none'});
      const grant=record.status==='approved' ? await store.get(grantPath(id)) : null;
      const active=record.status==='approved' && grant?.status==='active' && grant?.recipientUid===uid;
      return res.json({status:active?'approved':record.status==='approved'?'pending':record.status, ...(active?{botId:grant!.copyBotId}:{})});
    }catch(cause){return respondError(res,cause)}
  });
  app.post('/api/shared-bots/:shareId/requests',async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const uid=await storage.uid(req,res);if(!uid)return;
    try {
      const pub=await readPublication(req.params.shareId);
      if(!pub.published)throw statusError('This robot is not accepting requests.',409);
      if(pub.access!=='free')throw statusError('This robot uses an unsupported access model.',403);
      if(uid===pub.ownerUid)throw statusError('You already own this robot.',403);
      const revision=currentRevision(pub),id=requestIdFor(pub.id,uid,revision),path=requestPath(id);
      const name=typeof res.locals.identity?.name==='string'?res.locals.identity.name.trim().slice(0,80):'';
      const now=Date.now();
      await store.create(path,{id,publicationId:pub.id,robotId:pub.botId,ownerUid:pub.ownerUid,requesterUid:uid,requesterName:name||('Trader '+uid.slice(0,10)),revision,status:'pending',createdAt:now,updatedAt:now});
      const record=await store.get(path) as AccessRequest|null;
      if(!record||record.requesterUid!==uid||record.publicationId!==pub.id)throw statusError('Request verification failed.',409);
      return res.json({status:record.status==='provisioning'?'pending':record.status});
    }catch(cause){return respondError(res,cause)}
  });
  app.get('/api/user-bots/:botId/access-requests',async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const uid=await storage.uid(req,res);if(!uid)return;
    try {
      const pub=await ownerPublication(uid,req.params.botId);
      const requests=(await store.query('robotAccessRequests','publicationId',pub.id))
        .filter(r=>r.ownerUid===uid&&r.publicationId===pub.id)
        .sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0))
        .slice(0,100)
        .map(r=>({id:r.id,requesterName:r.requesterName||'Trading Vibes member',createdAt:r.createdAt,updatedAt:r.updatedAt,status:r.status==='provisioning'?'pending':r.status,revision:r.revision.slice(0,12)}));
      return res.json({requests});
    }catch(cause){return respondError(res,cause)}
  });
  async function ownerDecision(req:Request,res:Response,decision:'approve'|'reject'|'revoke'){
    res.setHeader('Cache-Control','private, no-store');
    const uid=await storage.uid(req,res);if(!uid)return;
    try {
      const pub=await ownerPublication(uid,String(req.params.botId)),requestId=String(req.params.requestId);
      if(!validRequestId(requestId))throw statusError('Invalid access request.',400);
      const path=requestPath(requestId),grantKey=grantPath(requestId);
      const existing=await store.get(path) as AccessRequest|null;
      if(!existing||existing.ownerUid!==uid||existing.publicationId!==pub.id)throw statusError('Request not found.',404);
      if(decision==='reject'){
        await store.transaction!([path],([old])=>{
          if(!old || old.ownerUid!==uid)throw statusError('Unauthorized request.',403);
          if(old.status==='rejected')return {};
          if(old.status!=='pending')throw statusError('Only pending requests can be rejected.',409);
          return {[path]:{...old,status:'rejected',updatedAt:Date.now()}};
        });
        return res.json({status:'rejected'});
      }
      if(decision==='revoke'){
        await store.transaction!([path,grantKey],([old,grant])=>{
          if(!old||old.ownerUid!==uid)throw statusError('Unauthorized request.',403);
          if(old.status==='revoked')return {};
          if(old.status!=='approved'||grant?.status!=='active')throw statusError('Only active grants can be revoked.',409);
          return {[path]:{...old,status:'revoked',updatedAt:Date.now()},[grantKey]:{...grant,status:'revoked',updatedAt:Date.now()}};
        });
        return res.json({status:'revoked',message:'Existing independent robot copies and deployments are not deleted or stopped.'});
      }
      if(!pub.published)throw statusError('Publish the robot before approving access.',409);
      if(pub.access!=='free')throw statusError('This robot uses an unsupported access model.',403);
      const current=await store.get(path) as AccessRequest|null;
      if(!current || current.ownerUid!==uid || current.publicationId!==pub.id)throw statusError('Request not found.',404);
      const revision=current.revision;
      if(!/^[a-f0-9]{64}$/.test(revision)||requestId!==requestIdFor(pub.id,current.requesterUid,revision))throw statusError('Request revision integrity failed.',409);
      const code=await readRevision(pub,revision);
      const copyBotId=copyIdFor(pub.id,revision),recipientUid=current.requesterUid;
      const storageKey=storage.root(recipientUid,copyBotId)+'/current.json';
      const metadataPath='users/'+recipientUid+'/bots/'+copyBotId;
      const lease=randomUUID(),now=Date.now();
      await store.transaction!([path,grantKey],([old,grant])=>{
        if(!old||old.ownerUid!==uid||old.revision!==revision||old.requesterUid!==recipientUid)throw statusError('Request changed.',409);
        if(old.status==='approved'&&grant?.status==='active')return {};
        if(old.status==='rejected'||old.status==='revoked')throw statusError('Request is no longer pending.',409);
        if(grant?.status==='provisioning'&&Number(grant.leaseUntil)>now)throw statusError('Approval is already being processed. Retry shortly.',409);
        return {[path]:{...old,status:'provisioning',updatedAt:now},[grantKey]:{...grant,id:requestId,publicationId:pub.id,ownerUid:uid,recipientUid,revision,copyBotId,status:'provisioning',lease,leaseUntil:now+60000,createdAt:grant?.createdAt||now,updatedAt:now}};
      });
      const already=await store.get(grantKey);
      if(already?.status==='active'&&already.recipientUid===recipientUid)return res.json({status:'approved',botId:copyBotId});
      try {
        const prior=await storage.read(storageKey);
        if(prior){
          const saved=JSON.parse(prior);
          if(saved.userId!==recipientUid||saved.botId!==copyBotId||saved.provenance?.publicationId!==pub.id||saved.provenance?.revision!==revision)throw statusError('An existing copy failed provenance verification.',409);
        }else{
          const provenance={publicationId:pub.id,revision,creatorUid:uid,creator:pub.creator||'Bot creator',license:'personal'};
          await storage.write(storageKey,JSON.stringify({schemaVersion:1,userId:recipientUid,botId:copyBotId,code,venue:pub.venue||'valr',provenance,updatedAt:new Date().toISOString()}));
        }
        const existingMeta=await store.get(metadataPath);
        if(existingMeta){
          if(existingMeta.storage?.key!==storageKey||existingMeta.provenance?.publicationId!==pub.id||existingMeta.provenance?.revision!==revision)throw statusError('An existing library record conflicts with this grant.',409);
        }else{
          await store.create(metadataPath,{name:pub.name,asset:pub.asset,venue:pub.venue||'valr',prompt:pub.description,storage:{provider:'r2',key:storageKey},provenance:{publicationId:pub.id,revision,creatorUid:uid,creator:pub.creator||'Bot creator',license:'personal'},createdAt:now,updatedAt:now});
          const verify=await store.get(metadataPath);
          if(!verify||verify.storage?.key!==storageKey)throw new Error('Recipient library entry could not be verified.');
        }
        await store.transaction!([path,grantKey],([old,grant])=>{
          if(!old||old.ownerUid!==uid||old.status!=='provisioning'||grant?.lease!==lease||grant?.recipientUid!==recipientUid)throw statusError('Grant was changed during approval.',409);
          return {[path]:{...old,status:'approved',updatedAt:Date.now()},[grantKey]:{...grant,status:'active',lease:'',leaseUntil:0,approvedAt:Date.now(),updatedAt:Date.now()}};
        });
        return res.json({status:'approved',botId:copyBotId});
      }catch(cause){
        await store.transaction!([path,grantKey],([old,grant])=>{
          if(!old||old.status!=='provisioning'||grant?.lease!==lease)return {};
          return {[path]:{...old,status:'pending',updatedAt:Date.now()},[grantKey]:{...grant,status:'failed',lease:'',leaseUntil:0,updatedAt:Date.now()}};
        }).catch(()=>{});
        throw cause;
      }
    }catch(cause){return respondError(res,cause)}
  }
  for(const decision of ['approve','reject','revoke'] as const){
    app.post('/api/user-bots/:botId/access-requests/:requestId/'+decision,(req,res)=>{void ownerDecision(req,res,decision)});
  }
  async function openApproved(uid:string,shareId:string){
    const pub=await readPublication(shareId);
    const {id,record}=await findRequest(pub,uid),grant=await store.get(grantPath(id));
    if(!record||record.status!=='approved'||!grant||grant.status!=='active'||grant.recipientUid!==uid)throw statusError('Request access and obtain creator approval first.',403);
    const botId=grant.copyBotId as string,storageKey=storage.root(uid,botId)+'/current.json';
    const [raw,meta]=await Promise.all([storage.read(storageKey),store.get('users/'+uid+'/bots/'+botId)]);
    if(!raw||!meta||meta.storage?.key!==storageKey)throw statusError('Approved robot copy is temporarily unavailable.',503);
    const saved=JSON.parse(raw);
    if(saved.userId!==uid||saved.botId!==botId||saved.provenance?.publicationId!==shareId)throw statusError('Acquired robot failed ownership verification.',409);
    return {id:botId,name:meta.name,asset:meta.asset,venue:meta.venue,prompt:meta.prompt,storageKey,code:saved.code};
  }
  // The legacy direct-copy endpoint is now strictly an approved-grant lookup.
  app.post('/api/shared-bots/:shareId/copy',async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const uid=await storage.uid(req,res);if(!uid)return;
    try {return res.json({bot:await openApproved(uid,req.params.shareId)});}
    catch(cause){return respondError(res,cause)}
  });
}

