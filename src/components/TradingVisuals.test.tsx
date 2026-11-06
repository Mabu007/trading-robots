import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TradingVisualResponse} from './TradingVisuals';

describe('Trading Vibes visual catalog runtime',()=>{
 it('renders GDELT headline using provider evidence',()=>{
  const markup=renderToStaticMarkup(createElement(TradingVisualResponse,{kind:'news-snapshot',data:{topic:'gold',span:'24h',provider:'GDELT DOC 2.0',fetchedAt:'2026-11-06T10:00:00Z',articles:[{title:'Recorded headline',url:'https://example.org/actual',domain:'example.org',seenAt:'2026-11-06T09:00:00Z'}]}}));
  expect(markup).toContain('Recorded headline');
  expect(markup).toContain('example.org/actual');
 });
 it('renders missing evidence without inventing a chart',()=>{
  const markup=renderToStaticMarkup(createElement(TradingVisualResponse,{kind:'candlestick-chart',data:{asset:'GOLDUSDC',candles:[]}}));
  expect(markup).toContain('No validated OHLC');
  expect(markup).not.toContain('<rect ');
 });
 it('renders an attached closed trade as read-only record',()=>{
  const markup=renderToStaticMarkup(createElement(TradingVisualResponse,{kind:'trade-audit',data:{venue:'propdao',asset:'GOLDUSDC',source:'PROPDAO broker record',providerRecord:{id:'hist-example',side:'SELL',quantity:0.0465,entry:3923.3727,exit:3930.59,pnl:-0.45,fee:0.11}}}));
  expect(markup).toContain('3,923.3727');
  expect(markup).toContain('3,930.59');
  expect(markup).toContain('Currency/gross-net definition unverified');
 });
});
