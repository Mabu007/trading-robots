import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {PracticeApp} from './PracticeApp';
import {PracticeLanding} from './PracticeLanding';

describe('practice redesign',()=>{
 it('introduces the practice product without promising guest access',()=>{
  const html=renderToStaticMarkup(<PracticeLanding theme="dark" onThemeToggle={()=>{}}/>);
  expect(html).toContain('Better trading');
  expect(html).toContain('/sign-in');
  expect(html).toContain('SIMULATED TRADES');
 });
 it('offers workouts and lab without the retired workspace entry',()=>{
  const html=renderToStaticMarkup(<PracticeApp client={{getProfile:()=>({uid:'test',displayName:'Gift'})} as any} theme="light" onThemeToggle={()=>{}} onSignOut={()=>{}}/>);
  expect(html).toContain('Liquidity Sweep Fundamentals');
  expect(html).toContain('Market Replay');
  expect(html).toContain('Challenges');
  expect(html).not.toContain('Existing workspace');
  expect(html).toContain('Gift');
 });
});
