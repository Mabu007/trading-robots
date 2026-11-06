import {describe,it,expect} from 'vitest';
import {chatStreamPath} from './api';
describe('chat transport rollout',()=>{
 it('defaults to the existing transport and accepts only the exact opt-in',()=>{
  for(const flag of [undefined,null,false,true,'','false','TRUE','1'])expect(chatStreamPath(flag)).toBe('/api/ai');
  expect(chatStreamPath('true')).toBe('/api/ai-sdk/stream');
 });
});
