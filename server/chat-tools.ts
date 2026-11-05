import type {Express,Request,Response as Reply} from 'express';
import type {OpenRouterAccounts} from './openrouter-account.ts';

// The model can select a capability, never an endpoint, owner, order or risk value.
export const chatTools = ['backtest','status','deploy','stop','edit','create'] as const;
export type ChatTool = typeof chatTools[number];
export const toolDefinitions=chatTools.map(name=>({type:'function',function:{name,description:({backtest:'Run the selected strategy on the date range currently shown in Backtest. Ask for dates first if the user requests different dates.',status:'Read the selected agent runtime status and errors.',deploy:'Prepare deployment review. This does not authorize execution.',stop:'Prepare a stop confirmation. This does not stop or close positions.',edit:'Propose an explicitly requested strategy code change for user review. Never use for explanation questions.',create:'Open the strategy creation form with the user request, for market and venue selection.'})[name],parameters:{type:'object',properties:{},additionalProperties:false}}}));
export function parseToolSelection(message:any):ChatTool|null{
 const calls=message?.tool_calls;
 if(calls===undefined||Array.isArray(calls)&&calls.length===0)return null;
 if(!Array.isArray(calls)||calls.length!==1)throw Error('Choose one action at a time.');
 const call=calls[0];
 if(call?.type!=='function'||!chatTools.includes(call.function?.name))throw Error('Unsupported AI tool.');
 let args;try{args=JSON.parse(call.function.arguments)}catch{throw Error('Invalid AI tool arguments.')}
 if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).length)throw Error('Invalid AI tool arguments.');
 return call.function.name;
}
export function chatToolRoutes(app:Express,accounts:OpenRouterAccounts,authenticate:(req:Request,res:Reply)=>Promise<string|null>,request:typeof fetch=fetch){
 app.post('/api/chat/plan',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const uid=await authenticate(req,res);if(!uid)return;
  const {message}=req.body||{};
  if(typeof message!=='string'||!message.trim()||message.length>12000)return res.status(400).json({error:'Send a message under 12,000 characters.'});
  try{
   const account=await accounts.load(uid);if(!account)return res.status(409).json({error:'Connect your OpenRouter key in AI settings.'});
   const response=await request('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${account.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:account.model,temperature:0,max_tokens:150,parallel_tool_calls:false,tools:toolDefinitions,tool_choice:'auto',messages:[{role:'system',content:'Select a tool only when the user requests that action. General education, analysis, research and explanation need no tool. Output no claims of completed work. Never infer approval. Tools only request application capabilities; all writes require separate user review. The backtest tool uses the visible workspace date range, never silently substitute it for requested different dates.'},{role:'user',content:message}]}),signal:AbortSignal.timeout(30000)});
   if(!response.ok)return res.status(502).json({error:'The selected AI model could not select a tool. Check AI settings or retry.'});
   const body=await response.json() as any;
   if(!body.choices?.[0]?.message)throw Error('Missing model response');
   const tool=parseToolSelection(body.choices[0].message);
   return res.json({tool,requiresConfirmation:tool==='deploy'||tool==='stop'||tool==='edit'||tool==='create'});
  }catch{return res.status(502).json({error:'AI tool selection failed. No action was executed.'})}
 });
}
