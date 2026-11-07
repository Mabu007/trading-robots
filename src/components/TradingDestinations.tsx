import {displayTime} from '../display-time';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {CloudClient} from '../firebase';
import { Activity, ArrowRight, Bot, ChartCandlestick, CircleHelp, Clock3, Code2, Database, Plug, Search, Sparkles, Wallet } from 'lucide-react';
import { venueLabel, type Venue } from '../../shared/venues';
import type { CloudBot } from '../firebase';
import type { Candle } from '../types';
import type {AgentAuditEvent,PersistentAgent} from '../agents';
import './trading-destinations.css';

type Market = { symbol: string };
type History = { candles: Candle[]; source?: string };
type HistoryRequest = { venue: Venue; asset: string; timeframe: string; from: string; to: string };
type RuntimeSummary = { state: 'running' | 'stopped' | 'paused' | 'uncertain' | 'not-deployed' | 'unknown'; detail?: string };

const venues: Venue[] = ['valr', 'propdao', 'hyperliquid', 'ctrader'];
const timeframeSeconds: Record<string, number> = { m1: 60, m5: 300, m15: 900, h1: 3600 };

function lastClose(candles: Candle[]) {
  const candle = candles.at(-1);
  if (!candle) return null;
  return { value: candle.close, time: new Date(candle.time * 1000).toLocaleString() };
}

function CandleChart({ candles, asset }: { candles: Candle[]; asset: string }) {
  const rows = candles.slice(-120);
  const max = Math.max(...rows.map(candle => candle.high));
  const min = Math.min(...rows.map(candle => candle.low));
  const span = max - min || Math.abs(max) * .01 || 1;
  const xFor = (index: number) => 22 + index * (956 / Math.max(rows.length, 1));
  const yFor = (price: number) => 20 + ((max - price) / span) * 270;
  const width = Math.max(2, Math.min(8, 820 / Math.max(rows.length, 1)));
  return <svg className="tv-market-chart" viewBox="0 0 1000 330" role="img" aria-label={`${rows.length} historical ${asset} candles`}>
    <title>{asset} historical candles</title>
    {[0, 1, 2, 3].map(row => <g key={row}><line x1="20" x2="980" y1={22 + row * 90} y2={22 + row * 90} className="tv-chart-grid"/><text x="984" y={26 + row * 90} className="tv-chart-label">{(max - span * row / 3).toPrecision(5)}</text></g>)}
    {rows.map((candle, index) => {
      const up = candle.close >= candle.open;
      const top = yFor(Math.max(candle.open, candle.close));
      const height = Math.max(1.5, Math.abs(yFor(candle.close) - yFor(candle.open)));
      const x = xFor(index);
      return <g key={`${candle.time}-${index}`} className={up ? 'tv-candle-up' : 'tv-candle-down'}>
        <line x1={x} x2={x} y1={yFor(candle.high)} y2={yFor(candle.low)} stroke="currentColor" strokeWidth="1.5"/>
        <rect x={x - width / 2} y={top} width={width} height={height} rx="1" fill="currentColor"/>
      </g>;
    })}
  </svg>;
}

export function MarketsHub({ active, loadHistory, onAskAI, onBuildStrategy }: {
  active: boolean;
  loadHistory: (request: HistoryRequest) => Promise<History>;
  onAskAI: (prompt: string) => void;
  onBuildStrategy: (asset: string, venue: Venue) => void;
}) {
  const [venue, setVenue] = useState<Venue>('valr');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [asset, setAsset] = useState('');
  const [search, setSearch] = useState('');
  const [timeframe, setTimeframe] = useState('m15');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState('');
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const catalogCache = useRef(new Map<Venue, Market[]>());
  const visibleMarkets = useMemo(() => markets.filter(market => market.symbol.toLowerCase().includes(search.trim().toLowerCase())), [markets, search]);
  const close = lastClose(candles);

  useEffect(() => {
    let alive = true;
    if (!active) return;
    const cached = catalogCache.current.get(venue);
    if (cached) { setMarkets(cached); setAsset(current => cached.some(item => item.symbol === current) ? current : cached[0]?.symbol || ''); setLoadingMarkets(false); setError(''); return; }
    setMarkets([]); setAsset(''); setCandles([]); setError(''); setLoadingMarkets(true);
    if (venue === 'ctrader') {
      setError('cTrader market discovery is not available in this release. Its integration remains gated.');
      setLoadingMarkets(false);
      return () => { alive = false; };
    }
    const endpoint = venue === 'valr' ? '/api/valr/markets' : `/api/venues/${venue}/markets`;
    void fetch(endpoint).then(async response => {
      const body = await response.text();
      let data: { markets?: Market[] };
      try { data = JSON.parse(body); } catch { throw new Error(`Market catalogue returned an invalid response (HTTP ${response.status}).`); }
      if (!response.ok) throw new Error(`Market catalogue is unavailable (HTTP ${response.status}).`);
      const listed = Array.isArray(data.markets) ? data.markets.filter(item => item && typeof item.symbol === 'string') : [];
      if (alive) { catalogCache.current.set(venue, listed); setMarkets(listed); setAsset(listed[0]?.symbol || ''); if (!listed.length) setError('This venue did not return any market listings.'); }
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Could not load the venue market catalogue.'); })
      .finally(() => { if (alive) setLoadingMarkets(false); });
    return () => { alive = false; };
  }, [active, venue, catalogRetry]);

  useEffect(() => {
    if (!asset || !revision || venue === 'ctrader') return;
    let alive = true;
    const step = timeframeSeconds[timeframe] * 1000;
    const toMs = Math.floor(Date.now() / step) * step;
    const fromMs = toMs - step * 120;
    setLoadingHistory(true); setError(''); setCandles([]); setSource('');
    void loadHistory({ venue, asset, timeframe, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() })
      .then(result => { if (alive) { setCandles(result.candles); setSource(result.source || 'Trading Vibes historical market feed'); } })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Historical candles could not be loaded.'); })
      .finally(() => { if (alive) setLoadingHistory(false); });
    return () => { alive = false; };
  }, [revision, asset, venue, timeframe, loadHistory]);

  const requestChart = () => { if (!loadingHistory && asset) setRevision(value => value + 1); };
  const askAboutChart = () => onAskAI(`Explain the historical ${asset} ${timeframe.toUpperCase()} chart from ${source || 'the Trading Vibes historical feed'}. The most recent returned candle closed at ${close?.time || 'an unknown time'} with close ${close?.value ?? 'unavailable'}. Treat this as historical data, not a live quote.`);

  return <section className="tv-destination tv-markets-hub" aria-labelledby="tv-markets-title">
    <header className="tv-destination-heading"><div><span className="tv-destination-kicker"><ChartCandlestick size={15}/> MARKET RESEARCH</span><h1 id="tv-markets-title">Markets, with context.</h1><p>Browse venue listings and inspect verified historical candles. This view does not show live quotes or submit orders.</p></div><label className="tv-venue-picker"><span>Market source</span><select value={venue} onChange={event => setVenue(event.target.value as Venue)}>{venues.map(item => <option key={item} value={item}>{venueLabel[item]}{item === 'ctrader' ? ' · gated' : ''}</option>)}</select></label></header>
    <div className="tv-market-layout">
      <aside className="tv-market-list" aria-label="Market listings"><label className="tv-market-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search instruments" aria-label="Search instruments"/></label><div className="tv-market-source"><Database size={14}/><span>{loadingMarkets ? 'Loading venue catalogue…' : `${venueLabel[venue]} market catalogue`}</span></div>
        {visibleMarkets.slice(0, 150).map(market => <button className={`tv-market-row ${market.symbol === asset ? 'selected' : ''}`} key={market.symbol} onClick={() => { setAsset(market.symbol); setCandles([]); setRevision(0); }}><span className="tv-market-symbol">{market.symbol}</span><span className="tv-market-row-note">Venue listing · history checked on request</span><ArrowRight size={15}/></button>)}
        {!loadingMarkets && visibleMarkets.length === 0 && <div className="tv-market-empty"><p>{markets.length ? 'No instruments match your search.' : error || 'No venue listings are available.'}</p>{venue !== 'ctrader' && <button className="tv-hub-secondary" onClick={() => setCatalogRetry(value => value + 1)}>Retry catalogue</button>}</div>}
      </aside>
      <div className="tv-market-detail">
        {!asset ? <div className="tv-hub-empty"><ChartCandlestick size={25}/><h2>Select a market</h2><p>Choose an instrument from the venue catalogue to load its actual historical candles.</p></div> : <>
          <div className="tv-market-detail-head"><div><span className="tv-destination-kicker">{venueLabel[venue]} · HISTORICAL DATA</span><h2>{asset}</h2><p>Historical candles only. The last candle time below is the data timestamp; no live price is implied.</p></div><label>Timeframe<select value={timeframe} onChange={event => { setTimeframe(event.target.value); setRevision(value => value || 1); }}><option value="m1">1 minute</option><option value="m5">5 minutes</option><option value="m15">15 minutes</option><option value="h1">1 hour</option></select></label></div>
          {revision === 0 && !loadingHistory ? <div className="tv-hub-empty"><Clock3 size={25}/><h3>Load historical candles</h3><p>Trading Vibes will request the latest 120 candles from the selected venue's historical data service.</p><button className="tv-hub-primary" onClick={requestChart}>Load chart <ArrowRight size={15}/></button></div> : loadingHistory ? <div className="tv-market-loading" role="status"><span className="tv-hub-spinner"/> Loading historical candles…</div> : candles.length > 0 ? <>
            <div className="tv-market-chart-wrap"><CandleChart candles={candles} asset={asset}/></div>
            <div className="tv-market-provenance"><span><Database size={14}/> {source}</span><span>{candles.length} candles</span><span><Clock3 size={14}/> Last candle {close?.time}</span><strong>Historical close {close?.value}</strong></div>
            <div className="tv-market-actions"><button className="tv-hub-secondary" onClick={requestChart} disabled={loadingHistory}>Refresh history</button><button className="tv-hub-secondary" onClick={askAboutChart}>Ask AI about this chart <Sparkles size={15}/></button><button className="tv-hub-primary" onClick={() => onBuildStrategy(asset, venue)}>Build a strategy <ArrowRight size={15}/></button></div>
          </> : <div className="tv-hub-empty tv-hub-error" role="alert"><CircleHelp size={25}/><h3>Historical candles unavailable</h3><p>{error || 'No candles were returned for this instrument and period.'}</p><button className="tv-hub-secondary" onClick={requestChart}>Try again</button></div>}
        </>}
      </div>
    </div>
  </section>;
}

export function AgentLibrary({ mode='strategies', bots, current, runtime, search, onSearch, onCreate, onOpen, onBacktest, onCode, onDeploy, agents=[], audits={}, runtimeStates={}, agentError='', onRefreshAgents=()=>{}, onOpenAgent=()=>{}, onViewAudit=()=>{} }: {
  mode?: 'scheduled' | 'strategies'; bots: CloudBot[]; current: CloudBot | null; runtime: RuntimeSummary; search: string; onSearch: (value: string) => void;
  onCreate: () => void; onOpen: (bot: CloudBot) => void; onBacktest: () => void; onCode: () => void; onDeploy: () => void;
  agents?:PersistentAgent[];audits?:Record<string,AgentAuditEvent[]>;runtimeStates?:Record<string,{state:string;verified?:boolean;lastSignal?:string|null;nextCheck?:number|null;openPositions?:number|null;error?:string|null}>;agentError?:string;onRefreshAgents?:()=>void;onOpenAgent?:(agent:PersistentAgent)=>void;onViewAudit?:(id:string)=>void;
}) {
  const filtered = bots.filter(bot => [bot.name, bot.asset, venueLabel[bot.venue || 'valr']].join(' ').toLowerCase().includes(search.toLowerCase()));
  const libraryBots = filtered.filter(bot => bot.id !== current?.id);
  const isScheduled = mode === 'scheduled';
  const currentHasAgent = Boolean(current && agents.some(agent => agent.botId === current.id));
  const badge = (state: RuntimeSummary['state']) => ({ running: 'Running', stopped: 'Stopped', paused: 'Paused', uncertain: 'Needs attention', 'not-deployed': 'Draft', unknown: 'Open to verify' }[state]);
  return <section className="tv-destination tv-agents-hub" aria-labelledby="tv-agents-title">
    <header className="tv-destination-heading"><div><span className="tv-destination-kicker"><Bot size={15}/>{isScheduled?' SCHEDULED &amp; RUNNING':' STRATEGIES'}</span><h1 id="tv-agents-title">{isScheduled?'Your scheduled work.':'Your strategies.'}</h1><p>{isScheduled?'Review authorized backtests and deployed agents. Live market watchers run through the existing Durable Object runtime; a conversation by itself does not start a process.':'Create, edit, backtest, and prepare strategies here. Saving a strategy does not deploy it.'}</p></div>{!isScheduled&&<button className="tv-hub-primary" onClick={onCreate}>New strategy <ArrowRight size={15}/></button>}</header>
    {current && (!isScheduled || currentHasAgent) && <section className="tv-active-agent" aria-label={isScheduled?"Selected durable agent":"Selected strategy"}><div className="tv-active-agent-heading"><span className="tv-agent-mark"><Bot size={19}/></span><div><span className="tv-destination-kicker">{isScheduled?"CURRENT AGENT":"CURRENT STRATEGY"} · {badge(runtime.state).toUpperCase()}</span><h2>{current.name || 'Untitled agent'}</h2><p>{current.asset || 'No instrument'} · {venueLabel[current.venue || 'valr']} {runtime.detail ? `· ${runtime.detail}` : ''}</p></div></div><div className="tv-active-agent-actions"><button onClick={onBacktest}><Activity size={15}/> Backtest</button><button onClick={onCode}><Code2 size={15}/> Strategy code</button><button className="tv-hub-primary" onClick={onDeploy}>Review deployment</button></div>{runtime.state === 'uncertain' && <p className="tv-runtime-alert" role="alert">Execution state is uncertain. Reconcile with the venue before starting or deploying this agent.</p>}</section>}
    {isScheduled&&<section className="tv-persistent-agents" aria-labelledby="tv-persistent-agents-title"><header><div><h2 id="tv-persistent-agents-title">Durable agents and runs</h2><p>Created when you start a backtest or authorize a deployment. Conversations stay independent. Live agents run in the existing Durable Object runtime; backtests use the existing historical engine.</p></div><button className="tv-hub-secondary" onClick={onRefreshAgents}>Refresh</button></header>
      {agentError&&<p className="tv-runtime-alert" role="alert">{agentError}</p>}
      {agents.length ? <div className="tv-agent-library-list">{agents.map(agent=>{const live=runtimeStates[agent.id],state=live?.state||agent.state;const statusLabel:Record<string,string>={backtest_running:'Backtest running',backtest_completed:'Backtest complete',backtest_failed:'Backtest failed',deployment_pending:'Deployment pending',running:'Running',paused:'Paused',stopped:'Stopped',unknown:'Status unknown'};const grants=[agent.permissions.marketDataRead&&'market data',agent.permissions.backtests&&'backtests',agent.permissions.brokerStateRead&&'broker status',agent.permissions.liveExecution&&'live execution'].filter(Boolean);const events=audits[agent.id];return <article className="tv-persistent-agent" key={agent.id}><div className="tv-persistent-agent-main"><span className="tv-agent-mark"><Bot size={18}/></span><div className="tv-library-agent-copy"><h3>{agent.name}</h3><p>{agent.asset} · {venueLabel[agent.venue]} · {agent.mode==='live'?'live deployment':'historical backtest'}</p><span>{statusLabel[state]||state} · strategy v{agent.strategy.revision} · {grants.length?`Permissions: ${grants.join(', ')}`:'read only'}</span>{live?.verified===false&&agent.mode==='live'&&<small className="tv-agent-unverified">Runtime status not verified</small>}{live?.error&&<small className="tv-agent-unverified">{live.error}</small>}{agent.lastError&&<small className="tv-agent-unverified">{agent.lastError}</small>}{agent.lastBacktest&&<small>Last result · {agent.lastBacktest.summary.trades??0} trades · completed {displayTime(agent.lastBacktest.completedAt)}</small>}{live?.lastSignal&&<small>Latest signal · {live.lastSignal}</small>}{live?.nextCheck&&<small>Next check · {displayTime(live.nextCheck)}</small>}{live?.openPositions!==null&&live?.openPositions!==undefined&&<small>Open positions · {live.openPositions}</small>}</div></div><div className="tv-persistent-agent-actions"><button className="tv-hub-secondary" onClick={()=>onOpenAgent(agent)}>Open</button><button className="tv-hub-secondary" onClick={()=>onViewAudit(agent.id)}>Audit trail</button></div>{events&&<ol className="tv-agent-audit">{events.map(event=><li key={event.id}><span>{displayTime(event.occurredAt)}</span><strong>{event.action.replaceAll('_',' ')}</strong><span>{event.fromState||'created'} → {event.toState}</span>{event.details.error&&<small>{String(event.details.error)}</small>}</li>)}</ol>}</article>})}</div> : <div className="tv-persistent-agent-empty">No agent record yet. Start a historical backtest or explicitly authorize a deployment to create one; conversations alone do not create or run agents.</div>}
    </section>}
    {!isScheduled&&<>
    <div className="tv-library-toolbar"><label className="tv-market-search"><Search size={16}/><input value={search} onChange={event => onSearch(event.target.value)} placeholder="Search strategies" aria-label="Search strategies"/></label><span>{filtered.length} saved {filtered.length === 1 ? 'strategy' : 'strategies'}</span></div>
    {libraryBots.length ? <div className="tv-agent-library-list">{libraryBots.map(bot => <article className="tv-library-agent" key={bot.id}><span className="tv-agent-mark"><Bot size={18}/></span><div className="tv-library-agent-copy"><h3>{bot.name || 'Untitled strategy'}</h3><p>{bot.asset || 'No instrument'} · {venueLabel[bot.venue || 'valr']}</p><span>Saved strategy · not running unless deployed</span></div>{bot.lastBacktest && <span className="tv-library-backtest">Last test · {bot.lastBacktest.candleCount.toLocaleString()} candles</span>}<button className="tv-hub-secondary" onClick={() => onOpen(bot)}>Open strategy <ArrowRight size={14}/></button></article>)}</div> : <div className="tv-hub-empty"><Bot size={26}/><h2>{search ? 'No other strategies match that search.' : current ? 'No other saved strategies yet.' : 'No saved strategies yet.'}</h2><p>{search ? 'Try another name, instrument or venue.' : current ? 'You can keep working on the selected strategy above, or create another one.' : 'Learn, research and chat first. Save a strategy when you are ready to test or deploy it.'}</p>{!search && <button className="tv-hub-primary" onClick={onCreate}>{current ? 'Create another strategy' : 'Create a strategy'} <ArrowRight size={15}/></button>}</div>}
    </>}
  </section>;
}

export function YouHub({ onAISettings, onBroker }: {
  onAISettings: () => void; onBroker: () => void;
}) {
  return <section className="tv-destination tv-you-hub" aria-labelledby="tv-apps-title">
    <header className="tv-destination-heading"><div><span className="tv-destination-kicker"><Plug size={15}/> CONNECTED APPS</span><h1 id="tv-apps-title">Apps</h1><p>Connect the AI and broker services Trading Vibes can use on your behalf.</p></div></header>
    <div className="tv-you-list tv-app-connections">
      <button type="button" onClick={onAISettings}><span><Sparkles size={18}/></span><span><strong>OpenRouter AI</strong><small>Connect your account, choose a model and manage spending limits</small></span><ArrowRight size={15}/></button>
      {([['propdao','PropDAO','Connect your PropDAO developer key'],['ctrader','cTrader','Connect your cTrader ID'],['valr','VALR','Connect your VALR account']] as const).map(([id,label,description])=><button type="button" key={id} disabled={id!=='propdao'} onClick={onBroker}><span><Wallet size={18}/></span><span><strong>{label}</strong><small>{description}</small></span>{id==='propdao'?<ArrowRight size={15}/>:<span className="tv-paused-label">Paused</span>}</button>)}
      
    </div>
  </section>;
}