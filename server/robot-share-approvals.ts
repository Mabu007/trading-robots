import type { Express, Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { RecordStore } from './firestore-store.ts';
import { requestLimit } from './request-limits.ts';

type Auth = (req: Request, res: Response) => Promise<string | null>;
type Published = {
  id:string;ownerUid:string;botId:string;name:string;description:string;asset:string;
  venue?:string;code?:string;codeHash?:string;revisionHash?:string;published:boolean;creator?:string;
};
type Revision = {code:string;codeHash:string;revisionHash:string;asset:string;venue:string};
type AccessRequest = {
  id:string;shareId:string;botId:string;ownerUid:string;requesterUid:string;requesterName:string;
  revisionHash:string;codeHash:string;name:string;description:string;asset:string;venue:string;creator:string;
  copyId:string;status:'pending'|'approved'|'rejected'|'revoked';createdAt:number;updatedAt:number;
};
export type RobotShareDeps = {
  uid: Auth;store:RecordStore;read:(key:string)=>Promise<string|null>;write:(key:string,value:string)=>Promise<void>;
  root:(uid:string,botId:string)=>string;
};
const sha = (value:string) => createHash('sha256').update(value).digest('hex');
const validShare = (id:string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
const validBot = (id:string) => /^[A-Za-z0-9_-]{1,100}$/.test(id);
const validRequest = (id:string) => /^[a-f0-9]{64}$/.test(id);
const requestPath = (id:string) => 'robotShareRequests/'+id;
const grantPath = (id:string) => 'robotShareGrants/'+id;
const publishedKey = (id:string) => 'shared-bots/v1/'+id+'.json';
export const robotRevisionKey = (id:string,revisionHash:string) => 'shared-bots/v1/'+id+'/revisions/'+revisionHash+'.json';
export function robotRevisionHash(code:string,venue:string,asset:string){
  return sha(JSON.stringify({code,venue,asset}));
}
const publicStatus = (record:AccessRequest|null) => record ? {
  status:record.status,revisionHash:record.revisionHash,
  ...(record.status==='approved'?{botId:record.copyId}:{})
} : {status:'none' as const};

export function robotShareApprovalRoutes(app:Express,deps:RobotShareDeps){
  const readPublished = async(id:string):Promise<Published|null>=>{
    const raw=await deps.read(publishedKey(id));
    return raw?JSON.parse(raw) as Published:null;
  };
  const readRevision = async(shared:Published,revisionHash:string):Promise<Revision>=>{
    const raw=await deps.read(robotRevisionKey(shared.id,revisionHash));
    if(raw){
      const rev=JSON.parse(raw) as Revision;
      if(!rev||rev.revisionHash!==revisionHash||!['valr','propdao','ctrader'].includes(rev.venue)||typeof rev.code!=='string'||sha(rev.code)!==rev.codeHash||robotRevisionHash(rev.code,rev.venue,rev.asset)!==revisionHash)throw Error('Published revision integrity failed.');
      return rev;
    }
    // Older public links saved their code inside the publication. Migration is read-only.
    if(shared.code&&typeof shared.code==='string'){
      const venue=shared.venue||'valr';
      if(robotRevisionHash(shared.code,venue,shared.asset)===revisionHash)
        return {code:shared.code,venue,asset:shared.asset,codeHash:sha(shared.code),revisionHash};
    }
    throw Error('The requested robot revision is no longer available.');
  };
  const shareOr404 = async(id:string,res:Response)=>{
    if(!validShare(id)){res.status(404).json({error:'Robot link unavailable.'});return null}
    const published=await readPublished(id);
    if(!published?.published){res.status(404).json({error:'Robot link is private or unavailable.'});return null}
    return published;
  };
  const revisionId = (p:Published)=>p.revisionHash||(typeof p.code==='string'?robotRevisionHash(p.code,p.venue||'valr',p.asset):'');
  const forVisitor = async(p:Published,uid:string)=>{
    const hash=revisionId(p);
    if(!hash)throw Error('The published revision is incomplete.');
    const id=sha(p.id+':'+hash+':'+uid);
    const value=await deps.store.get(requestPath(id)) as AccessRequest|null;
    return {id,value};
  };

  app.get('/api/shared-bots/:shareId/access',async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const uid=await deps.uid(req,res);if(!uid)return;
    try{
      const pub=await shareOr404(req.params.shareId,res);if(!pub)return;
      const {value}=await forVisitor(pub,uid);
      return res.json(publicStatus(value));
    }catch{return res.status(503).json({error:'Could not verify access. Retry later.'})}
  });
  app.post('/api/shared-bots/:shareId/request',requestLimit,async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const uid=await deps.uid(req,res);if(!uid)return;
    try{
      const pub=await shareOr404(req.params.shareId,res);if(!pub)return;
      if(pub.ownerUid===uid)return res.status(409).json({error:'You already own this robot.'});
      if(pub.access&&pub.access!=='free')return res.status(409).json({error:'This robot cannot accept access requests.'});
      const revisionHash=revisionId(pub);
      const revision=await readRevision(pub,revisionHash);
      const {id,value}=await forVisitor(pub,uid);
      if(value)return res.json(publicStatus(value));
      const identity=res.locals.identity as {name?:string;email?:string}|undefined;
      const requesterName=String(identity?.name||identity?.email?.split('@')[0]||'Trading Vibes user').slice(0,80);
      const now=Date.now();
      const record:AccessRequest={
        id,shareId:pub.id,botId:pub.botId,ownerUid:pub.ownerUid,requesterUid:uid,
        requesterName,revisionHash,codeHash:revision.codeHash,
        name:pub.name,description:pub.description,asset:revision.asset,venue:revision.venue,
        creator:pub.creator||'Bot creator',copyId:'shared-'+randomUUID(),
        status:'pending',createdAt:now,updatedAt:now
      };
      const created=await deps.store.create(requestPath(id),record);
      return res.status(created?201:200).json(publicStatus(created?record:await deps.store.get(requestPath(id)) as AccessRequest|null));
    }catch{return res.status(503).json({error:'Could not request robot access. Retry later.'})}
  });
  app.get('/api/user-bots/:botId/access-requests',async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const uid=await deps.uid(req,res);if(!uid)return;
    if(!validBot(req.params.botId))return res.status(400).json({error:'Invalid robot.'});
    try{
      const requests=(await deps.store.query('robotShareRequests','ownerUid',uid) as AccessRequest[])
        .filter(row=>row.botId===req.params.botId)
        .sort((a,b)=>b.createdAt-a.createdAt).slice(0,100)
        .map(row=>({id:row.id,shareId:row.shareId,requesterName:row.requesterName,revisionHash:row.revisionHash,status:row.status,createdAt:row.createdAt,updatedAt:row.updatedAt}));
      return res.json({requests});
    }catch{return res.status(503).json({error:'Could not load access requests.'})}
  });
  for(const action of ['approve','reject','revoke'] as const){
    app.post('/api/user-bots/:botId/access-requests/:requestId/'+action,requestLimit,async(req,res)=>{
      res.setHeader('Cache-Control','private, no-store');
      const uid=await deps.uid(req,res);if(!uid)return;
      const id=req.params.requestId,botId=req.params.botId;
      if(!validBot(botId)||!validRequest(id))return res.status(400).json({error:'Invalid access request.'});
      try{
        const path=requestPath(id),record=await deps.store.get(path) as AccessRequest|null;
        if(!record||record.ownerUid!==uid||record.botId!==botId)return res.status(404).json({error:'Access request not found.'});
        if(action==='approve'){
          if(record.status==='rejected'||record.status==='revoked')return res.status(409).json({error:'This request is closed.'});
          if(record.status==='approved')return res.json({status:'approved'});
          const pub=await shareOr404(record.shareId,res);if(!pub)return;
          if(pub.ownerUid!==uid||pub.botId!==botId)return res.status(409).json({error:'Publication ownership changed.'});
          const revision=await readRevision(pub,record.revisionHash);
          if(revision.codeHash!==record.codeHash||revision.venue!==record.venue||revision.asset!==record.asset)throw Error('Published revision changed.');
          const copyKey=deps.root(record.requesterUid,record.copyId)+'/current.json';
          const existing=await deps.read(copyKey);
          if(existing){
            const copy=JSON.parse(existing);
            if(copy.userId!==record.requesterUid||copy.botId!==record.copyId||copy.originalRevision!==record.revisionHash)throw Error('Recipient copy ownership collision.');
          }else{
            await deps.write(copyKey,JSON.stringify({schemaVersion:1,userId:record.requesterUid,botId:record.copyId,code:revision.code,venue:revision.venue,originalRevision:record.revisionHash,updatedAt:new Date().toISOString()}));
          }
          const botPath='users/'+record.requesterUid+'/bots/'+record.copyId;
          const grant=grantPath(id);
          await deps.store.transaction?.([path,botPath,grant],([current,bot,oldGrant])=>{
            const reqRow=current as AccessRequest|null;
            if(!reqRow||reqRow.ownerUid!==uid||reqRow.botId!==botId||reqRow.revisionHash!==record.revisionHash)throw Error('Request changed during approval.');
            if(reqRow.status==='approved')return {};
            if(reqRow.status!=='pending')throw Error('Request is no longer pending.');
            if(bot||oldGrant)throw Error('The recipient already has a conflicting copy.');
            const now=Date.now();
            return {
              [path]:{...reqRow,status:'approved',updatedAt:now},
              [botPath]:{name:reqRow.name.slice(0,64),asset:reqRow.asset,venue:reqRow.venue,prompt:reqRow.description.slice(0,12000),storage:{provider:'r2',key:copyKey},provenance:{shareId:reqRow.shareId,ownerUid:uid,originalBotId:botId,revisionHash:reqRow.revisionHash,codeHash:reqRow.codeHash,redistribution:false},createdAt:now,updatedAt:now},
              [grant]:{id,shareId:reqRow.shareId,requesterUid:reqRow.requesterUid,ownerUid:uid,botId:reqRow.copyId,revisionHash:reqRow.revisionHash,status:'active',createdAt:now,updatedAt:now}
            };
          });
          return res.json({status:'approved'});
        }
        if(action==='reject'&&record.status==='approved')return res.status(409).json({error:'Approved access can only be revoked.'});
        if(action==='revoke'&&record.status!=='approved'&&record.status!=='revoked')return res.status(409).json({error:'Only granted access can be revoked.'});
        const next=action==='reject'?'rejected':'revoked',grant=grantPath(id);
        await deps.store.transaction?.(action==='revoke'?[path,grant]:[path],([current,oldGrant])=>{
          const row=current as AccessRequest|null;
          if(!row||row.ownerUid!==uid||row.botId!==botId)throw Error('Request ownership changed.');
          if(row.status===next)return {};
          if(action==='reject'&&row.status!=='pending')throw Error('Request is no longer pending.');
          if(action==='revoke'&&row.status!=='approved')throw Error('Access is no longer active.');
          const now=Date.now();
          return {[path]:{...row,status:next,updatedAt:now},
            ...(action==='revoke'&&oldGrant?{[grant]:{...oldGrant,status:'revoked',updatedAt:now}}:{})};
        });
        return res.json({status:next});
      }catch(error){
        return res.status(409).json({error:error instanceof Error?error.message:'Access decision could not be saved.'});
      }
    });
  }
  return {
    async grantedCopy(uid:string,shareId:string){
      if(!validShare(shareId))return null;
      const pub=await readPublished(shareId);
      if(!pub)return null;
      const {value}=await forVisitor(pub,uid);
      if(!value||value.status!=='approved')return null;
      const grant=await deps.store.get(grantPath(value.id));
      if(!grant||grant.status!=='active'||grant.requesterUid!==uid||grant.botId!==value.copyId)return null;
      const doc=await deps.store.get('users/'+uid+'/bots/'+value.copyId);
      if(!doc||doc.provenance?.revisionHash!==value.revisionHash)return null;
      return {id:value.copyId,name:doc.name,asset:doc.asset,venue:doc.venue,prompt:doc.prompt,storageKey:deps.root(uid,value.copyId)+'/current.json'};
    }
  };
}
