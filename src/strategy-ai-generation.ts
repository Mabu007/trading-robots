import {AiOutputLimitError, joinAiContinuation} from './api';
import {validateWorkbenchSource} from './strategy-workbench';

export type StrategyAiMessage = {role:'system'|'user';content:string};
const fence = String.fromCharCode(96).repeat(3);
const sourceFromReply=(reply:string)=>{
  const match=reply.match(new RegExp(fence+'(?:javascript|js)\\s*\\n?([\\s\\S]*?)'+fence,'i'));
  return (match?.[1] ?? reply.replace(new RegExp('^'+fence+'(?:javascript|js)\\s*','i'),'').replace(new RegExp(fence+'\\s*$'),'')).trim();
};

/** Never replace the editor with incomplete or invalid model output. */
export async function generateStrategyWithRecovery(input:{
  system:string;user:string;signal:AbortSignal;
  request:(messages:StrategyAiMessage[],signal:AbortSignal)=>Promise<string>;
  progress?:(message:string)=>void;
}):Promise<string>{
  let collected='';
  let messages:StrategyAiMessage[]=[{role:'system',content:input.system},{role:'user',content:input.user}];
  let lastError='';
  for(let attempt=0;attempt<3;attempt++){
    input.signal.throwIfAborted();
    let segment='',limited=false;
    try{segment=await input.request(messages,input.signal);}
    catch(error){
      if(!(error instanceof AiOutputLimitError)||!error.partialText.trim())throw error;
      segment=error.partialText;limited=true;
    }
    collected=joinAiContinuation(collected,segment);
    if(limited){
      if(attempt===2)break;
      input.progress?.('The model reached its output limit. Continuing the unfinished strategy…');
      messages=[
        {role:'system',content:input.system},
        {role:'user',content:'Continue the following JavaScript response EXACTLY from its last character. Do not start again, do not explain, and do not repeat existing code. Finish any unfinished function and close the code fence if present. Previous response (tail):\n'+collected.slice(-9500)}
      ];
      continue;
    }
    const source=sourceFromReply(collected);
    try{validateWorkbenchSource(source);return source;}
    catch(error){
      lastError=error instanceof Error?error.message:'Invalid strategy source';
      if(attempt===2)break;
      input.progress?.('The generated draft needs a syntax/configuration repair. Retrying…');
      messages=[
        {role:'system',content:input.system},
        {role:'user',content:input.user+'\nThe previous draft failed local validation: '+lastError+'. Return a complete corrected strategy.js, not a patch. Previous draft:\n'+source.slice(0,8500)}
      ];
      collected='';
    }
  }
  throw new Error('AI could not produce a complete, valid strategy after automatic continuation/repair. '+(lastError||'The selected model repeatedly reached its output limit.')+' Your existing code was not changed. Try a model with a larger output allowance.');
}
