import {describe,expect,it} from 'vitest';
import {selectOpenRouterApiKey} from './openrouter-credentials.ts';

describe('OpenRouter credential selection',()=>{
 it('always prefers the signed-in user key',()=>expect(selectOpenRouterApiKey(' user-key ','shared-key',true)).toBe('user-key'));
 it('keeps shared credentials disabled unless explicitly opted in',()=>expect(selectOpenRouterApiKey(undefined,'shared-key',false)).toBeUndefined());
 it('uses the shared key only when the server explicitly enables fallback',()=>expect(selectOpenRouterApiKey(undefined,' shared-key ',true)).toBe('shared-key'));
 it('does not treat an empty key as configured',()=>expect(selectOpenRouterApiKey(undefined,'  ',true)).toBeUndefined());
});
