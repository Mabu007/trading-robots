import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {readSignalDescription,SignalBuilder} from './SignalBuilder';
import {SignalActivity} from './SignalActivity';
import {TelegramSettings} from './TelegramSettings';
import {readFileSync} from 'node:fs';

describe('separate Signal creation, delivery and backtesting UI',()=>{
 it('parses direct Gold price, RSI and liquidity sweep conditions',()=>{
  expect(readSignalDescription('Notify me when Gold closes above 4000 on M5')).toMatchObject({kind:'above',value:4000,timeframe:'m5'});
  expect(readSignalDescription('Gold RSI below 30 on M1')).toMatchObject({kind:'rsi_below',value:30,timeframe:'m1'});
  expect(readSignalDescription('Gold sweeps previous 6 candle highs on M15')).toMatchObject({kind:'sweep_high',lookback:6,timeframe:'m15'});
  expect(readSignalDescription('How is Gold doing?')).toBeNull();
 });
 it('renders independent signal configuration and strategy conversion',()=>{
  const html=renderToStaticMarkup(<SignalBuilder client={{} as any} active bots={[{id:'abc',name:'Gemini',asset:'GOLDUSDC'}]} onOpenApps={()=>{}} onViewHistory={()=>{}}/>);
  expect(html).toContain('Save signal draft');
  expect(html).toContain('Create from strategy');
  expect(html).toContain('RSI falls below');
  expect(html).toContain('Gold · XAUUSD');
  expect(html).not.toContain('PropDAO trading desk');
 });
 it('shows alert history without an independent condition builder',()=>{
  const html=renderToStaticMarkup(<SignalActivity client={null} active onOpenStrategy={()=>{}}/>);
  expect(html).toContain('Alert history');
  expect(html).not.toContain('Create &amp; manage');
  expect(html).not.toContain('Trackers');
 });
 it('uses the actual shell theme tokens in both pages',()=>{
  const signals=readFileSync(new URL('./signal-activity.css',import.meta.url),'utf8');
  const creator=readFileSync(new URL('./signal-builder.css',import.meta.url),'utf8');
  const telegram=readFileSync(new URL('./telegram-settings.css',import.meta.url),'utf8');
  for(const css of [signals,creator,telegram])expect(css).toContain('var(--tv-shell-panel');
  expect(creator).toContain('var(--tv-shell-ink)');
  expect(telegram).toContain('var(--tv-shell-line)');
  const html=renderToStaticMarkup(<TelegramSettings client={{} as any} active/>);
  expect(html).toContain('Open @BotFather');
  expect(html).toContain('Link your chat');
 });
});
