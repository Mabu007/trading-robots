import { createHash } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { parseStrategyConfig } from '../src/strategy.ts';

type Dependencies={
 uid:(req:Request,res:Response)=>Promise<string|null>;
 bot:(uid:string,id:string,req:Request)=>Promise<{asset:string;code:string}|null>;
 request?:typeof fetch;
 base?:()=>string|undefined;
 secret?:()=>string|undefined;
};
const botId=(value:string)=>/^[A-Za-z0-9_-]{1,100}$/.test(value);
export function paperInstanceId(uid:string,id:string){return createHash('sha256').update(`valr-paper-v1\0${uid}\0${id}`).digest('hex')}

export function valrPaperRoutes(app:Express,deps:Dependencies){
 const request=deps.request??fetch;
 const invoke=async(uid:string,id:string,action:string,body?:unknown)=>{
  const base=deps.base?.()??process.env.VALR_PAPER_RUNTIME_URL,secret=deps.secret?.()??process.env.VALR_PAPER_INTERNAL_SECRET;
  if(!base||!secret)throw Error('Paper runtime is not configured.');
  const url=new URL(base);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&(url.hostname==='127.0.0.1'||url.hostname==='localhost')))throw Error('Paper runtime URL must use HTTPS.');
  const path=new URL(`/paper/${paperInstanceId(uid,id)}/${action}`,url);
  const response=await request(path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25_000)});
  let result:any;try{result=await response.json()}catch{throw Error('Paper runtime returned an invalid response.')}
  if(!response.ok){if(action==='status'&&result.error==='Paper robot is not deployed')return {deployed:false};throw Error(typeof result.error==='string'?result.error:'Paper runtime request failed.')}
  return {deployed:true,...result};
 };
 const handle=(run:(uid:string,id:string,req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','no-store');const uid=await deps.uid(req,res);if(!uid)return;const id=String(req.params.id);
  if(!botId(id))return res.status(400).json({error:'Invalid robot ID.'});
  try{return res.json(await run(uid,id,req))}catch(error){const message=error instanceof Error?error.message:'Paper request failed.';return res.status(400).json({error:message.slice(0,300)})}
 };
 app.get('/api/valr/bots/:id/paper',handle((uid,id)=>invoke(uid,id,'status')));
 app.post('/api/valr/bots/:id/paper',handle(async(uid,id,req)=>{
  const action=req.body?.action;if(!['deploy','start','stop','reset'].includes(action))throw Error('Invalid paper action.');
  if(action==='reset')return invoke(uid,id,action,{acknowledgePosition:req.body?.acknowledgePosition===true});
  if(action!=='deploy')return invoke(uid,id,action,{});
  const bot=await deps.bot(uid,id,req);if(!bot)throw Error('Save your robot before deploying.');
  const config=parseStrategyConfig(bot.code);
  const {balance,allocation,riskPercent,dailyLossPercent}=req.body??{};
  if(![balance,allocation,riskPercent,dailyLossPercent].every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)))throw Error('Enter valid paper balance and risk limits.');
  if(riskPercent>config.riskPercent)throw Error('Paper risk cannot exceed the strategy riskPercent.');
  return invoke(uid,id,'deploy',{pair:bot.asset,code:bot.code,balance,allocation,riskPercent,dailyLossPercent});
 }));
}
