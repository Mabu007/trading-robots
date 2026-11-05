import {describe,it,expect,beforeEach} from 'vitest';
import {sealOAuth,openOAuth} from './openrouter-oauth';
beforeEach(()=>{process.env.AI_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64')});
const pending=()=>({uid:'owner',state:'nonce',verifier:'secret-verifier',model:'test/model',expires:Date.now()+60000});
describe('OpenRouter PKCE state',()=>{
 it('encrypts verifier and binds callback to user and nonce',()=>{const p=pending(),sealed=sealOAuth(p);expect(sealed).not.toContain(p.verifier);expect(openOAuth(sealed,'owner','nonce')).toEqual(p);expect(()=>openOAuth(sealed,'other','nonce')).toThrow();expect(()=>openOAuth(sealed,'owner','wrong')).toThrow()});
 it('rejects expired or tampered state',()=>{expect(()=>openOAuth(sealOAuth({...pending(),expires:0}),'owner','nonce')).toThrow();const s=sealOAuth(pending());expect(()=>openOAuth('X'+s.slice(1),'owner','nonce')).toThrow()});
});
