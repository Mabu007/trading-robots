import {afterEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuthPage} from '../App';
afterEach(()=>vi.unstubAllGlobals());
describe('account entry',()=>{
 it('offers registration from the signup link with accessible email and password fields',()=>{
  vi.stubGlobal('window',{location:{search:'?mode=signup'}});
  const html=renderToStaticMarkup(<AuthPage theme="dark" client={null} initError="" onBack={()=>{}} onSuccess={async()=>{}}/>);
  expect(html).toContain('Create free account');expect(html).toContain('autoComplete="email"');expect(html).toContain('autoComplete="new-password"');expect(html).not.toContain('INVITE-ONLY');
 });
 it('offers sign in and password reset on the sign-in route',()=>{
  vi.stubGlobal('window',{location:{search:''}});
  const html=renderToStaticMarkup(<AuthPage theme="light" client={null} initError="" onBack={()=>{}} onSuccess={async()=>{}}/>);
  expect(html).toContain('Forgot password?');expect(html).toContain('Create an account');
 });
});
