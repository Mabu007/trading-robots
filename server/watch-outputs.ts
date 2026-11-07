import {createHash,timingSafeEqual} from 'node:crypto';
import type {Express} from 'express';
import {z} from 'zod';
import type {RecordStore} from './firestore-store.ts';
import {intervalMs,isTimeframe} from './market-data.ts';
import type {OpenRouterAccounts} from './openrouter-account.ts';
import {telegramWatchOutput,validateTelegramWatchAccount} from './composio-apps.ts';

export const watchOutputSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('log')}).strict(),
 z.object({type:z.literal('ai')}).strict(),
 z.object({type:z.literal('telegram'),account:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),destination:z.string().regex(/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/)}).strict(),
]);
export type WatchOutput=z.infer<typeof watchOutputSchema>;
const eventSchema=z.object({
 id:z.string().min(12).max(220),time:z.number().int().positive(),kind:z.string().min(1).max(50),
 level:z.number().finite(),price:z.number().finite().positive()
}).strict();
const scope=(uid:string,id:string)=>createHash('sha256').update(uid+'\0'+id).digest('hex');
const outputPath=(uid:string,id:string)=>'serverWatchOutputs/'+scope(uid,id);
type OutputRecord={uid:string;id:string;asset:string;timeframe:string;startedAt:number;active:boolean;output:WatchOutput};

export function watchOutputs(app:Express,store:RecordStore,accounts:OpenRouterAccounts){
 const read=async(uid:string,id:string)=>await store.get(outputPath(uid,id)) as OutputRecord|null;
 app.post('/api/internal/code-watch-event',async(req,res)=>{
  const secret=process.env.CODE_WATCH_INTERNAL_SECRET||'';
  const header=Buffer.from(req.header('authorization')||''),expected=Buffer.from('Bearer '+secret);
  if(process.env.CODE_WATCH_OUTPUTS_ENABLED!=='true'||secret.length<32||header.length!==expected.length||!timingSafeEqual(header,expected))return res.status(401).json({error:'Internal access required.'});
  const {uid,id,outputVersion}=req.body||{};
  const event=eventSchema.safeParse(req.body?.event);
  if(typeof uid!=='string'||uid.length>128||typeof id!=='string'||!/^analysis-[a-z0-9_-]{8,110}$/.test(id)||!event.success||!event.data.id.startsWith(id+':'+event.data.time+':'))return res.status(400).json({error:'Invalid monitor event.'});
  try{
   const plan=await read(uid,id);
   if(!plan?.active||plan.uid!==uid||plan.id!==id||plan.startedAt!==outputVersion||plan.output.type==='log')return res.json({status:'skipped'});
   const now=Date.now(),time=event.data.time*1000;
   if(!isTimeframe(plan.timeframe)||time+intervalMs[plan.timeframe]<=plan.startedAt||time>now||now-time>3_600_000)return res.json({status:'skipped'});
   const key='serverWatchOutputLimits/'+scope(uid,id);
   const receipt='serverWatchOutputReceipts/'+scope(uid,event.data.id);
   if(!store.transaction)throw Error('Event approval storage unavailable.');
   let eligible=false;
   await store.transaction([key,receipt],([previous,seen])=>{
    eligible=false;
    if(seen||now-Number(previous?.at||0)<900_000)return {};
    eligible=true;
    return {[key]:{at:now},[receipt]:{uid,watchId:id,eventId:event.data.id,at:now,state:'claimed'}};
   });
   if(!eligible)return res.json({status:'skipped'});
   const text=`Trading Vibes • ${plan.asset} ${plan.timeframe.toUpperCase()} • ${event.data.kind} at ${new Date(time).toISOString()}. Reference price ${event.data.price}, level ${event.data.level}. Hyperliquid completed candles. This is a monitor event.`;
   let result='';
   try{
    const current=await read(uid,id);
    if(!current?.active||current.startedAt!==plan.startedAt)throw Error('Monitor authorization changed.');
    if(plan.output.type==='telegram'){
     const sent=await telegramWatchOutput(uid,plan.output.account,plan.output.destination,text);
     if(!sent.available)throw Error('Telegram did not confirm delivery.');
     result='Telegram delivery confirmed.';
    }else{
     const account=await accounts.load(uid);
     if(!account)throw Error('OpenRouter connection unavailable.');
     const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+account.apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(15_000),
      body:JSON.stringify({model:account.model,max_tokens:250,messages:[{role:'system',content:'Explain this single read-only market monitor event in two sentences. Use only its reported facts. Do not recommend or execute a trade.'},{role:'user',content:text}]})});
     const body=await response.json().catch(()=>null) as {choices?:{message?:{content?:unknown}}[]}|null;
     result=typeof body?.choices?.[0]?.message?.content==='string'?body.choices[0].message.content.trim().slice(0,1200):'';
     if(!response.ok||!result)throw Error('AI did not return a summary.');
    }
    await store.put(receipt,{uid,watchId:id,eventId:event.data.id,at:now,state:'completed',result});
    return res.json({status:'completed',result});
   }catch{
    await store.put(receipt,{uid,watchId:id,eventId:event.data.id,at:now,state:'unconfirmed'}).catch(()=>{});
    return res.json({status:'unconfirmed'});
   }
  }catch{return res.status(503).json({error:'Monitor output is unavailable.'})}
 });
 return {
  async start(uid:string,id:string,asset:string,timeframe:string,output:WatchOutput){
   if(output.type==='telegram')await validateTelegramWatchAccount(uid,output.account);
   if(output.type==='ai'&&!await accounts.load(uid))throw Error('Connect your OpenRouter account before enabling AI monitor summaries.');
   const startedAt=Date.now();
   await store.put(outputPath(uid,id),{uid,id,asset,timeframe,startedAt,active:true,output});
   return startedAt;
  },
  async stop(uid:string,id:string){
   const current=await read(uid,id);
   if(current?.active)await store.put(outputPath(uid,id),{...current,active:false});
  }
 };
}
