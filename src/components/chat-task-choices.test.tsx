import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChatTaskChoices} from './ChatTaskChoices';
import {defaultTradingPreferences} from '../conversation-workflow';
import type {CloudBot} from '../firebase';
const props={prefs:defaultTradingPreferences,bots:[] as CloudBot[],onChoose:()=>undefined,onCancel:()=>undefined};
describe('three-way conversational task choices',()=>{
 it('shows exactly two market choices plus a free-text answer',()=>{
  const html=renderToStaticMarkup(createElement(ChatTaskChoices,{...props,task:{kind:'create',seed:'build liquidity sweep robot'}}));
  expect(html).toContain('GOLDUSDC');
  expect(html).toContain('Bitcoin');
  expect(html).toContain('Type my answer');
  expect((html.match(/tv-task-choice-number/g)||[]).length).toBe(3);
 });
 it('asks for UTC backtest dates instead of silently replaying prior run',()=>{
  const html=renderToStaticMarkup(createElement(ChatTaskChoices,{...props,task:{kind:'backtest',botId:'ai-2',botName:'ai 2'}}));
  expect(html).toContain('ai 2');
  expect(html).toContain('Last 7 completed days');
  expect(html).toContain('Last 30 completed days');
  expect(html).toContain('Choose custom dates');
 });
 it('lists saved robot candidates by name before editing',()=>{
  const bots=[{id:'a',name:'Gold Digger',asset:'GOLDUSDC',venue:'propdao'},{id:'b',name:'ai 2',asset:'GOLDUSDC',venue:'propdao'}] as CloudBot[];
  const html=renderToStaticMarkup(createElement(ChatTaskChoices,{...props,bots,task:{kind:'choose-robot',action:'edit',robotIds:['a','b']}}));
  expect(html).toContain('Gold Digger');
  expect(html).toContain('ai 2');
  expect(html).toContain('Type my answer');
 });
});
