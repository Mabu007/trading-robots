import type {ChatTransport,UIMessage,UIMessageChunk} from 'ai';
import {postApiStream} from './api';

export type SdkBridgeRequest={
 payload:unknown;token:string;signal:AbortSignal;
 onText:(full:string)=>void;onTool?:(event:unknown)=>void;complete:(error:unknown,result?:string)=>void
};
/** Compatibility bridge while legacy conversation/action cards are migrated.
 * Only payload is sent over the network; callbacks, token and AbortSignal stay local.
 */
export function sdkChatTransport(request:typeof postApiStream=postApiStream):ChatTransport<UIMessage>{
 let active=false;
 return {
  async sendMessages(options){
   const body=options.body as {bridge?:SdkBridgeRequest}|undefined;
   const bridge=body?.bridge;
   if(!bridge||active)throw Error('An AI request is already active or missing its context.');
   active=true;
   const internalAbort=new AbortController();let cancelled=false;
   const signal=AbortSignal.any([bridge.signal,internalAbort.signal,...(options.abortSignal?[options.abortSignal]:[])]);
   return new ReadableStream<UIMessageChunk>({
    async start(controller){
     let ended=false;
     const emit=(v:UIMessageChunk)=>{if(!ended)controller.enqueue(v)};
     try{
      emit({type:'start'});emit({type:'text-start',id:'response'});
      const result=await request('/api/ai-sdk/stream',bridge.payload,'OpenRouter',(chunk,full)=>{
       if(!cancelled&&!signal.aborted){bridge.onText(full);emit({type:'text-delta',id:'response',delta:chunk});}
      },signal,bridge.token,event=>{
       if(signal.aborted||!event||typeof event!=='object')return;
       const part=event as Record<string,unknown>;
       bridge.onTool?.(event);
       if(part.type==='tool-call'&&typeof part.toolCallId==='string'&&typeof part.toolName==='string'){
        emit({type:'tool-input-available',toolCallId:part.toolCallId,toolName:part.toolName,input:part.input});
       }else if(part.type==='tool-result'&&typeof part.toolCallId==='string'){
        emit({type:'tool-output-available',toolCallId:part.toolCallId,output:part.output});
       }
      });
      signal.throwIfAborted();
      emit({type:'text-end',id:'response'});emit({type:'finish',finishReason:'stop'});
      bridge.complete(null,result);ended=true;if(!cancelled)controller.close();
     }catch(error){
      bridge.complete(error);ended=true;if(!cancelled)controller.error(error);
     }finally{active=false}
    },
    cancel(){cancelled=true;internalAbort.abort()}
   });
  },
  async reconnectToStream(){return null}
 };
}
