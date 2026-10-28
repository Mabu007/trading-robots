import {afterEach,describe,expect,it,vi} from 'vitest';
import {requestInstanceAction} from './instance-actions';
import type {CloudClient} from './firebase';
afterEach(()=>vi.unstubAllGlobals());
const client={getIdToken:async()=> 'test-token'} as unknown as CloudClient;
describe('instance actions',()=>{
 it('sends the selected action and returns only the confirmed stopped state',async()=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({deployed:true,running:false,evaluating:false}),{status:200}));vi.stubGlobal('fetch',fetchMock);
  const controller=new AbortController();const result=await requestInstanceAction(client,'bot-id','stop',controller.signal);
  expect(result.running).toBe(false);expect(fetchMock).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls[0][0]).toBe('/api/marketplace/bots/bot-id/deployment');expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({action:'stop'});expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
 });
 it('does not claim a start or stop succeeded when the runtime returns the opposite or an incomplete state',async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({deployed:true,running:false}),{status:200})).mockResolvedValueOnce(new Response(JSON.stringify({deployed:true}),{status:200}));vi.stubGlobal('fetch',fetchMock);const signal=new AbortController().signal;
  await expect(requestInstanceAction(client,'bot','start',signal)).rejects.toThrow('not confirmed');
  await expect(requestInstanceAction(client,'bot','stop',signal)).rejects.toThrow('not confirmed');
 });
});
