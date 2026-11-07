import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import type {RecordData,RecordStore} from './firestore-store.ts';

const mock=vi.hoisted(()=>({
 list:vi.fn(),execute:vi.fn(),getRawComposioToolBySlug:vi.fn(),getRawComposioTools:vi.fn(),
}));
vi.mock('@composio/core',()=>({Composio:class {
 connectedAccounts={list:mock.list};
 tools={execute:mock.execute,getRawComposioToolBySlug:mock.getRawComposioToolBySlug,getRawComposioTools:mock.getRawComposioTools};
}}));
import {connectedAppTools,registerComposioApps} from './composio-apps.ts';
import {FirestoreStore} from './firestore-store.ts';

describe('connected app review',()=>{
 it('binds a write to the exact owner, account, version and arguments and executes only once',async()=>{
  vi.stubEnv('COMPOSIO_API_KEY','fixture');
  vi.spyOn(FirestoreStore,'configured').mockReturnValue(true);
  const entries=new Map<string,RecordData>();
  const store:RecordStore={
   get:async key=>entries.get(key)||null,put:async(key,value)=>{entries.set(key,value);},
   create:async(key,value)=>{if(entries.has(key))return false;entries.set(key,value);return true;},
   query:async()=>[],transaction:async(paths,change)=>{const writes=change(paths.map(path=>entries.get(path)||null));for(const [key,value] of Object.entries(writes))entries.set(key,value);}
  };
  const slug='TELEGRAM_SEND_MESSAGE';
  mock.list.mockImplementation(async query=>({items:query.userIds[0]==='trading-vibes:alice'?[{id:'ca_owned',toolkit:{slug:'telegram'},status:'ACTIVE',authConfig:{isDisabled:false},isDisabled:false,alias:'Alerts'}]:[]}));
  mock.getRawComposioToolBySlug.mockResolvedValue({slug,toolkit:{slug:'telegram'},version:'20261001'});
  mock.execute.mockResolvedValue({successful:true,data:{messageId:'fixture',access_token:'hidden'}});
  const app=express().use(express.json());
  registerComposioApps(app,async(req,res)=>{const owner=req.header('X-Test-User');if(owner)return owner;res.status(401).end();return null;},store);
  const server=app.listen(0);
  try{
   const addr=server.address();if(!addr||typeof addr==='string')throw Error('Listener unavailable');
   const decision=(id:string,choice:string,uid='alice')=>fetch('http://127.0.0.1:'+addr.port+'/api/apps/actions/'+id+'/'+choice,{method:'POST',headers:{'X-Test-User':uid}});
   const tools=connectedAppTools('alice',store,new AbortController().signal);
   const ask=async(account='ca_owned')=>await tools.requestConnectedAppAction!.execute!({slug,account,args:{chat_id:'123',text:'Trading Vibes QA'}},{toolCallId:'fixture',messages:[],context:{}}) as {approvalId:string;requiresApproval?:boolean};
   expect(await ask('ca_other')).not.toHaveProperty('approvalId');
   const denied=await ask();
   expect(denied.requiresApproval).toBe(true);
   expect((await decision(denied.approvalId,'approve','bob')).status).toBe(409);
   expect((await decision(denied.approvalId,'deny')).status).toBe(200);
   expect((await decision(denied.approvalId,'approve')).status).toBe(409);
   expect(mock.execute).not.toHaveBeenCalled();
   const approved=await ask();
   const result=await decision(approved.approvalId,'approve');
   expect(result.status).toBe(200);
   expect(await result.text()).not.toContain('hidden');
   expect(mock.execute).toHaveBeenCalledWith(slug,{userId:'trading-vibes:alice',connectedAccountId:'ca_owned',arguments:{chat_id:'123',text:'Trading Vibes QA'},version:'20261001'},expect.anything());
   expect((await decision(approved.approvalId,'approve')).status).toBe(409);
   expect(mock.execute).toHaveBeenCalledTimes(1);
  }finally{server.close();vi.restoreAllMocks();vi.unstubAllEnvs();}
 });
});
