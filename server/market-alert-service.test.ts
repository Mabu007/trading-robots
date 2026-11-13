import {createHash} from 'node:crypto';
const ownerHash=(v:string)=>createHash('sha256').update(v).digest('hex');
import {it,expect} from 'vitest';
import {MarketAlertService} from './market-alert-service';
const make=()=>{const data=new Map<string,any>();const store={remove:async(p:string)=>{data.delete(p)},get:async(p:string)=>data.get(p)||null,put:async(p:string,v:any)=>{data.set(p,v)},create:async(p:string,v:any)=>{if(data.has(p))return false;data.set(p,v);return true},query:async(p:string)=>[...data].filter(([k])=>k.startsWith(p+'/')).map(([,v])=>v),transaction:async(paths:string[],fn:any)=>{const changed=fn(paths.map(p=>data.get(p)||null));for(const [p,v]of Object.entries(changed))data.set(p,v)}};let sends=0;const request=async()=>{sends++;return Response.json({ok:true,result:{message_id:123}})};const env={TELEGRAM_BOT_TOKEN:'secret',TELEGRAM_BOT_USERNAME:'vibes_bot',TELEGRAM_WEBHOOK_SECRET:'w'.repeat(32)};const svc=new MarketAlertService({store,env,uid:async()=> 'alice',accounts:{} as any,read:async()=>null,request:request as any});return {svc,data,sends:()=>sends};};
const rule={name:'Gold',symbol:'XAUUSD',timeframe:'m5',mode:'all',conditions:[{id:'c1',kind:'above',value:100}],notifyStages:false,cooldownSeconds:300,sequenceSeconds:600,expiresAt:Math.floor(Date.now()/1000)+86400,repeat:true,session:null,basis:'completed-candle',strategy:null};
it('links single-use tokens to one private owner and disconnect revokes both directions',async()=>{const {svc,data}=make();const link=await svc.linking('alice'),token=new URL(link.url).searchParams.get('start')!;await svc.connect('123',token);await expect(svc.connect('123',token)).rejects.toThrow();expect(data.get('serverTelegramUsers/'+ownerHash('alice')).active).toBe(true);await svc.disconnect('alice');expect(data.get('telegramChats/123').active).toBe(false);});
it('refuses expired tokens and replacing another active chat owner',async()=>{const {svc,data}=make();const link=await svc.linking('alice'),token=new URL(link.url).searchParams.get('start')!;for(const [k,v]of data)if(k.startsWith('telegramLinks/'))v.expiresAt=0;await expect(svc.connect('123',token)).rejects.toThrow();});
it('keeps drafts isolated; rejects forged source references and stale activation revisions',async()=>{const {svc}=make();const row=await svc.draft('alice',rule);expect((await svc.list('bob')).alerts).toEqual([]);await expect(svc.status('bob',row.id)).rejects.toThrow();await expect(svc.control('alice',row.id,'start','wrong')).rejects.toThrow(/Review/);await expect(svc.draft('alice',{...rule,strategy:{id:'robot',sourceHash:'a'.repeat(64)}})).rejects.toThrow();});
it('persists a delivery claim before sending, and never resends accepted or uncertain messages',async()=>{const {svc,data,sends}=make();const row=await svc.draft('alice',rule);data.set(svc.path('alice',row.id),{...row,deliveryAuthorized:true});data.set('serverTelegramUsers/'+ownerHash('alice'),{active:true,chatId:'123'});const input={uid:'alice',id:row.id,revision:row.revision,event:{id:row.revision+':event',time:Math.floor(Date.now()/1000),price:105,matched:['c1'],complete:true}};expect((await svc.deliver(input)).delivery).toBe('sent');expect((await svc.deliver(input)).delivery).toBe('sent');expect(sends()).toBe(1);await svc.control('alice',row.id,'pause').catch(()=>{});expect((await svc.deliver({...input,event:{...input.event,id:row.revision+':second'}})).delivery).toBe('cancelled');expect(sends()).toBe(1);});

it('does not grant delivery permission when a saved strategy revision cannot be validated',async()=>{const {svc,data,sends}=make();const id='a'.repeat(32),revision='b'.repeat(64),path=svc.path('alice',id);data.set(path,{id,revision,state:'draft',deliveryAuthorized:false,rule:{...rule,strategy:{id:'missing',sourceHash:'c'.repeat(64)}}});data.set('serverTelegramUsers/'+ownerHash('alice'),{active:true,chatId:'123'});await expect(svc.control('alice',id,'start',revision)).rejects.toThrow(/source unavailable/);expect(data.get(path).deliveryAuthorized).toBe(false);expect(data.get(path).state).toBe('draft');expect(sends()).toBe(0);});

it('shows only confirmed Telegram signals to their owner without conflating drafts or failed deliveries',async()=>{
 const {svc,data}=make();
 const row=await svc.draft('alice',rule);
 data.set(svc.path('alice',row.id),{...row,deliveryAuthorized:true});
 data.set('serverTelegramUsers/'+ownerHash('alice'),{active:true,chatId:'123'});
 const event={id:row.revision+':signal-1',time:Math.floor(Date.now()/1000),price:3953.2,action:'BUY',matched:['c1'],complete:true};
 expect(await svc.deliver({uid:'alice',id:row.id,revision:row.revision,event})).toMatchObject({delivery:'sent'});
 const own=await svc.signalHistory('alice');
 expect(own.signals).toHaveLength(1);
 expect(own.signals[0]).toMatchObject({name:'Gold',symbol:'XAUUSD',action:'BUY',price:3953.2,delivery:'sent'});
 expect((await svc.signalHistory('bob')).signals).toHaveLength(0);
 data.set('serverMarketAlertOwners/'+ownerHash('alice')+'/deliveries/'+ownerHash('failed'),{alertId:row.id,delivery:'failed',event:{...event,id:row.revision+':failed'}});
 expect((await svc.signalHistory('alice')).signals).toHaveLength(1);
 await expect(svc.signalHistory('alice','malformed')).rejects.toThrow(/cursor/);
});

it('rejects monitoring review if the saved source differs from the tested revision',async()=>{
 const {svc,data}=make();
 const code='export const config = {timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2}; export function onCandle(ctx){return {action:"WAIT"};}';
 data.set('users/alice/bots/gold',{name:'Gold strategy',asset:'XAUUSD'});
 (svc as any).deps.read=async()=>JSON.stringify({userId:'alice',botId:'gold',code});
 await expect(svc.strategyDraft('alice','gold','0'.repeat(64))).rejects.toThrow(/changed since the backtest/);
 const row=await svc.strategyDraft('alice','gold',ownerHash(code));
 expect(row.rule.strategy).toEqual({id:'gold',sourceHash:ownerHash(code)});
 expect(row.rule.name).toBe('Gold strategy');
});

it('exposes failed and unconfirmed deliveries only when all alert events are requested',async()=>{
 const {svc,data}=make();const root='serverMarketAlertOwners/'+ownerHash('alice')+'/deliveries/';
 const event={id:'event-1',time:Math.floor(Date.now()/1000),price:100};
 data.set(root+'a',{alertId:'a',delivery:'failed',event});
 data.set(root+'b',{alertId:'b',delivery:'unknown',event:{...event,id:'event-2'}});
 expect((await svc.signalHistory('alice')).signals).toHaveLength(0);
 expect((await svc.signalHistory('alice',undefined,true)).signals.map(row=>row.delivery).sort()).toEqual(['failed','unknown']);
 expect((await svc.signalHistory('bob',undefined,true)).signals).toHaveLength(0);
});
