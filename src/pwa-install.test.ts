import {describe,expect,it} from 'vitest';
import {installPlatform,isAppStandalone} from './pwa-install';

describe('Market Replay PWA install support',()=>{
 it('identifies phone and desktop installation paths',()=>{
  expect(installPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
  expect(installPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit')).toBe('android');
  expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit')).toBe('desktop');
  expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148')).toBe('ios');
 });
 it('does not assume the site is installed during non-browser rendering',()=>{
  expect(isAppStandalone()).toBe(false);
 });
});
