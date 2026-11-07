import {describe,it,expect,vi} from 'vitest';
import {Chat} from '@ai-sdk/react';
import {sdkChatTransport,type SdkBridgeRequest} from './sdk-chat-transport';
import {AiOutputLimitError} from './api';

describe('SDK chat compatibility transport',()=>{
 it('streams through SDK Chat using exact payload, token and callbacks',async()=>{
  const request=vi.fn(async(_url,_payload,_service,onText)=>{onText('Hello','Hello');onText(' there','Hello there');return 'Hello there'});
  const chat=new Chat({transport:sdkChatTransport(request as any)});let result:any;
  const onText=vi.fn();const bridge:SdkBridgeRequest={payload:{messages:[{role:'user',content:'hi'}]},token:'test-token',signal:new AbortController().signal,onText,complete:(error,text)=>{result={error,text}}};
  await chat.sendMessage({text:'hi'},{body:{bridge}});
  expect(result).toEqual({error:null,text:'Hello there'});
  expect(onText).toHaveBeenLastCalledWith('Hello there');
  expect(request.mock.calls[0][0]).toBe('/api/ai-sdk/stream');
  expect(request.mock.calls[0][1]).toEqual(bridge.payload);
  expect(chat.messages.at(-1)?.parts).toEqual([{type:'text',text:'Hello there',state:'done'}]);
 });
 it('preserves model output-limit errors for continuation',async()=>{
  const error=new AiOutputLimitError('partial');let received:unknown;
  const request=vi.fn(async()=>{throw error});
  const chat=new Chat({transport:sdkChatTransport(request as any)});
  const bridge:SdkBridgeRequest={payload:{},token:'x',signal:new AbortController().signal,onText:()=>{},complete:e=>{received=e}};
  await chat.sendMessage({text:'hi'},{body:{bridge}});
  expect(received).toBe(error);
 });
 it('propagates cancellation to the underlying request',async()=>{
  let signal:AbortSignal|undefined;let received:unknown;
  const request=vi.fn((_url,_payload,_service,_onText,s:AbortSignal)=>{signal=s;return new Promise<string>((_,reject)=>s.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))});
  const chat=new Chat({transport:sdkChatTransport(request as any)});
  const bridge:SdkBridgeRequest={payload:{},token:'x',signal:new AbortController().signal,onText:()=>{},complete:e=>{received=e}};
  const pending=chat.sendMessage({text:'hi'},{body:{bridge}});
  await Promise.resolve();await new Promise(r=>setTimeout(r,0));await chat.stop();await pending;
  expect(signal?.aborted).toBe(true);expect((received as Error)?.name).toBe('AbortError');
 });
 it('does not publish late text or report success after cancellation',async()=>{
  let finish!:(value:string)=>void;let emit!:(chunk:string,full:string)=>void;let received:unknown;
  const request=vi.fn((_url,_payload,_service,onText)=>{emit=onText;return new Promise<string>(resolve=>{finish=resolve})});
  const userAbort=new AbortController();const onText=vi.fn();
  const chat=new Chat({transport:sdkChatTransport(request as any)});
  const bridge:SdkBridgeRequest={payload:{},token:'x',signal:userAbort.signal,onText,complete:e=>{received=e}};
  const pending=chat.sendMessage({text:'hi'},{body:{bridge}});
  await new Promise(r=>setTimeout(r,0));userAbort.abort();emit('late','late');finish('late');await pending;
  expect(onText).not.toHaveBeenCalled();expect((received as Error)?.name).toBe('AbortError');
 });

});
