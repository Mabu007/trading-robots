import {generateKeyPairSync,createSign} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {firebasePrivateKey} from './firebase-key';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
describe('Firebase key formatting',()=>{
 for(const [name,input]of Object.entries({pem:privateKey,escaped:privateKey.replace(/\n/g,'\\n'),doubleEscaped:privateKey.replace(/\n/g,'\\\\n'),quoted:JSON.stringify(privateKey),json:JSON.stringify({private_key:privateKey}),singleQuoted:`'${privateKey}'`,crlf:privateKey.replace(/\n/g,'\r\n')})){
  it(`signs with ${name} without exposing key material`,()=>{const normalized=firebasePrivateKey(input);expect(normalized).toBe(privateKey);expect(createSign('RSA-SHA256').update('fixture').sign(normalized).length).toBeGreaterThan(0)});
 }
 it('rejects incorrect fields with an actionable error',()=>{expect(()=>firebasePrivateKey('{"client_email":"fixture@example.invalid"}')).toThrow('private_key');expect(()=>firebasePrivateKey('wrong value')).toThrow('BEGIN and END')});
});
