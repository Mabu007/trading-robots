import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { Activity, AlertCircle, ArrowLeft, ArrowRight, Bell, BookOpen, Bot, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Code2, Compass, ExternalLink, FileText, History, KeyRound, Layers3, LockKeyhole, Menu, MessageCircle, Mic, MoreHorizontal, Plus, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Square, Star, TrendingUp, UserRound, Wallet, X } from 'lucide-react';
import { postApiStream, readApiJson } from '../api';
import { historicalData } from '../history-cache';
import type { CloudBot, CloudClient } from '../firebase';
import { venueLabel, type Venue } from '../../shared/venues';
import { GuidedLearning } from './GuidedLearning';
import './TradingVibesExperience.css';

export type ExperienceTab = 'chat' | 'markets' | 'agents' | 'you';
type Message = { id: string; role: 'user' | 'assistant'; content: string; at: number; state?: 'streaming' | 'failed' };
type Thread = { id: string; title: string; messages: Message[]; updatedAt: number };
type MarketRow = { symbol: string; coin?: string; dex?: string | null };
type CandleRecord = { time: number; open: number; high: number; low: number; close: number };
type MarketHistory = { source: string; candles: CandleRecord[]; observedGaps?: number; timeframe: string };
type Goal = 'learn' | 'markets' | 'create' | 'agents';
type Props = {
  client: CloudClient;
  bots: CloudBot[];
  area: ExperienceTab;
  onAreaChange: (area: ExperienceTab) => void;
  onCreate: () => void;
  onOpenBot: (bot: CloudBot) => void;
  onRenameBot: (bot: CloudBot, name: string, localOnly: boolean) => Promise<void>;
  onDeleteBot: (bot: CloudBot, localOnly: boolean) => Promise<void>;
  onShareBot: (bot: CloudBot) => void;
  onSettings: () => void;
  onConnect: (venue: 'valr' | 'propdao') => void;
  onAiSettings: () => void;
  onExplore: () => void;
  onSignOut: () => Promise<void>;
  cloudStatus: string;
  cloudMessage: string;
  onRetry: () => void;
};
const nowId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
const newThread = (): Thread => ({ id: nowId(), title: 'New conversation', messages: [], updatedAt: Date.now() });
const suggestions = [
  { icon: BookOpen, title: 'Learn trading', prompt: 'Teach me forex from the beginning, one simple concept at a time.' },
  { icon: TrendingUp, title: 'Understand a market', prompt: 'How do traders analyse gold, and what should a beginner look for?' },
  { icon: Bot, title: 'Create a trading agent', prompt: 'Help me turn an idea for a trading robot into clear rules I can backtest.' },
  { icon: ShieldCheck, title: 'Manage risk', prompt: 'Explain position sizing, stop losses and drawdown using a R500 example.' },
] as const;
const venues: Venue[] = ['valr', 'hyperliquid', 'propdao', 'ctrader'];
const support: Record<Venue, string> = {
  valr: 'South African exchange · account connection',
  hyperliquid: 'Decentralised markets · market-data integration',
  propdao: 'Challenge accounts · simulated capital',
  ctrader: 'Broker-based trading · connection dependent',
};
function extractThreads(value: unknown): Thread[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 15).filter((v): v is Thread => !!v && typeof v === 'object' && typeof v.id === 'string' && Array.isArray(v.messages))
    .map(t => ({ id: t.id, title: String(t.title || 'Conversation').slice(0, 72), updatedAt: Number(t.updatedAt) || Date.now(),
      messages: t.messages.slice(-40).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ id: String(m.id || nowId()), role: m.role, at: Number(m.at) || Date.now(), content: m.content.slice(0, 12000), state: m.state === 'streaming' ? 'failed' as const : m.state })) }));
}
function loadThreads(uid: string): Thread[] {
  try { return extractThreads(JSON.parse(localStorage.getItem('trading-vibes:experience:threads:' + uid) || '[]')); } catch { return []; }
}
function FriendlyText({ text }: { text: string }) {
  return <div className="tvx-rich-text">{text.split(/\n{2,}/).filter(Boolean).map((block, i) => <p key={i}>{block.split('\n').map((line, j) =>
    <span key={j}>{j > 0 && <><br /></>}{line.split(/(\*\*[^*]+\*\*)/).map((part, k) => part.startsWith('**') && part.endsWith('**') ? <strong key={k}>{part.slice(2, -2)}</strong> : <span key={k}>{part}</span>)}</span>)}</p>)}</div>;
}
function MiniBrand() { return <span className="tvx-brand"><span className="tvx-brand-mark"><Sparkles size={17}/></span><span>trading<span className="tvx-brand-accent">vibes</span></span></span>; }
function EmptyNotice({ icon: Icon, title, detail, action, onAction }: { icon: typeof Bot; title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="tvx-empty"><div className="tvx-empty-icon"><Icon size={25}/></div><strong>{title}</strong><p>{detail}</p>{action && onAction && <button className="tvx-outline" onClick={onAction}>{action}<ArrowRight size={16}/></button>}</div>;
}
function MarketChart({ history }: { history: MarketHistory | null }) {
  const chartEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = chartEl.current;
    if (!host || !history?.candles.length) return;
    const chart = createChart(host, { width: host.clientWidth, height: 300,
      layout: { background: { color: '#111722' }, textColor: '#B2BDCB', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12 },
      grid: { vertLines: { color: '#202939' }, horzLines: { color: '#202939' } },
      rightPriceScale: { borderColor: '#2A3344' }, timeScale: { borderColor: '#2A3344', timeVisible: true },
      crosshair: { vertLine: { color: '#B39BFF88' }, horzLine: { color: '#B39BFF88' } } });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#58D9AE', downColor: '#FF7C86', wickUpColor: '#58D9AE', wickDownColor: '#FF7C86', borderVisible: false });
    series.setData(history.candles.map(c => ({ ...c, time: c.time as never })));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth }));
    observer.observe(host);
    return () => { observer.disconnect(); chart.remove(); };
  }, [history]);
  return <div ref={chartEl} className="tvx-market-chart" aria-label="Historical candlestick market chart"/>;
}
const initialGoal: Record<Goal, string> = {
  learn: 'Teach me forex from zero, starting with the basics.',
  markets: 'Help me understand how to analyse the market using real data and sound risk management.',
  create: 'I want to create my own trading robot. Help me understand how strategies work.',
  agents: 'Explain how to test and safely manage an automated trading strategy.',
};
export function TradingVibesExperience({ client, bots, area, onAreaChange, onCreate, onOpenBot, onRenameBot, onDeleteBot, onShareBot, onSettings, onConnect, onAiSettings, onExplore, onSignOut, cloudStatus, cloudMessage, onRetry }: Props) {
  const profile = client.getProfile();
  const uid = profile?.uid || 'guest';
  const [threads, setThreads] = useState<Thread[]>(() => { const loaded = loadThreads(uid); return loaded.length ? loaded : [newThread()]; });
  const [threadId, setThreadId] = useState<string>(() => { const existing = loadThreads(uid); return existing[0]?.id || ''; });
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [showIntent, setShowIntent] = useState(() => { try { return localStorage.getItem('trading-vibes:experience:goal:' + uid) !== 'done'; } catch { return false; } });
  const [marketVenue, setMarketVenue] = useState<Venue>('propdao');
  const [watchlist, setWatchlist] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem('trading-vibes:watchlist:' + uid) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.length < 100).slice(0, 50) : []; } catch { return []; } });
  const [marketQuery, setMarketQuery] = useState('');
  const [marketRows, setMarketRows] = useState<MarketRow[]>([]);
  const [marketError, setMarketError] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);
  const [chosenMarket, setChosenMarket] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState('m5');
  const [marketHistory, setMarketHistory] = useState<MarketHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [agentFilter, setAgentFilter] = useState<'all' | 'tested' | 'draft'>('all');
  const [agentMenu, setAgentMenu] = useState<string | null>(null);
  const [agentAction, setAgentAction] = useState<{ kind: 'rename' | 'delete'; bot: CloudBot } | null>(null);
  const [agentName, setAgentName] = useState('');
  const [agentActionError, setAgentActionError] = useState('');
  const [agentWorking, setAgentWorking] = useState(false);
  const [youPanel, setYouPanel] = useState<'overview' | 'venues' | 'alerts' | 'help'>('overview');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [connectedNotice, setConnectedNotice] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const current = threads.find(t => t.id === threadId) || threads[0];
  const currentId = current?.id || threadId;
  const hasMessages = !!current?.messages.length;
  const isChat = area === 'chat';
  const setPage = (next: ExperienceTab) => { onAreaChange(next); setHistoryOpen(false); if (next !== 'you') setYouPanel('overview'); };
  const updateThread = (id: string, apply: (thread: Thread) => Thread) => setThreads(all => all.map(t => t.id === id ? apply(t) : t));
  useEffect(() => { if (!threadId && threads.length) setThreadId(threads[0].id); }, [threadId, threads]);
  useEffect(() => {
    try { localStorage.setItem('trading-vibes:experience:threads:' + uid, JSON.stringify(threads.slice(0, 15))); } catch { /* Storage unavailable. Session still works. */ }
  }, [threads, uid]);
  useEffect(() => { if (area === 'chat') endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [area, current?.messages.length, current?.messages.at(-1)?.content]);
  useEffect(() => { try { localStorage.setItem('trading-vibes:watchlist:' + uid, JSON.stringify(watchlist)); } catch {} }, [uid, watchlist]);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  const beginThread = () => { const thread = newThread(); setThreads(all => [thread, ...all].slice(0, 15)); setThreadId(thread.id); setInput(''); setHistoryOpen(false); onAreaChange('chat'); };
  const removeThread = (id: string) => {
    setThreads(all => { const remaining = all.filter(t => t.id !== id); return remaining.length ? remaining : [newThread()]; });
    if (id === currentId) setThreadId('');
  };
  const sendMessage = async (text: string, modelContext?: string) => {
    const content = text.trim();
    if (!content || pending) return;
    let activeId = currentId;
    if (!activeId) { const next = newThread(); activeId = next.id; setThreads([next]); setThreadId(activeId); }
    const requestId = nowId(), answerId = nowId();
    const user: Message = { id: requestId, role: 'user', content, at: Date.now() };
    const prior = (threads.find(t => t.id === activeId)?.messages || []).filter(m => m.state !== 'failed').slice(-12);
    updateThread(activeId, t => ({ ...t, title: t.messages.length ? t.title : content.slice(0, 58), updatedAt: Date.now(),
      messages: [...t.messages, user, { id: answerId, role: 'assistant', content: '', state: 'streaming', at: Date.now() }] }));
    setInput(''); setHistoryOpen(false); onAreaChange('chat'); setPending(true);
    const controller = new AbortController(); requestRef.current = controller;
    const systemPrompt = 'You are Trading Vibes, a careful educational AI assistant for trading. Help people learn, research concepts and design testable strategies. Use plain language, one question at a time. You have NO broker execution tools and NO backtest tool in this general conversation. Never claim to have sent orders, completed a backtest, connected an account, or seen real-time market data unless the user supplies verified source data. When the user requests a bot or backtest, explain how to open the real Create or Agents workspace. Trading involves potential losses; never guarantee outcomes or offer personalised investment instructions. Never request private keys, passwords or seed phrases. If a user asks to trade live, explain explicit authorisation and risk checks are required.';
    try {
      const token = await client.getIdToken();
      await postApiStream('/api/ai', { messages: [{ role: 'system', content: systemPrompt }, ...prior.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: modelContext ? content + '\n\nVerified historical market context (not a live quote):\n' + modelContext : content }], maxTokens: 1400, includeMarketContext: false },
        'Trading Vibes AI', (_delta, full) => updateThread(activeId, t => ({ ...t, messages: t.messages.map(m => m.id === answerId ? { ...m, content: full } : m) })), controller.signal, token);
      updateThread(activeId, t => ({ ...t, messages: t.messages.map(m => m.id === answerId ? { ...m, state: undefined } : m) }));
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      updateThread(activeId, t => ({ ...t, messages: t.messages.map(m => m.id === answerId ?
        { ...m, state: aborted ? undefined : 'failed', content: m.content || (aborted ? 'Response stopped.' : error instanceof Error ? error.message : 'Assistant unavailable. Retry when connected.') } : m) }));
    } finally { requestRef.current = null; setPending(false); }
  };
  const stopMessage = () => { requestRef.current?.abort(); };
  const askStarter = (prompt: string) => { setInput(prompt); onAreaChange('chat'); window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.tvx-composer textarea')?.focus(), 40); };
  useEffect(() => {
    if (area !== 'markets') return;
    const controller = new AbortController();
    setMarketLoading(true); setMarketError(''); setMarketRows([]); setChosenMarket(null); setMarketHistory(null);
    const path = marketVenue === 'valr' ? '/api/valr/markets' : '/api/venues/' + marketVenue + '/markets';
    void fetch(path, { signal: controller.signal }).then(response => readApiJson<{ markets: MarketRow[] }>(response, 'Market discovery'))
      .then(data => { if (!controller.signal.aborted) setMarketRows(Array.isArray(data.markets) ? data.markets.filter(m => typeof m.symbol === 'string').slice(0, 500) : []); })
      .catch(error => { if (!controller.signal.aborted) setMarketError(error instanceof Error ? error.message : 'Market discovery unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setMarketLoading(false); });
    return () => controller.abort();
  }, [area, marketVenue]);
  useEffect(() => {
    if (!chosenMarket || area !== 'markets') return;
    const controller = new AbortController(); setHistoryLoading(true); setHistoryError(''); setMarketHistory(null);
    const duration = timeframe === 'm1' ? 24 : timeframe === 'm5' ? 72 : 168;
    const now = Date.now() - 300000;
    void historicalData({ venue: marketVenue, asset: chosenMarket, timeframe,
      from: new Date(now - duration * 60 * 60 * 1000).toISOString(), to: new Date(now).toISOString() }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setMarketHistory({ source: data.source || venueLabel[marketVenue], timeframe, candles: data.candles, observedGaps: data.observedGaps }); })
      .catch(error => { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : 'Price history unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [chosenMarket, area, marketVenue, timeframe]);
  const marketWatchKey = (symbol: string) => marketVenue + ':' + symbol;
  const isWatched = (symbol: string) => watchlist.includes(marketWatchKey(symbol));
  const toggleWatch = (symbol: string) => setWatchlist(old => old.includes(marketWatchKey(symbol)) ? old.filter(k => k !== marketWatchKey(symbol)) : [...old, marketWatchKey(symbol)].slice(-50));
  const watchedCurrent = watchlist.filter(x => x.startsWith(marketVenue + ':')).map(x => x.slice(marketVenue.length + 1));
  const filteredMarkets = useMemo(() => marketRows.filter(r => (r.symbol + ' ' + (r.coin || '')).toLowerCase().includes(marketQuery.toLowerCase())).slice(0, 60), [marketRows, marketQuery]);
  const filteredBots = bots.filter(b => agentFilter === 'all' || (agentFilter === 'tested' ? !!b.lastBacktest : !b.lastBacktest));
  const chooseAgentAction = (kind: 'rename' | 'delete', bot: CloudBot) => { setAgentMenu(null); setAgentActionError(''); setAgentName(bot.name); setAgentAction({ kind, bot }); };
  const commitAgentAction = async () => { if (!agentAction || agentWorking) return; setAgentActionError(''); setAgentWorking(true); try { if (agentAction.kind === 'rename') { if (!agentName.trim()) throw new Error('Enter a name.'); await onRenameBot(agentAction.bot, agentName.trim(), false); } else await onDeleteBot(agentAction.bot, false); setAgentAction(null); } catch (error) { setAgentActionError(error instanceof Error ? error.message : 'Unable to update this agent.'); } finally { setAgentWorking(false); } };
  const marketAsOf = marketHistory?.candles.at(-1);
  const askAboutMarket = () => {
    if (!chosenMarket) return;
    const context = marketHistory?.candles.length ? 'Market: ' + chosenMarket + '. Venue: ' + venueLabel[marketVenue] + '. Timeframe: ' + timeframe + '. Source: ' + marketHistory.source + '. Last candle closed at: ' + new Date(marketHistory.candles.at(-1)!.time * 1000).toISOString() + '. Recent completed OHLC candles: ' + JSON.stringify(marketHistory.candles.slice(-16)) + '. Gaps noted: ' + (marketHistory.observedGaps || 0) : undefined;
    void sendMessage('Explain the recent price action on ' + chosenMarket + ' and what a beginner should learn from it. Include uncertainty and risk.', context);
  };
  const completeIntent = (goal?: Goal) => { try { localStorage.setItem('trading-vibes:experience:goal:' + uid, 'done'); } catch {} setShowIntent(false); if (goal === 'learn') setLessonOpen(true); else if (goal) askStarter(initialGoal[goal]); };
  const renderChat = () => <section className="tvx-chat" aria-label="AI trading assistant">
    <div className="tvx-chat-top"><button className="tvx-icon-button" onClick={() => setHistoryOpen(true)} aria-label="Conversation history"><History size={20}/></button><span className="tvx-chat-title">{hasMessages ? current.title : 'Your trading intelligence'}</span><button className="tvx-icon-button" onClick={beginThread} aria-label="New conversation" title="New conversation"><Plus size={21}/></button></div>
    <div className="tvx-conversation" ref={chatScroll}>
      {!hasMessages ? <div className="tvx-welcome"><div className="tvx-orb"><Sparkles size={30}/></div><span className="tvx-kicker">YOUR INTELLIGENCE, ON DEMAND</span><h1>Where would you like <em>to begin?</em></h1><p>Learn to trade, understand the market and bring your strategy ideas to life. Just ask.</p><div className="tvx-suggestion-grid">{suggestions.map(s => <button key={s.title} className="tvx-suggestion" onClick={() => s.title === 'Learn trading' ? setLessonOpen(true) : askStarter(s.prompt)><s.icon size={19}/><span>{s.title}</span><ArrowRight size={15}/></button>)}</div><p className="tvx-honesty">AI explanations can be wrong. Verify market data and test strategies before risking money.</p></div>
      : <div className="tvx-messages">{current.messages.map(message => <article className={['tvx-message', 'tvx-message-' + message.role].join(' ')} key={message.id}>
        {message.role === 'assistant' && <span className="tvx-message-avatar"><Sparkles size={15}/></span>}
        <div className="tvx-message-body">{message.content ? <FriendlyText text={message.content}/> : <span className="tvx-dots" aria-label="Thinking"><i/><i/><i/></span>}{message.state === 'failed' && <span className="tvx-message-error"><AlertCircle size={13}/> Request did not complete. Your earlier messages are still available.</span>}</div></article>)}
        {!pending && <div className="tvx-context-actions"><button onClick={() => setLessonOpen(true)}><BookOpen size={16}/> Continue learning</button><button onClick={onCreate}><Bot size={16}/> Build a robot</button><button onClick={() => setPage('markets')}><TrendingUp size={16}/> Explore markets</button><button onClick={() => setPage('agents')}><Layers3 size={16}/> My agents</button></div>}
        <div ref={endRef}/></div>}
    </div>
    <form className="tvx-composer-wrap" onSubmit={(event: FormEvent) => { event.preventDefault(); void sendMessage(input); }}><div className="tvx-composer"><textarea value={input} rows={1} onChange={e => setInput(e.target.value)} onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!pending) void sendMessage(input); } }} placeholder="Ask me anything about trading…" aria-label="Message Trading Vibes AI" maxLength={12000}/><div className="tvx-composer-actions"><button type="button" title="Voice conversations are planned" aria-label="Voice conversations coming soon" disabled><Mic size={18}/></button>{pending ? <button type="button" className="tvx-send" onClick={stopMessage} aria-label="Stop response"><Square size={16} fill="currentColor"/></button> : <button type="submit" className="tvx-send" disabled={!input.trim()} aria-label="Send message"><ArrowRight size={19}/></button>}</div></div><p className="tvx-chat-disclaimer">Trading Vibes is an AI tool, not a guarantee of trading results.</p></form>
  </section>;
  const renderMarkets = () => <section className="tvx-section tvx-markets"><div className="tvx-page-heading"><span className="tvx-kicker">RESEARCH STUDIO</span><h1>Markets</h1><p>Explore verified historical market data and ask better questions.</p></div>{chosenMarket ? <div className="tvx-market-detail">
    <button className="tvx-inline-back" onClick={() => { setChosenMarket(null); setMarketHistory(null); }}><ArrowLeft size={17}/> All markets</button><div className="tvx-market-detail-title"><div><h2>{chosenMarket}</h2><span>{venueLabel[marketVenue]} · historical prices</span></div><div className="tvx-market-detail-actions"><button className="tvx-watch-button" onClick={() => toggleWatch(chosenMarket)} aria-label={isWatched(chosenMarket) ? 'Remove from watchlist' : 'Add to watchlist'} aria-pressed={isWatched(chosenMarket)}><Star size={18} fill={isWatched(chosenMarket) ? 'currentColor' : 'none'}/></button><button className="tvx-quiet" onClick={askAboutMarket}><Sparkles size={16}/> Ask AI</button></div></div>
    <div className="tvx-market-timeframes" role="group" aria-label="Chart timeframe">{['m1', 'm5', 'm15', 'h1'].map(tf => <button key={tf} className={timeframe === tf ? 'selected' : ''} onClick={() => setTimeframe(tf)} aria-pressed={timeframe === tf}>{tf.toUpperCase()}</button>)}</div>
    <div className="tvx-market-canvas">{historyLoading ? <div className="tvx-chart-loading"><span className="tvx-spinner"/> Loading historical candles…</div> : historyError ? <EmptyNotice icon={AlertCircle} title="Chart data unavailable" detail={historyError} action="Change timeframe" onAction={() => setTimeframe(tf => tf === 'm5' ? 'h1' : 'm5')}/> : <MarketChart history={marketHistory}/>}</div>
    {marketHistory && <div className="tvx-source-line"><Clock3 size={14}/> {marketHistory.source} · Last completed candle {marketAsOf ? new Date(marketAsOf.time * 1000).toLocaleString() : 'unavailable'} · {marketHistory.observedGaps || 0} observed gaps</div>}
    <div className="tvx-market-cta"><button className="tvx-primary" onClick={askAboutMarket}><Sparkles size={17}/> Explain this market</button><button className="tvx-outline" onClick={onCreate}><Bot size={17}/> Build strategy</button></div><p className="tvx-footnote">Historical candles are not live quotes or trade recommendations. Prices and execution may differ.</p>
  </div> : <><div className="tvx-search"><Search size={18}/><input value={marketQuery} onChange={e => setMarketQuery(e.target.value)} placeholder="Search symbols and markets" aria-label="Search markets"/></div><div className="tvx-venue-pills">{venues.map(v => <button key={v} className={marketVenue === v ? 'selected' : ''} onClick={() => { setMarketVenue(v); setMarketQuery(''); }}>{venueLabel[v]}</button>)}</div>
    {watchedCurrent.length > 0 && <div className="tvx-watchlist"><span><Star size={15} fill="currentColor"/> YOUR WATCHLIST</span><div>{watchedCurrent.map(symbol => <button key={symbol} onClick={() => setChosenMarket(symbol)}>{symbol}<ArrowRight size={13}/></button>)}</div></div>}<div className="tvx-list-head"><h2>Available instruments</h2><span>{marketLoading ? 'Loading' : marketRows.length + ' listed'}</span></div><div className="tvx-market-list" aria-live="polite">{marketLoading ? <div className="tvx-loading-list"><span className="tvx-spinner"/> Loading instruments from {venueLabel[marketVenue]}…</div> : marketError ? <EmptyNotice icon={AlertCircle} title="Market list unavailable" detail={marketError} action="Try another venue" onAction={() => setMarketVenue('valr')}/> : filteredMarkets.length ? filteredMarkets.map(row => <div className="tvx-market-row-wrap" key={row.symbol}><button className="tvx-market-row" onClick={() => setChosenMarket(row.symbol)}><span className="tvx-market-symbol"><TrendingUp size={17}/></span><span className="tvx-market-name"><strong>{row.symbol}</strong><small>{row.coin || venueLabel[marketVenue]} · historical data</small></span><ChevronRight size={17}/></button><button className="tvx-watch-button" onClick={() => toggleWatch(row.symbol)} aria-label={(isWatched(row.symbol) ? 'Remove ' : 'Save ') + row.symbol + ' watchlist'} aria-pressed={isWatched(row.symbol)}><Star size={17} fill={isWatched(row.symbol) ? 'currentColor' : 'none'}/></button></div>) : <EmptyNotice icon={Search} title="No matching markets" detail="Try another symbol or venue. Available markets depend on the data provider."/>}</div>
    <div className="tvx-info-card"><ShieldCheck size={20}/><div><strong>Data first. Decisions second.</strong><p>Market discovery does not mean an account is connected or that an instrument is available for live execution.</p></div></div></>}
  </section>;
  const renderAgents = () => <section className="tvx-section tvx-agents"><div className="tvx-page-heading tvx-with-action"><div><span className="tvx-kicker">YOUR WORKSPACE</span><h1>Trading agents</h1><p>Build, test and manage strategies with clear control.</p></div><button className="tvx-primary tvx-create-button" onClick={onCreate}><Plus size={18}/> Create</button></div>
    {cloudStatus === 'error' && <div className="tvx-error-banner" role="alert"><AlertCircle size={18}/><span>{cloudMessage || 'Your saved robots are not fully synced.'}</span><button onClick={onRetry}>Retry</button></div>}
    <div className="tvx-agent-filters" role="group" aria-label="Filter trading agents">{([['all', 'All agents'], ['tested', 'Backtested'], ['draft', 'Drafts']] as const).map(([value, label]) => <button key={value} className={agentFilter === value ? 'selected' : ''} onClick={() => setAgentFilter(value)} aria-pressed={agentFilter === value}>{label}</button>)}</div>
    {filteredBots.length ? <div className="tvx-agent-list">{filteredBots.map(bot => <div className="tvx-agent-item" key={bot.id}><button className="tvx-agent-row" onClick={() => onOpenBot(bot)}><span className="tvx-agent-visual"><Bot size={23}/></span><span className="tvx-agent-copy"><strong>{bot.name || 'Untitled robot'}</strong><small>{bot.asset || 'Asset not set'} · {venueLabel[bot.venue || 'valr']}</small><span className={bot.lastBacktest ? 'tvx-status-tested' : 'tvx-status-draft'}>{bot.lastBacktest ? 'Backtest saved' : 'Draft · not verified for execution'}</span></span><ChevronRight size={18}/></button><div className="tvx-agent-actions"><button className="tvx-agent-more" onClick={() => setAgentMenu(agentMenu === bot.id ? null : bot.id)} aria-label={'Manage ' + bot.name} aria-expanded={agentMenu === bot.id}><MoreHorizontal size={19}/></button>{agentMenu === bot.id && <div className="tvx-agent-popover"><button onClick={() => chooseAgentAction('rename', bot)}>Rename</button><button onClick={() => { setAgentMenu(null); onShareBot(bot); }}>Share</button><button className="tvx-agent-delete" onClick={() => chooseAgentAction('delete', bot)}>Delete</button></div>}</div></div>)}</div> : <EmptyNotice icon={Bot} title={agentFilter === 'all' ? 'Your ideas start here' : 'Nothing in this category yet'} detail={agentFilter === 'all' ? 'Describe an idea, create a robot and test it against historical prices. You remain in control of deployment.' : 'Try another filter or create your first strategy.'} action="Create a robot" onAction={onCreate}/>}
    <div className="tvx-info-card"><ShieldCheck size={20}/><div><strong>Execution status is verified inside each agent.</strong><p>A saved robot is not necessarily deployed or running. Open an agent to check its latest confirmed state.</p></div></div>
    <button className="tvx-text-link" onClick={onExplore}><Compass size={16}/> Explore community strategies <ArrowRight size={15}/></button>
  </section>;
  const renderYou = () => <section className="tvx-section tvx-you"><div className="tvx-page-heading"><span className="tvx-kicker">ACCOUNT & CONTROL</span><h1>{youPanel === 'overview' ? 'You' : youPanel === 'venues' ? 'Connected venues' : youPanel === 'alerts' ? 'Notifications' : 'Help & safety'}</h1></div>{youPanel !== 'overview' && <button className="tvx-inline-back" onClick={() => setYouPanel('overview')}><ArrowLeft size={17}/> Back to account</button>}
    {youPanel === 'overview' && <><div className="tvx-profile-card"><div className="tvx-profile-avatar"><UserRound size={25}/></div><div><strong>{profile?.displayName || 'Trading Vibes member'}</strong><span>{profile?.email || 'Account connected'}</span><small><Check size={13}/> Signed in</small></div></div>
      <div className="tvx-list-head"><h2>Your account</h2></div><div className="tvx-settings-list">
        <button onClick={() => setYouPanel('venues')}><Wallet size={20}/><span><strong>Trading venues</strong><small>Accounts, access and capabilities</small></span><ChevronRight size={17}/></button>
        <button onClick={onAiSettings}><Sparkles size={20}/><span><strong>AI connection</strong><small>OpenRouter credentials and usage</small></span><ChevronRight size={17}/></button>
        <button onClick={onSettings}><UserRound size={20}/><span><strong>Profile and membership</strong><small>Account details and settings</small></span><ChevronRight size={17}/></button>
        <button onClick={() => setYouPanel('alerts')}><Bell size={20}/><span><strong>Notifications</strong><small>See available in-app status information</small></span><ChevronRight size={17}/></button>
        <button onClick={() => setYouPanel('help')}><CircleHelp size={20}/><span><strong>Help and safety</strong><small>How automation and permissions work</small></span><ChevronRight size={17}/></button>
      </div><button className="tvx-signout" onClick={() => setConfirmSignOut(true)}>Sign out <ArrowRight size={16}/></button></>}
    {youPanel === 'venues' && <><p className="tvx-page-explain">Choose a supported connection flow. An instrument appearing in market research does not mean you have execution access.</p><div className="tvx-venue-cards">{venues.map(v => <article className="tvx-venue-card" key={v}><span className="tvx-venue-icon"><Wallet size={20}/></span><div><strong>{venueLabel[v]}</strong><p>{support[v]}</p><small>{v === 'propdao' ? 'Evaluation and funded balances use simulated capital; rules and eligibility depend on the provider.' : v === 'hyperliquid' ? 'Wallet setup, funding and eligibility requirements vary. No universal no-KYC claim.' : 'Verification and permissions depend on the provider.'}</small></div>{v === 'valr' || v === 'propdao' ? <button onClick={() => onConnect(v)}>Manage <ArrowRight size={15}/></button> : <span className="tvx-venue-label">Check in agent workspace</span>}</article>)}</div>{connectedNotice && <p role="status">{connectedNotice}</p>}</>}
    {youPanel === 'alerts' && <EmptyNotice icon={Bell} title="Your agent activity stays in its workspace" detail="Open a trading agent to see verified runtime activity and risk events. Cross-agent notification delivery has not been enabled yet." action="Open agents" onAction={() => setPage('agents')}/>}
    {youPanel === 'help' && <div className="tvx-help-panel"><div className="tvx-info-card"><ShieldCheck size={20}/><div><strong>No silent trades</strong><p>Creating a strategy or chatting with AI never authorises live orders. The deployment workflow must explicitly confirm account and risk settings.</p></div></div><div className="tvx-info-card"><AlertCircle size={20}/><div><strong>Understand your capital model</strong><p>Historical backtests are simulations. PropDAO evaluations use simulated capital with provider rules. Brokerage execution can expose real funds to loss.</p></div></div><button className="tvx-outline" onClick={onSettings}><Settings2 size={16}/> Account security</button></div>}
  </section>;
  return <main className="tvx-shell"><aside className="tvx-desktop-rail"><MiniBrand/><p>YOUR TRADING INTELLIGENCE</p><nav aria-label="Main navigation">{([['chat', MessageCircle, 'Chat'], ['markets', TrendingUp, 'Markets'], ['agents', Bot, 'Agents'], ['you', UserRound, 'You']] as const).map(([key, Icon, label]) => <button key={key} className={area === key ? 'active' : ''} onClick={() => setPage(key)} aria-current={area === key ? 'page' : undefined}><Icon size={19}/>{label}</button>)}</nav><div className="tvx-rail-bottom"><span><ShieldCheck size={15}/> You control trading actions</span></div></aside>
    <div className="tvx-main"><header className="tvx-header"><MiniBrand/><span className="tvx-header-context">{area === 'chat' ? 'AI assistant' : area === 'markets' ? 'Market research' : area === 'agents' ? 'Strategy studio' : 'Your account'}</span><button className="tvx-header-avatar" onClick={() => setPage('you')} aria-label="Your account"><UserRound size={18}/></button></header>
      <div className="tvx-content">{isChat ? renderChat() : area === 'markets' ? renderMarkets() : area === 'agents' ? renderAgents() : renderYou()}</div>
      <nav className="tvx-mobile-tabs" aria-label="Main navigation">{([['chat', MessageCircle, 'Chat'], ['markets', TrendingUp, 'Markets'], ['agents', Bot, 'Agents'], ['you', UserRound, 'You']] as const).map(([key, Icon, label]) => <button key={key} className={area === key ? 'active' : ''} onClick={() => setPage(key)} aria-current={area === key ? 'page' : undefined}><Icon size={20}/><span>{label}</span></button>)}</nav>
    </div>
    {lessonOpen && <GuidedLearning uid={uid} onClose={() => setLessonOpen(false)} onAsk={q => { setLessonOpen(false); askStarter(q); }} onCreate={() => { setLessonOpen(false); onCreate(); }}/>} 
    {historyOpen && <div className="tvx-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setHistoryOpen(false); }}><div className="tvx-drawer" role="dialog" aria-modal="true" aria-label="Conversation history"><header><h2>Conversations</h2><button className="tvx-icon-button" onClick={() => setHistoryOpen(false)} aria-label="Close"><X size={20}/></button></header><button className="tvx-outline tvx-new-chat" onClick={beginThread}><Plus size={17}/> New conversation</button><div className="tvx-thread-list">{threads.map(thread => <div className="tvx-thread-row" key={thread.id}><button className={thread.id === currentId ? 'selected' : ''} onClick={() => { setThreadId(thread.id); setHistoryOpen(false); }}><MessageCircle size={16}/><span><strong>{thread.title}</strong><small>{new Date(thread.updatedAt).toLocaleDateString()}</small></span></button><button className="tvx-icon-button" onClick={() => removeThread(thread.id)} aria-label={'Delete conversation ' + thread.title}><X size={16}/></button></div>)}</div><p className="tvx-drawer-note">Recent conversations are saved on this device. Do not paste private keys or seed phrases.</p></div></div>}
    {showIntent && <div className="tvx-overlay tvx-intent-overlay"><section className="tvx-intent" role="dialog" aria-modal="true" aria-labelledby="tvx-intent-title"><div className="tvx-intent-orb"><Sparkles size={27}/></div><span className="tvx-kicker">WELCOME TO TRADING VIBES</span><h2 id="tvx-intent-title">What would you like to do first?</h2><p>Make it yours. You can change direction any time.</p><div className="tvx-intent-options">{([['learn', BookOpen, 'Learn trading', 'Start with plain-language lessons'], ['markets', TrendingUp, 'Understand markets', 'Research price action and risk'], ['create', Bot, 'Build a robot', 'Turn your ideas into strategies'], ['agents', ShieldCheck, 'Manage my agents', 'Understand automation and controls']] as const).map(([key, Icon, title, detail]) => <button key={key} onClick={() => completeIntent(key)}><Icon size={19}/><span><strong>{title}</strong><small>{detail}</small></span><ArrowRight size={16}/></button>)}</div><button className="tvx-skip" onClick={() => completeIntent()}>Skip for now</button></section></div>}
    {agentAction && <div className="tvx-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !agentWorking) setAgentAction(null); }}><section className="tvx-confirm" role="alertdialog" aria-modal="true"><h2>{agentAction.kind === 'delete' ? 'Delete this agent?' : 'Rename agent'}</h2>{agentAction.kind === 'delete' ? <p>Delete <strong>{agentAction.bot.name}</strong> and its saved code, chats, backtests and versions? This cannot be undone.</p> : <label className="tvx-rename-field">Name<input autoFocus maxLength={64} value={agentName} onChange={e => setAgentName(e.target.value)}/></label>}{agentActionError && <p role="alert" className="tvx-agent-form-error">{agentActionError}</p>}<div><button className="tvx-outline" disabled={agentWorking} onClick={() => setAgentAction(null)}>Cancel</button><button className="tvx-primary" disabled={agentWorking || (agentAction.kind === 'rename' && !agentName.trim())} onClick={() => void commitAgentAction()}>{agentWorking ? 'Working…' : agentAction.kind === 'delete' ? 'Delete agent' : 'Save name'}</button></div></section></div>}
    {confirmSignOut && <div className="tvx-overlay"><section className="tvx-confirm" role="alertdialog" aria-modal="true"><h2>Sign out of Trading Vibes?</h2><p>Your saved robots stay in your account. Conversations on this device are not automatically synced to another device.</p><div><button className="tvx-outline" onClick={() => setConfirmSignOut(false)}>Stay signed in</button><button className="tvx-primary" onClick={() => void onSignOut()}>Sign out</button></div></section></div>}
  </main>;
}
