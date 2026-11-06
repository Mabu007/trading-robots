import type {Express,Request,Response} from 'express';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {streamText,tool,stepCountIs} from 'ai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {z} from 'zod';
import {selectOpenRouterApiKey} from './openrouter-credentials.ts';
import type {OpenRouterAccounts} from './openrouter-account.ts';
import type {VenueMarketData} from './venue-market-data.ts';
import {GdeltNews,newsTopicSchema,newsSpanSchema} from './gdelt-news.ts';
import {getHyperliquidBook,hyperliquidCoinSchema} from './hyperliquid-book.ts';

export const aiInputSchema=z.object({
 messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().min(1).max(16000)}).strict()).min(1).max(16),
 model:z.string().regex(/^[a-zA-Z0-9_.:/-]{1,200}$/).optional()
}).strict();
const quota=new Map<string,{since:number,count:number}>();
export function registerAIPlatformRoutes(app:Express,deps:{
 uidOrReply:(req:Request,res:Response)=>Promise<string|null>,
 accounts:OpenRouterAccounts,
 market:VenueMarketData,
 news?:GdeltNews
}){
 app.post('/api/ai-sdk/chat',async(req,res)=>{
  const uid=await deps.uidOrReply(req,res);if(!uid)return;
  const parsed=aiInputSchema.safeParse(req.body);
  if(!parsed.success||parsed.data.messages.at(-1)?.role!=='user')return res.status(400).json({error:'Send valid conversation messages ending with a user message.'});
  const now=Date.now(),prior=quota.get(uid),bucket=pr¶»§q«^