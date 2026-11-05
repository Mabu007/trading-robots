import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Bell, Bot, BookOpen, ChartCandlestick, CheckCircle2, ChevronRight, CircleHelp, Compass, LockKeyhole, MessageCircle, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, UserRound, Wallet } from 'lucide-react';
import type { CloudBot } from '../firebase';
import { venueLabel, venueOf } from '../../shared/venues';
import './mobile-experience.css';

type Destination = 'chat' | 'markets' | 'agents' | 'you';
type Lesson = 'basics' | 'risk' | 'robots';
type Props = {
  bots: CloudBot[];
  profileName: string;
  cloudStatus: string;
  onCreate: () => void;
  onOpen: (bot: CloudBot) => void | Promise<void>;
  onSettings: () => void;
  onConnect: () => void;
  onExplore: () => void;
  onStartStrategy: (prompt: string) => void;
};
const nav = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'markets', label: 'Markets', icon: ChartCandlestick },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'you', label: 'You', icon: UserRound },
] as const;
const lessons: Record<Lesson, { title: string; kicker: string; body: string[]; takeaway: string }> = {
  basics: {
    title: 'Trading, without the jargon',
    kicker: 'LESSON 01 · 3 MIN READ',
    body: ['Trading means buying or selling an asset because you expect its price to change. Your expectation might be wrong, and a loss is always possible.', 'A candlestick summarises an asset’s open, high, low and close prices over a selected interval. A green candle does not guarantee the next candle will rise.', 'Before risking real money, practise reading charts and placing hypothetical trades on a demo account.'],
    takeaway: 'Learn to describe a setup and its invalidation before thinking about profits.'
  },
  risk: {
    title: 'The risk lesson everyone needs',
    kicker: 'LESSON 02 · 4 MIN READ',
    body: ['A stop-loss is an instruction intended to limit a loss, but its fill price is not guaranteed during fast markets.', 'Risk per trade describes how much you could lose if your planned stop is hit. Position sizing should reflect that distance, fees and the instrument’s contract rules.', 'A promising backtest cannot guarantee future returns. Check drawdown, slippage, fees and whether the strategy survives losing streaks.'],
    takeaway: 'Protecting capital is a skill, not a setting you turn on once.'
  },
  robots: {
    title: 'What a trading robot actually does',
    kicker: 'LESSON 03 · 3 MIN READ',
    body: ['A trading robot executes a set of explicit rules. It is not automatically intelligent or profitable.', 'Strategy creation defines the rules. Backtesting checks historical behaviour. Deployment connects an approved strategy to a supported venue under risk controls.', 'Trading Vibes is building a conversational interface around these steps. Not every venue supports live execution, and live activity requires explicit authorisation.'],
    takeaway: 'Understand the rules before you trust the automation.'
  },
};
const starters = [
  { icon: BookOpen, title: 'Teach me trading', subtitle: 'Start with the basics', action: 'basics' },
  { icon: ChartCandlestick, title: 'Explore the markets', subtitle: 'Browse instruments and concepts', action: 'markets' },
  { icon: Bot, title: 'Build a trading robot', subtitle: 'Describe the rules in your words', action: 'create' },
  { icon: ShieldCheck, title: 'Understand risk', subtitle: 'Learn how protection works', action: 'risk' },
] as const;
function inferIntent(value: string): 'create' | 'markets' | Lesson {
  if (/bot|robot|strategy|backtest|automate|build|scalp|indicator|entry|exit/i.test(value)) return 'create';
  if (/price|gold|bitcoin|btc|eth|chart|market|trend|xau|asset/i.test(value)) return 'markets';
  if (/risk|stop.loss|drawdown|loss|leverage|margin/i.test(value)) return 'risk';
  return 'basics';
}
export function MobileExperience({ bots, profileName, cloudStatus, onCreate, onOpen, onSettings, onConnect, onExplore, onStartStrategy }: Props) {
  const [tab, setTab] = useState<Destination>('chat');
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(() => {
    try { return localStorage.getItem('tv:mobile:intro-seen') !== '1'; } catch { return false; }
  });
  const filteredBots = useMemo(() => bots.filter(bot => [bot.name, bot.asset, venueLabel[venueOf(bot.venue)]].join(' ').toLowerCase().includes(query.toLowerCase())), [bots, query]);
  const assets = useMemo(() => Array.from(new Set(bots.map(bot => bot.asset).filter(Boolean))), [bots]);
  const launch = (action: 'create' | 'markets' | Lesson, phrase = '') => {
    if (action === 'create') { if (phrase.trim()) onStartStrategy(phrase); else onCreate(); return; }
    if (action === 'markets') { setTab('markets'); setLesson(null); return; }
    setLesson(action);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt) return;
    setInput('');
    launch(inferIntent(prompt), prompt);
  };
  const go = (destination: Destination) => { setTab(destination); setLesson(null); setSelectedMarket(null); };
  const name = profileName.trim().split(/\s+/)[0] || 'there';
  return <div className="tv-mobile-v2">
    {showIntro && <section className="tvm-intro" aria-label="Welcome to Trading Vibes">
      <div className="tvm-intro-mark"><Sparkles size={26}/></div>
      <span className="tvm-eyebrow">A NEW WAY TO TRADE</span>
      <h1>Your trading intelligence. <em>In your hands.</em></h1>
      <p>Learn, explore the markets and build strategies through a simpler experience. You control every trading decision.</p>
      <button className="tvm-primary" onClick={() => { setShowIntro(false); try { localStorage.setItem('tv:mobile:intro-seen','1'); } catch {} }}>Get started <ArrowRight size={17}/></button>
      <span className="tvm-intro-note"><LockKeyhole size={13}/> No broker connection needed to learn</span>
    </section>}
    <header className="tvm-header">
      <div className="tvm-brand"><div className="tvm-brand-icon"><Sparkles size={18}/></div><div><strong>Trading Vibes</strong><small>{tab === 'chat' ? 'Your AI trading studio' : tab === 'markets' ? 'Market intelligence' : tab === 'agents' ? 'Your strategies' : 'Your account'}</small></div></div>
      <button className="tvm-icon-button" onClick={onSettings} aria-label="Open settings"><Settings2 size={19}/></button>
    </header>
    <main className="tvm-main" id="tvm-main">
      {tab === 'chat' && (lesson ? <section className="tvm-lesson">
        <button className="tvm-back" onClick={() => setLesson(null)}><ArrowLeft size={17}/> Back to chat</button>
        <span className="tvm-eyebrow">{lessons[lesson].kicker}</span>
        <h1>{lessons[lesson].title}</h1>
        <div className="tvm-lesson-body">{lessons[lesson].body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        <div className="tvm-takeaway"><CheckCircle2 size={19}/><p>{lessons[lesson].takeaway}</p></div>
        <button className="tvm-cta-secondary" onClick={() => setLesson(null)}>Explore another topic <ArrowRight size={16}/></button>
      </section> : <>
        <section className="tvm-hero">
          <span className="tvm-eyebrow"><span className="tvm-pulse"/> YOUR INTELLIGENCE STUDIO</span>
          <h1>What are we exploring <em>today, {name}?</em></h1>
          <p>Learn the markets, develop ideas and build trading strategies — without complicated software.</p>
        </section>
        <div className="tvm-section-title"><span>START SOMETHING</span><span className="tvm-muted">Pick a direction</span></div>
        <div className="tvm-task-grid">{starters.map(item => <button key={item.title} className="tvm-task" onClick={() => launch(item.action)}><span className="tvm-task-icon"><item.icon size={20}/></span><strong>{item.title}</strong><small>{item.subtitle}</small><ArrowRight className="tvm-task-arrow" size={15}/></button>)}</div>
        <section className="tvm-editorial"><div className="tvm-editorial-top"><span>YOUR FIRST EDGE</span><span>01 / 03</span></div><h2>Before you trade, learn to think in probabilities.</h2><p>Start with a short lesson on risk, stops and the difference between a good decision and a winning trade.</p><button onClick={() => setLesson('risk')}>Explore the lesson <ArrowRight size={16}/></button></section>
        <div className="tvm-note"><ShieldCheck size={17}/><p>AI can make mistakes. Market analysis and historical results are not guaranteed outcomes. Live trades require your approval.</p></div>
      </>)}
      {tab === 'markets' && <section className="tvm-page">
        <span className="tvm-eyebrow">DISCOVER · UNDERSTAND · TEST</span>
        <h1>Markets, with context.</h1><p className="tvm-lead">Explore instruments and start researching. Prices are only displayed when a verified market feed is connected.</p>
        <div className="tvm-status"><span className="tvm-status-dot"/> Live quotations are not shown in this preview.</div>
        <h2 className="tvm-subhead">In your strategies</h2>
        {(assets.length ? assets : ['GOLD / XAUUSD', 'BTC / USDC', 'ETH / USDC']).map(symbol => <button className="tvm-list-row" key={symbol} onClick={() => setSelectedMarket(symbol)}><span className="tvm-row-icon"><ChartCandlestick size={18}/></span><span><strong>{symbol}</strong><small>{assets.length ? 'Used by a saved strategy' : 'Explore instrument'}</small></span><ChevronRight size={17}/></button>)}
        {selectedMarket && <div className="tvm-inline-detail"><button className="tvm-close" onClick={()=>setSelectedMarket(null)}>Close</button><span className="tvm-eyebrow">INSTRUMENT · {selectedMarket}</span><h2>Explore {selectedMarket}</h2><p>Start a strategy for this market or open one of your existing strategies. No live price is available on this screen.</p><button className="tvm-primary" onClick={() => onStartStrategy(`Help me build a strategy for ${selectedMarket}. Explain the entry, exit and risk rules before generating code.`)}>Build a strategy <ArrowRight size={16}/></button></div>}
      </section>}
      {tab === 'agents' && <section className="tvm-page">
        <span className="tvm-eyebrow">YOUR WORKBENCH</span><h1>Your trading agents.</h1><p className="tvm-lead">Draft, review and test strategies. Open an agent to inspect its actual deployment and execution status.</p>
        <div className="tvm-agent-toolbar"><label><Search size={17}/><input aria-label="Search trading agents" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a strategy..."/></label><button onClick={onCreate} aria-label="Create agent"><Plus size={20}/></button></div>
        {filteredBots.length ? filteredBots.map(bot => <button className="tvm-agent-card" key={bot.id} onClick={() => void onOpen(bot)}><span className="tvm-agent-icon"><Bot size={20}/></span><span className="tvm-agent-copy"><strong>{bot.name || 'Untitled strategy'}</strong><small>{bot.asset || 'No instrument'} · {venueLabel[venueOf(bot.venue)]}</small><span className="tvm-agent-caption">Open for verified status and backtests</span></span><ChevronRight size={19}/></button>) : <div className="tvm-empty"><Bot size={26}/><h3>{query ? 'No matching strategies' : 'Your next idea starts here.'}</h3><p>{query ? 'Try a different search.' : 'Describe your idea and let Trading Vibes help turn it into a testable strategy.'}</p>{!query && <button className="tvm-primary" onClick={onCreate}>Create an agent <ArrowRight size={16}/></button>}</div>}
      </section>}
      {tab === 'you' && <section className="tvm-page">
        <span className="tvm-eyebrow">YOUR TRADING VIBES</span><h1>Your space, your rules.</h1><p className="tvm-lead">Manage your profile, account connections and preferences.</p>
        <div className="tvm-identity"><span><UserRound size={25}/></span><div><strong>{profileName || 'Trading Vibes member'}</strong><small>Cloud sync: {cloudStatus}</small></div></div>
        <h2 className="tvm-subhead">Account and security</h2>
        <button className="tvm-list-row" onClick={onConnect}><span className="tvm-row-icon"><Wallet size={19}/></span><span><strong>Connect a trading venue</strong><small>Review broker connection options</small></span><ChevronRight size={17}/></button>
        <button className="tvm-list-row" onClick={onSettings}><span className="tvm-row-icon"><Settings2 size={19}/></span><span><strong>Account settings</strong><small>Profile, security and membership</small></span><ChevronRight size={17}/></button>
        <button className="tvm-list-row" onClick={onExplore}><span className="tvm-row-icon"><Compass size={19}/></span><span><strong>Explore the community</strong><small>Discover public creators and strategies</small></span><ChevronRight size={17}/></button>
        <div className="tvm-note"><CircleHelp size={17}/><p>Connected venue permissions, market access and KYC requirements depend on the provider and your jurisdiction.</p></div>
      </section>}
    </main>
    {tab === 'chat' && !lesson && <form className="tvm-composer" onSubmit={submit}><label htmlFor="tvm-prompt" className="tvm-sr">Describe what you want to do</label><input id="tvm-prompt" value={input} onChange={e => setInput(e.target.value)} placeholder="What would you like to do?" autoComplete="off"/><button type="submit" disabled={!input.trim()} aria-label="Continue with request"><Send size={19}/></button><span className="tvm-composer-hint">Guided starting point · AI chat available in your strategy workspace</span></form>}
    <nav className="tvm-nav" aria-label="Main navigation">{nav.map(item => <button key={item.id} className={tab===item.id?'active':''} aria-current={tab===item.id?'page':undefined} onClick={()=>go(item.id)}><item.icon size={21}/><span>{item.label}</span></button>)}</nav>
  </div>;
}
