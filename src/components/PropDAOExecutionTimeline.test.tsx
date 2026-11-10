import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PropDAOExecutionTimeline} from './PropDAOExecutionTimeline.tsx';
import type {ExecutionEvent} from '../../shared/propdao-execution-journal';
const signal:ExecutionEvent={id:'event_a12345',time:Date.now()-5000,
 accountId:'prop-1',botId:'bot-1',grantId:'grant-1',symbol:'GOLDUSDC',side:'SELL',stage:'SIGNAL'};
describe('robot timeline',()=>{
 it('distinguishes a SELL signal from a confirmed protected fill',()=>{
  const html=renderToStaticMarkup(createElement(PropDAOExecutionTimeline,{events:[signal],accountId:'prop-1'}));
  expect(html).toContain('Signal only — not filled');
  expect(html).not.toContain('Protected fill confirmed');
 });
 it('does not leak entries from a different account',()=>{
  const html=renderToStaticMarkup(createElement(PropDAOExecutionTimeline,{events:[
   signal,{...signal,id:'event_b12345',accountId:'prop-2',stage:'OUTCOME_UNKNOWN'}
  ],accountId:'prop-1'}));
  expect(html).not.toContain('Outcome unknown · reconcile');
 });
 it('never treats unavailable Worker data as proof of no trading',()=>{
  const html=renderToStaticMarkup(createElement(PropDAOExecutionTimeline,{events:null,accountId:'prop-1'}));
  expect(html).toContain('does not mean the robot never traded');
 });
});
