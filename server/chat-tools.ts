import {generateText,tool,jsonSchema} from 'ai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import type {Express,Request,Response as Reply} from 'express';
import type {OpenRouterAccounts} from './openrouter-account.ts';

// Planning only proposes a capability. The client validates the target and
// requires an explicit review before any account-owned resource is changed.
export const chatTools = ['backtest','status','deploy','stop','edit','create','find_code','analyze_market','watch','manage_skill','edit_personality','rename_code','delete_code','manage_broker'] as const;
export type ChatTool = typeof chatTools[number];
const descriptions:Record<ChatTool,string>={
 backtest:'Run a saved named strategy backtest and show the results.',
 status:'Read the selected agent runtime status and errors.',
 deploy:'Prepare deployment review. This does not authorize execution.',
 stop:'Prepare a stop confirmation. This does not stop or close positions.',
 edit:'Propose an explicitly requested strategy code change for user review. Never use for explanation questions.',
 create:'Prepare a new trading strategy for review before saving.',
 find_code:'Find or read the user-owned saved Code library, including requests to explain a named code item.',
 analyze_market:'Run a read-only historical market analysis using validated candles.',
 watch:'Prepare an approval request for an always-on read-only Code monitor.',
 manage_skill:'Propose creating, editing, or deleting a user-owned Skill. Return the complete instructions for a new skill, or only explicitly requested fields for an edit.',
 edit_personality:'Propose the complete updated AI personality profile, preserving preferences the user did not ask to remove.',
 rename_code:'Propose renaming one named saved Code item.',
 delete_code:'Propose deleting one named saved Code item. Never execute the deletion.',
 manage_broker:'Help the user connect, inspect, or disconnect a supported broker using a separate confirmation or connection dialog.'
};
const stringField={type:'string'};
const actionSchemas:Partial<Record<ChatTool,Record<string,unknown>>> = {
 manage_skill:{type:'object',properties:{action:{type:'string',enum:['create','update','delete']},name:stringField,newName:stringField,instructions:stringField,description:stringField,triggers:{type:'array',items:stringField},alwaysOn:{type:'boolean'},enabled:{type:'boolean'}},required:['action','name'],additionalProperties:false},
 edit_personality:{type:'object',properties:{instructions:stringField},required:['instructions'],additionalProperties:false},
 rename_code:{type:'object',properties:{name:stringField,newName:stringField},required:['name','newName'],additionalProperties:false},
 delete_code:{type:'object',properties:{name:stringField},required:['name'],additionalProperties:false},
 manage_broker:{type:'object',properties:{action:{type:'string',enum:['connect','inspect','disconnect']},broker:{type:'string',enum:['propdao','ctrader','valr']}},required:['action','broker'],additionalProperties:false}
};
export const toolDefinitions=chatTools.map(name=>({type:'function',function:{name,description:descriptions[name],parameters:actionSchemas[name]||{type:'object',properties:{},additionalProperties:false}}}));
type Planned={tool:ChatTool|null;args:Record<string,unknown>};
export function parsePlannedAction(message:any):Planned{
 const calls=message?.tool_calls;
 if(calls===undefined||Array.isArray(calls)&&calls.length===0)return {tool:null,args:{}};
 if(!Array.isArray(calls)||calls.length!==1)throw Error('Choose one action at a time.');
 const call=calls[0],name=call?.function?.name as ChatTool;
 if(call?.type!=='function'||!chatTools.includes(name))throw Error('Unsupported AI tool.');
 let args:any;try{args=JSON.parse(call.function.arguments)}catch{throw Error('Invalid AI tool arguments.')}
 if(!args||Array.isArray(args)||typeof args!=='object')throw Error('Invalid AI tool arguments.');
 const allowed:Partial<Record<ChatTool,string[]>>={manage_skill:['action','name','newName','instructions','description','triggers','alwaysOn','enabled'],edit_personality:['instructions'],rename_code:['name','newName'],delete_code:['name'],manage_broker:['action','broker']};
 if(Object.keys(args).some(k=>!(allowed[name]||[]).includes(k)))throw Error('Invalid AI tool arguments.');
 const bounded=(value:unknown,max:number,allowEmpty=false)=>typeof value==='string'&&value.length<=max&&(allowEmpty||value.trim().length>0);
 if(name==='manage_skill'){
  if(!['create','update','delete'].includes(args.action)||!bounded(args.name,80))throw Error('Invalid skill action.');
  if(args.action==='create'&&!bounded(args.instructions,16000))throw Error('New skills require instructions.');
  if(args.newName!==undefined&&(args.action!=='update'||!bounded(args.newName,80))||args.instructions!==undefined&&!bounded(args.instructions,16000)||args.description!==undefined&&!bounded(args.description,240,true)||args.triggers!==undefined&&(!Array.isArray(args.triggers)||args.triggers.length>12||args.triggers.some((v:unknown)=>!bounded(v,70)))||args.alwaysOn!==undefined&&typeof args.alwaysOn!=='boolean'||args.enabled!==undefined&&typeof args.enabled!=='boolean')throw Error('Invalid skill details.');
 }else if(name==='edit_personality'){if(!bounded(args.instructions,4000,true))throw Error('Invalid personality.')}
 else if(name==='rename_code'){if(!bounded(args.name,80)||!bounded(args.newName,64))throw Error('Invalid code name.')}
 else if(name==='delete_code'){if(!bounded(args.name,80))throw Error('Invalid code name.')}
 else if(name==='manage_broker'){if(!['connect','inspect','disconnect'].includes(args.action)||!['propdao','ctrader','valr'].includes(args.broker))throw Error('Invalid broker action.')}
 return {tool:name,args};
}
export function parseToolSelection(message:any):ChatTool|null{return parsePlannedAction(message).tool}
export function chatToolRoutes(app:Express,accounts:OpenRouterAccounts,authenticate:(req:Request,res:Reply)=>Promise<string|null>,request:typeof fetch=fetch){
 // SDK planner only proposes an action; it cannot execute or approve one.
 app.post('/api/chat/sdk-plan',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const uid=await authenticate(req,res);if(!uid)return;
  const {message,model,skills,personality}=req.body||{};
  if(typeof message!=='string'||!message.trim()||message.length>12000)return res.status(400).json({error:'Send a message under 12,000 characters.'});
  if(model!==undefined&&(typeof model!=='string'||!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(model)))return res.status(400).json({error:'Choose a valid OpenRouter model.'});
  const skillNames=Array.isArray(skills)?skills.filter((v:unknown)=>typeof v==='string'&&v.length<=80).slice(0,50):[];
  const profile=typeof personality==='string'?personality.slice(0,4000):'';
  try{
   const account=await accounts.load(uid);if(!account)return res.status(409).json({error:'Connect OpenRouter in Apps.'});
   if(model&&!(await accounts.models()).some(m=>m.id===model))return res.status(400).json({error:'This model is not in the current OpenRouter catalogue.'});
   const provider=createOpenAICompatible({name:'openrouter',baseURL:'https://openrouter.ai/api/v1',apiKey:account.apiKey,fetch:request});
   const tools=Object.fromEntries(toolDefinitions.map(def=>[def.function.name,tool({description:def.function.description,inputSchema:jsonSchema(def.function.parameters as any)})]));
   const abort=new AbortController();
   res.once('close',()=>abort.abort());
   if(res.destroyed)return;
   const result=await generateText({model:provider.chatModel(model||account.model),temperature:0,maxOutputTokens:1800,maxRetries:0,
    instructions:'Select a tool only when the user explicitly requests that action. General education and explanation need no tool, except use find_code for questions about named saved source. Never claim an action happened or infer approval. Changes to skills, personality, code or brokers require a review; never execute them. Skill names: '+JSON.stringify(skillNames)+'. Existing personality: '+JSON.stringify(profile),
    prompt:message,tools,toolChoice:'auto',abortSignal:AbortSignal.any([abort.signal,AbortSignal.timeout(30000)])});
   const calls=result.toolCalls.map(call=>({type:'function',function:{name:call.toolName,arguments:JSON.stringify(call.input)}}));
   const plan=parsePlannedAction({tool_calls:calls});
   return res.json({tool:plan.tool,...(Object.keys(plan.args).length?{args:plan.args}:{}),requiresConfirmation:['deploy','stop','edit','create','manage_skill','edit_personality','rename_code','delete_code','manage_broker'].includes(plan.tool||'')});
  }catch{return res.status(502).json({error:'AI tool selection failed. No action was executed.'})}
 });
 app.post('/api/chat/plan',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const uid=await authenticate(req,res);if(!uid)return;
  const {message,model,skills,personality}=req.body||{};
  if(typeof message!=='string'||!message.trim()||message.length>12000)return res.status(400).json({error:'Send a message under 12,000 characters.'});
  if(model!==undefined&&(typeof model!=='string'||!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(model)))return res.status(400).json({error:'Choose a valid OpenRouter model.'});
  const skillNames=Array.isArray(skills)?skills.filter((v:unknown)=>typeof v==='string'&&v.length<=80).slice(0,50):[];
  const profile=typeof personality==='string'?personality.slice(0,4000):'';
  try{
   const account=await accounts.load(uid);if(!account)return res.status(409).json({error:'Connect OpenRouter in Apps.'});
   if(model&&!(await accounts.models()).some(m=>m.id===model))return res.status(400).json({error:'This model is not in the current OpenRouter catalogue.'});
   const response=await request('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${account.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:model||account.model,temperature:0,max_tokens:1800,parallel_tool_calls:false,tools:toolDefinitions,tool_choice:'auto',messages:[{role:'system',content:'Select a tool only when the user explicitly requests that action. General education and explanation need no tool, except use find_code for questions about named saved source. Never claim an action happened or infer approval. For changes to skills, personality, code or brokers, propose a review; do not execute. Skill names: '+JSON.stringify(skillNames)+'. Existing personality: '+JSON.stringify(profile)},{role:'user',content:message}]}),signal:AbortSignal.timeout(30000)});
   if(!response.ok)return res.status(502).json({error:'The selected AI model could not select a tool. Check AI settings or retry.'});
   const body=await response.json() as any;
   if(!body.choices?.[0]?.message)throw Error('Missing model response');
   const plan=parsePlannedAction(body.choices[0].message);
   return res.json({tool:plan.tool,...(Object.keys(plan.args).length?{args:plan.args}:{}),requiresConfirmation:['deploy','stop','edit','create','manage_skill','edit_personality','rename_code','delete_code','manage_broker'].includes(plan.tool||'')});
  }catch{return res.status(502).json({error:'AI tool selection failed. No action was executed.'})}
 });
}
