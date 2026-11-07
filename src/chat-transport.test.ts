import {describe,it,expect} from 'vitest';
import {chatStreamPath} from './api';
describe('chat transport rollout',()=>{
 it('uses the SDK by default and retains an explicit rollback',()=>{
  for(const flag of [undefined,null,false,true,'','true','1'])expect(chatStreamPath(flag)).toBe('/api/ai-sdk/stream');
  expect(chatStreamPath('false')).toBe('/api/ai');
 });
});
