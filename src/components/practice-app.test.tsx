import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {PracticeApp} from './PracticeApp';
import {PracticeLanding} from './PracticeLanding';

describe('practice redesign',()=>{
 it('introduces the practice product without promising guest access',()=>{
  const html=renderToStaticMarkup(<PracticeLanding theme="dark" onThemeToggle={()=>{}}/>);
  expect(html).toContain('Better trading starts with');
  expect(html).toContain('/sign-in');
  expect(html).toContain('Simulated trades');
 });
 it('offers the real workout, lab, and access to the existing workspace',()=>{
  const html=renderToStaticMarkup(<PracticeApp client={{getProfile:()=>({uid:'test',displayName:'Gift'})} as any} theme="light" onThemeToggle={()=>{}} onLegacy={()=>{}} onSignOut={()=>{}}/>);
  expect(html).toContain('Liquidity sweep fundamentals');
  expect(html).toContain('Market Lab');
  expect(html).toContain('Existing workspace');
  expect(html).toContain('Gift');
 });
});
