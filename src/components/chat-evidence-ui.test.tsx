import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChatEvidence} from './ChatEvidence';
import type {ToolTrace} from '../tool-trace';

describe('chat market evidence UI',()=>{
  it('shows Sources without rendering or offering an inline chart',()=>{
    const trace:ToolTrace[]=[{id:'market-1',name:'getPublicMarketEvidence',state:'completed',output:{
      quote:{coin:'xyz:GOLD',asOf:'2026-11-09T12:22:00Z'},
      chart:{coin:'xyz:GOLD',timeframe:'h1',asOf:'2026-11-09T12:00:00Z',candles:[{time:1,open:1,close:1,high:1,low:1}]},
      sources:[{name:'Hyperliquid',url:'https://app.hyperliquid.xyz/trade/xyz%3AGOLD'}]
    }}];
    const html=renderToStaticMarkup(createElement(ChatEvidence,{trace,theme:'light'}));
    expect(html).toContain('Sources');
    expect(html).toContain('Hyperliquid');
    expect(html).not.toContain('View chart');
    expect(html).not.toContain('Hide chart');
    expect(html).not.toContain('vibes-market-chart');
  });
});
