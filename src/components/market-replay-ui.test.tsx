import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {MarketReplay} from './MarketReplay';

describe('Market Replay is the core Backtest workflow',()=>{
 it('renders the immersive historical-date launch without asking for a trading venue',()=>{
  const html=renderToStaticMarkup(<MarketReplay client={{getProfile:()=>({uid:'test-user'})} as any} theme="light" onClose={()=>{}}/>);
  expect(html).toContain('Market Replay');
  expect(html).toContain('Historical date');
  expect(html).toContain('Start time');
  expect(html).toContain('Practice balance');
  expect(html).toContain('Launch market replay');
  expect(html).not.toContain('Trading venue');
  expect(html).not.toContain('PropDAO');
 });
 it('keeps Backtest strategy builder and historical replay separate, removes obsolete mass delete',()=>{
  const library=readFileSync(new URL('./CodeLibrary.tsx',import.meta.url),'utf8');
  const workbench=readFileSync(new URL('./StrategyWorkbench.tsx',import.meta.url),'utf8');
  const engine=readFileSync(new URL('../strategy-workbench.ts',import.meta.url),'utf8');
  expect(library).toContain('Market Replay');
  expect(library).toContain('New strategy');
  expect(library).not.toContain('Clear old robots');
  expect(workbench).not.toContain('<span>Trading venue</span>');
  expect(engine).toContain("venue: 'research', asset: 'XAUUSD'");
 });
 it('matches app light and dark theme variables and provides responsive mobile practice',()=>{
  const styles=readFileSync(new URL('./market-replay.css',import.meta.url),'utf8');
  expect(styles).toContain('var(--tv-shell-panel)');
  expect(styles).toContain('var(--tv-shell-ink)');
  expect(styles).toContain('@media(max-width:560px)');
  const script=readFileSync(new URL('./MarketReplay.tsx',import.meta.url),'utf8');
  expect(script).toContain('replayVisibleBars');
  expect(script).toContain('replayEnter');
  expect(script).toContain('replayModifyPosition');
  expect(script).toContain('captureChart');
 });
});
