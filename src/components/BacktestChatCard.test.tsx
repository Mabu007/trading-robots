import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BacktestChatCard} from './BacktestChatCard';
import type {BacktestCardData} from './BacktestChatCard';
const card:BacktestCardData={botId:'bot-123',name:'Gold test',asset:'GOLDUSDC',venue:'propdao',
 from:'2026-11-01',to:'2026-11-02',completedAt:'2026-11-03T00:00:00Z',candleCount:100,
 metrics:{netReturn:1,trades:1},trades:[{id:1,side:'LONG',entryTime:1782864000,exitTime:1782864060,entry:4000,exit:4001,pnl:1,reason:'target'}]};
describe('saved backtest trade row inspection',()=>{
 it('exposes Inspect and keyboard-clickable trade row when wired',()=>{
  const markup=renderToStaticMarkup(createElement(BacktestChatCard,{data:card,onInspect:()=>undefined}));
  expect(markup).toContain('Show chart for trade 1');
  expect(markup).toContain('Ask AI to inspect trade 1');
  expect(markup).toContain('tv-backtest-inspect-row');
  expect(markup).not.toContain('>—</td>');
 });
 it('does not show a fake active control when no inspection handler exists',()=>{
  const markup=renderToStaticMarkup(createElement(BacktestChatCard,{data:card}));
  expect(markup).not.toContain('tv-backtest-inspect-row');
  expect(markup).toContain('>—</td>');
 });
});
