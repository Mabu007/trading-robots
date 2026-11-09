import {describe,it,expect} from 'vitest';
import {speakable} from './components/BrowserVoice.tsx';
describe('browser voice spoken reply filter',()=>{
 it('removes code blocks, markdown and links without reading source code aloud',()=>{
  const text=speakable('**Hello.** [Go here](https://example.com) '+String.fromCharCode(96).repeat(3)+'js\nsecret\n'+String.fromCharCode(96).repeat(3));
  expect(text).not.toContain('secret');
  expect(text).not.toContain('https://');
  expect(text).toContain('Hello.');
 });
 it('limits long chat replies read aloud',()=>expect(speakable('A'.repeat(2000)).length).toBeLessThanOrEqual(780));
});
