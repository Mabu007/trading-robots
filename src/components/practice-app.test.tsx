import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {PracticeApp} from './PracticeApp';
import {PracticeLanding} from './PracticeLanding';
import {MarketReplay} from './MarketReplay';
import {ReplayIndicators} from './ReplayIndicators';

const client={getProfile:()=>({uid:'test',displayName:'Gift'})} as any;

describe('Market Replay-first product',()=>{
 it('presents Market Replay on the public site without challenges or guest-access claims',()=>{
  const html=renderToStaticMarkup(<PracticeLanding theme="dark" onThemeToggle={()=>{}}/>);
  expect(html).toContain('Replay the market.');
  expect(html).toContain('/sign-in');
  expect(html).toContain('SIMULATED TRADES');
  expect(html).not.toContain('Challenges');
  expect(html).not.toContain('Explore challenges');
 });
 it('has exactly Home, Market Replay, and My Progress as the core destinations',()=>{
  const html=renderToStaticMarkup(<PracticeApp client={client} theme="light" onThemeToggle={()=>{}} onSignOut={()=>{}}/>);
  expect(html).toContain('Home');
  expect(html).toContain('Market Replay');
  expect(html).toContain('My Progress');
  expect(html).toContain('Launch Market Replay');
  expect(html).toContain('Confident%20Trader%20in%20a%20Modern%20Workspace.png');
  expect(html).not.toContain('Challenges');
  expect(html).not.toContain('Liquidity Sweep Fundamentals');
  expect(html).toContain('Gift');
 });
 it('starts a native ZAR market replay with a single Gold asset and no FX field',()=>{
  const html=renderToStaticMarkup(<MarketReplay client={client} theme="light" onClose={()=>{}}/>);
  expect(html).toContain('TRADING VIBES · MARKET REPLAY');
  expect(html).toContain('Practice balance · ZAR');
  expect(html).toContain('Gold · XAUUSD');
  expect(html).toContain('Replay asset');
  expect(html).not.toContain('Simulation FX');
  expect(html).not.toContain('Liquidity Sweep Fundamentals');
 });
 it('opens the indicator library with no active indicators on the chart',()=>{
  const html=renderToStaticMarkup(<ReplayIndicators active={[]} onChange={()=>{}} onClose={()=>{}}/>);
  expect(html).toContain('Start with a clear chart.');
  expect(html).toContain('EMA');
  expect(html).toContain('Bollinger Bands');
  expect(html).toContain('Active indicators');
 });
});
