import {afterEach,describe,expect,it,vi} from 'vitest';
import {sharingRequest} from './components/BotSharing';
import type {CloudClient} from './firebase';
afterEach(()=>vi.unstubAllGlobals());
describe('authenticated sharing requests',()=>{
 it('refreshes an expired token once after a 401 before retrying',async()=>{
  const getIdToken=vi.fn(async(force?:boolean)=>force?'refreshed':'expired');
  const fetchMock=vi.fn().mockResolvedValueOnce(new Response('{"error":"expired"}',{status:401})).mockResolvedValueOnce(new Response('{"ok":true}',{status:200}));
  vi.stubGlobal('fetch',fetchMock);const result=await sharingRequest<{ok:boolean}>({getIdToken} as unknown as CloudClient,'/api/economy/me');
  expect(result.ok).toBe(true);expect(getIdToken.mock.calls).toEqual([[false],[true]]);expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed');
 });
 it('does not retry an authorization failure that is not an expired session',async()=>{
  const getIdToken=vi.fn(async()=> 'token');const fetchMock=vi.fn().mockResolvedValue(new Response('{"error":"Forbidden"}',{status:403}));vi.stubGlobal('fetch',fetchMock);
  await expect(sharingRequest({getIdToken} as unknown as CloudClient,'/api/economy/me')).rejects.toThrow('Forbidden');expect(fetchMock).toHaveBeenCalledTimes(1);
 });
});
