import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AgentTaskPanel} from './AgentTaskPanel';
describe('durable task panel',()=>{
 it('explains task work and never displays a live trade authorization button',()=>{
  const html=renderToStaticMarkup(createElement(AgentTaskPanel,{client:{} as any}));
  expect(html).toContain('Give VIBES a goal');
  expect(html).toContain('Start research task');
  expect(html).toContain('Research never authorizes trades');
  expect(html).not.toContain('Place trade');
 });
});
