import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { sharedBotRoutes, validCover } from './shared-bots';
import { shareAccessRoutes } from './robot-access';

describe('request-based robot sharing', () => {
  const objects=new Map<string,string>();
  const records=new Map<string,Record<string,any>>();
  let failNextCopyWrite=false;
  const write=async(key:string,body:string)=>{
    if(failNextCopyWrite&&key.includes('/visitor/')&&key.endsWith('/current.json')){failNextCopyWrite=false;throw Error('Simulated R2 write failure')}
    objects.set(key,body);
  };
  const root=(uid:string,id:string)=>'private/'+uid+'/'+id;
  const store={
    get:async(key:string)=>structuredClone(records.get(key)??null),
    put:async(key:string,value:Record<string,any>)=>{records.set(key,structuredClone(value));},
    create:async(key:string,value:Record<string,any>)=>{if(records.has(key))return false;records.set(key,structuredClone(value));return true;},
    query:async(collection:string,field?:string,value?:string)=>[...records.entries()].filter(([key,record])=>key.startsWith(collection+'/')&&(!field||record[field]===value)).map(([key,record])=>({id:key.split('/').at(-1),...structuredClone(record)})),
    transaction:async(keys:string[],update:(items:(Record<string,any>|null)[])=>Record<string,Record<string,any>>)=>{
      const changes=update(keys.map(key=>structuredClone(records.get(key)??null)));
      for(const [key,value] of Object.entries(changes)){if(!keys.includes(key))throw Error('Untracked transaction');records.set(key,structuredClone(value))}
    }
  };
  const uid=async(req:any,res:any)=>{const value=req.header('x-test-user');if(!value){res.status(401).json({error:'Sign in'});return null}return value};
  const app=express();app.use(express.json());
  const publication=sharedBotRoutes(app,{root,read:async key=>objects.get(key)??null,write,remove:async key=>{objects.delete(key)},uid});
  shareAccessRoutes(app,{store,root,read:async key=>objects.get(key)??null,write,uid});
  let server:Server,base:string;
  const call=async(path:string,method='GET',who?:string,body?:unknown)=>{
    const response=await fetch(base+path,{method,headers:{...(who?{'x-test-user':who}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json() as any};
  };
  const fields={name:'Gold robot',asset:'XAUUSD',description:'A public strategy description.',coverImage:'',access:'free'};
  const save=()=>call('/api/user-bots/robot1/publication','PUT','creator',fields);
  const publicationUrl=(id:string)=>'/api/shared-bots/'+id;
  const ownerUrl='/api/user-bots/robot1/access-requests';
  async function accessRequest(id:string,who='visitor'){
    return call(publicationUrl(id)+'/requests','POST',who,{});
  }
  async function ownerRequests(){
    return (await call(ownerUrl,'GET','creator')).body.requests as Array<{id:string;status:string;requesterName:string}>;
  }
  async function approve(id:string,who='visitor'){
    expect((await accessRequest(id,who)).status).toBe(200);
    const requests=await ownerRequests();
    const record=requests.find(r=>r.status==='pending');
    expect(record).toBeDefined();
    return call(ownerUrl+'/'+record!.id+'/approve','POST','creator',{});
  }
  beforeAll(async()=>{await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve())});base='http://127.0.0.1:'+(server.address() as {port:number}).port});
  afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))});
  beforeEach(()=>{
    objects.clear();records.clear();failNextCopyWrite=false;
    objects.set(root('creator','robot1')+'/current.json',JSON.stringify({userId:'creator',botId:'robot1',venue:'valr',code:'export function onCandle(){return { action: "WAIT" }}'}));
  });

  it('publishes safe public metadata with immutable code snapshot and venue',async()=>{
    const result=await save();expect(result.status).toBe(200);
    const id=result.body.publication.id;
    const page=await call(publicationUrl(id));
    expect(page.status).toBe(200);
    expect(page.body.bot.venue).toBe('valr');
    expect(page.body.bot.revisionId).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(page.body)).not.toContain('onCandle');
    expect(JSON.stringify(page.body)).not.toContain('ownerUid');
    expect([...objects.keys()].some(key=>key.startsWith('shared-bots/revisions/'+id+'/'))).toBe(true);
  });
  it('requires authentication and approval before any copy',async()=>{
    const id=(await save()).body.publication.id;
    expect((await call(publicationUrl(id)+'/copy','POST')).status).toBe(401);
    expect((await call(publicationUrl(id)+'/copy','POST','visitor')).status).toBe(403);
    expect((await call(publicationUrl(id)+'/requests','POST')).status).toBe(401);
    expect((await accessRequest(id,'creator')).status).toBe(403);
    expect((await accessRequest(id)).body.status).toBe('pending');
    expect((await accessRequest(id)).body.status).toBe('pending');
    expect((await ownerRequests()).length).toBe(1);
    expect((await call(publicationUrl(id)+'/copy','POST','visitor')).status).toBe(403);
  });
  it('approves exact revision and creates isolated R2 and Firestore copies',async()=>{
    const id=(await save()).body.publication.id;
    expect((await approve(id)).status).toBe(200);
    expect((await call(publicationUrl(id)+'/my-access','GET','visitor')).body.status).toBe('approved');
    const opened=await call(publicationUrl(id)+'/copy','POST','visitor');
    expect(opened.status).toBe(200);
    const bot=opened.body.bot;
    expect(bot.id).not.toBe('robot1');
    expect(bot.venue).toBe('valr');
    expect(objects.get(bot.storageKey)).toContain('onCandle');
    expect(records.get('users/visitor/bots/'+bot.id)?.storage?.key).toBe(bot.storageKey);
    expect(records.get('users/creator/bots/'+bot.id)).toBeUndefined();
    const repeat=await call(publicationUrl(id)+'/copy','POST','visitor');
    expect(repeat.body.bot.id).toBe(bot.id);
    const requests=await ownerRequests();
    expect((await call(ownerUrl+'/'+requests[0].id+'/approve','POST','creator',{})).status).toBe(200);
    expect([...records.keys()].filter(key=>key.startsWith('users/visitor/bots/'))).toHaveLength(1);
  });
  it('blocks unauthorized approval and supports rejection',async()=>{
    const id=(await save()).body.publication.id;
    await accessRequest(id);
    const [item]=await ownerRequests();
    expect((await call(ownerUrl+'/'+item.id+'/approve','POST','stranger',{})).status).toBe(404);
    expect((await call(ownerUrl+'/'+item.id+'/reject','POST','creator',{})).status).toBe(200);
    expect((await call(publicationUrl(id)+'/my-access','GET','visitor')).body.status).toBe('rejected');
    expect((await call(publicationUrl(id)+'/copy','POST','visitor')).status).toBe(403);
  });
  it('keeps old versions and independent edits after explicit republishing',async()=>{
    const id=(await save()).body.publication.id;
    await approve(id);
    const first=(await call(publicationUrl(id)+'/copy','POST','visitor')).body.bot;
    const data=JSON.parse(objects.get(first.storageKey)!);
    data.code='my edited code';objects.set(first.storageKey,JSON.stringify(data));
    objects.set(root('creator','robot1')+'/current.json',JSON.stringify({userId:'creator',botId:'robot1',venue:'propdao',code:'export function updated(){}'}));
    const republished=await save();expect(republished.status).toBe(200);
    expect(republished.body.publication.id).toBe(id);
    expect((await call(publicationUrl(id)+'/my-access','GET','visitor')).body.status).toBe('none');
    expect((await call(publicationUrl(id)+'/copy','POST','visitor')).status).toBe(403);
    expect((await accessRequest(id)).body.status).toBe('pending');
    const newGrant=await approve(id);
    expect(newGrant.status).toBe(200);
    expect(newGrant.body.botId).not.toBe(first.id);
    expect(objects.get(first.storageKey)).toContain('my edited code');
    expect((await call(publicationUrl(id))).body.bot.venue).toBe('propdao');
  });
  it('keeps independent copies after revocation and unpublishing',async()=>{
    const id=(await save()).body.publication.id;
    await approve(id);
    const old=(await call(publicationUrl(id)+'/copy','POST','visitor')).body.bot;
    const [record]=await ownerRequests();
    expect((await call(ownerUrl+'/'+record.id+'/revoke','POST','creator',{})).status).toBe(200);
    expect((await call(publicationUrl(id)+'/copy','POST','visitor')).status).toBe(403);
    expect(objects.has(old.storageKey)).toBe(true);
    expect(records.has('users/visitor/bots/'+old.id)).toBe(true);
    expect((await call('/api/user-bots/robot1/publication','DELETE','creator')).status).toBe(200);
    expect((await call(publicationUrl(id))).status).toBe(404);
    expect((await accessRequest(id,'other')).status).toBe(409);
    await publication.removePublication('creator','robot1');
    expect((await call(publicationUrl(id))).status).toBe(404);
  });
  it('recovers from an interrupted R2 grant without creating duplicate robots',async()=>{
    const id=(await save()).body.publication.id;
    await accessRequest(id);
    const [record]=await ownerRequests();
    failNextCopyWrite=true;
    expect((await call(ownerUrl+'/'+record.id+'/approve','POST','creator',{})).status).toBe(503);
    expect((await call(publicationUrl(id)+'/my-access','GET','visitor')).body.status).toBe('pending');
    const retry=await call(ownerUrl+'/'+record.id+'/approve','POST','creator',{});
    expect(retry.status).toBe(200);
    expect((await call(publicationUrl(id)+'/copy','POST','visitor')).status).toBe(200);
    expect([...records.keys()].filter(key=>key.startsWith('users/visitor/bots/'))).toHaveLength(1);
  });
  it('refuses to publish hard-coded strategy credentials',async()=>{
    objects.set(root('creator','robot1')+'/current.json',JSON.stringify({userId:'creator',botId:'robot1',venue:'valr',code:'const apiKey = "sk-12345678901234567890"; export function onCandle(){}'}));
    expect((await save()).status).toBe(409);
  });
  it('supports venue metadata and rejects unsafe covers',async()=>{
    objects.set(root('creator','robot1')+'/current.json',JSON.stringify({userId:'creator',botId:'robot1',venue:'ctrader',code:'export function onCandle(){return {action:"WAIT"}}'}));
    const result=await save();
    expect(result.status).toBe(200);
    expect(result.body.publication.venue).toBe('ctrader');
    expect((await call('/api/user-bots/robot1/publication','PUT','creator',{...fields,access:'paid'})).status).toBe(400);
    expect(validCover('https://bad.example/image.svg')).toBe(false);
    expect(validCover('data:image/png;base64,PHN2Z48L3N2Zz4=')).toBe(false);
  });
});
