import {useEffect, useId, useRef, useState} from 'react';
import {venueLabel, venueOf, type Venue} from '../../shared/venues';
import {AiOutputLimitError, chatStreamPath, postApiStream} from '../api';
import {compressBacktest, decompressBacktest, isCompressedBacktest} from '../backtest-storage';
import type {CloudBot, CloudClient} from '../firebase';
import {savedBacktestCard} from '../saved-backtest-card';
import {starterCode} from '../strategy';
import {backtestRange, simulateWorkbench, strategyMarkets, validateWorkbenchSource, workbenchDeployable, type StrategyRun} from '../strategy-workbench';
import {BacktestChatCard} from './BacktestChatCard';
import {sharingRequest} from './BotSharing';
import {Dialog} from './Dialog';

export type WorkbenchView = 'write' | 'backtest' | 'result';
type Props = {
  bot: CloudBot | null;
  client: CloudClient;
  initialView: WorkbenchView;
  onSaved: (bot: CloudBot) => void;
  onDeploy: (bot: CloudBot, riskPercent: number, codeHash?: string) => void;
  onClose: () => void;
};
const writableVenues = ['propdao', 'hyperliquid', 'valr'] as const;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';
const yesterdayUtc = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

export function StrategyWorkbench({bot, client, initialView, onSaved, onDeploy, onClose}: Props) {
  const [id] = useState(() => bot?.id || crypto.randomUUID());
  const [savedBot, setSavedBot] = useState(bot?.storageKey ? bot : null);
  const [view, setView] = useState(initialView);
  const [name, setName] = useState(bot?.name || '');
  const [venue, setVenue] = useState<Venue>(bot ? venueOf(bot.venue) : 'propdao');
  const [asset, setAsset] = useState(bot?.asset || '');
  const [rules, setRules] = useState(bot?.prompt || '');
  const [code, setCode] = useState(bot?.code || '');
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [from, setFrom] = useState(bot?.lastBacktest?.from || yesterdayUtc);
  const [to, setTo] = useState(bot?.lastBacktest?.to || yesterdayUtc);
  const [markets, setMarkets] = useState<string[]>([]);
  const [marketError, setMarketError] = useState('');
  const [reloadMarkets, setReloadMarkets] = useState(0);
  const [sourceReady, setSourceReady] = useState(!bot?.storageKey);
  const [run, setRun] = useState<StrategyRun | null>(null);
  const [runSaved, setRunSaved] = useState(false);
  const [loadingRun, setLoadingRun] = useState(Boolean(bot?.storageKey));
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef<AbortController | null>(null);
  const runStarted = useRef(false);
  const resultsSection = useRef<HTMLElement | null>(null);
  const marketsId = useId();
  const endpoint = `/api/user-bots/${encodeURIComponent(id)}`;
  const lockedIdentity = Boolean(savedBot);
  const currentRun = Boolean(run && run.strategyCode === code && run.venue === venue && run.asset === asset);
  const canReview = Boolean(savedBot && sourceReady && savedCode === code && workbenchDeployable(venue)
    && (venue !== 'propdao' || (runSaved && currentRun)));

  useEffect(() => {
    if (bot?.storageKey || venue === 'ctrader') return;
    const controller = new AbortController();
    setMarkets([]);
    setMarketError('');
    strategyMarkets(venue, controller.signal).then(items => {
      if (!controller.signal.aborted) setMarkets(items);
    }).catch(cause => {
      if (!controller.signal.aborted) setMarketError(errorText(cause));
    });
    return () => controller.abort();
  }, [bot?.storageKey, venue, reloadMarkets]);

  useEffect(() => {
    if (!bot?.storageKey) return;
    const controller = new AbortController();
    const options = {signal: controller.signal};
    sharingRequest<{code: string}>(client, endpoint + '/current', 'GET', undefined, options).then(saved => {
      if (controller.signal.aborted) return;
      setSavedCode(saved.code);
      setCode(saved.code);
      setSourceReady(true);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(errorText(cause));
    });
    sharingRequest<unknown>(client, endpoint + '/backtest', 'GET', undefined, options)
        .then(payload => isCompressedBacktest(payload) ? decompressBacktest<StrategyRun>(payload) : payload as StrategyRun)
        .then(saved => {
          if (controller.signal.aborted || runStarted.current) return;
          if (!savedBacktestCard(bot, saved)) throw Error('The saved backtest result is incomplete.');
          setRun(saved);
          setRunSaved(true);
        }).catch(cause => {
          if (!controller.signal.aborted && !runStarted.current && initialView === 'result') setError(errorText(cause));
        }).finally(() => {
          if (!controller.signal.aborted) setLoadingRun(false);
        });
    return () => controller.abort();
  }, [bot, client, endpoint, initialView]);
  useEffect(() => () => operation.current?.abort(), []);

  const perform = async (label: string, task: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await task(controller.signal);
    } catch (cause) {
      setError(controller.signal.aborted ? 'Operation cancelled.' : errorText(cause));
    } finally {
      operation.current = null;
      setBusy('');
      setProgress('');
    }
  };

  const identity = () => {
    const symbol = savedBot ? asset : markets.find(item => item.toLowerCase() === asset.trim().toLowerCase());
    if (!symbol) throw Error('Select an instrument from the venue’s market list.');
    return {venue, asset: symbol};
  };

  const save = async (signal: AbortSignal) => {
    if (!sourceReady) throw Error('Wait for the saved source to load.');
    if (venue === 'ctrader') throw Error('cTrader strategy changes are unavailable in this workspace.');
    const market = identity();
    if (!name.trim()) throw Error('Give this strategy a name.');
    validateWorkbenchSource(code);
    if (savedBot && savedCode === code) return savedBot;
    const {storageKey} = await sharingRequest<{storageKey: string}>(client, endpoint + '/current', 'PUT', {
      code, venue, ...(savedBot ? {expectedCode: savedCode} : {}),
    }, {signal});
    const updated: CloudBot = {...savedBot, id, name: name.trim(), ...market, prompt: savedBot?.prompt ?? rules, code, storageKey};
    if (!savedBot) await client.saveBot(updated, storageKey);
    setSavedBot(updated);
    setSavedCode(code);
    setAsset(market.asset);
    onSaved(updated);
    return updated;
  };

  const persistRun = async (target: CloudBot, completed: StrategyRun) => {
    setProgress('Saving the backtest result…');
    const payload = await compressBacktest(completed);
    await sharingRequest(client, endpoint + '/backtest', 'PUT', payload);
    setRunSaved(true);
    const metrics = Object.fromEntries(Object.entries(completed.result.metrics).map(([key, value]) =>
      [key, Number.isFinite(value) ? value : String(value)]));
    const lastBacktest = {metrics, candleCount: completed.result.candles.length, from: completed.from, to: completed.to};
    const updated = {...target, lastBacktest};
    setSavedBot(updated);
    onSaved(updated);
    try {
      await client.saveBacktestSummary(id, lastBacktest);
      setNotice('Backtest completed and saved.');
    } catch {
      setNotice('Backtest saved. The Library summary could not be synced. Open the strategy to see the saved result.');
    }
  };

  const generate = () => void perform('generate', async signal => {
    const market = identity();
    if (!rules.trim()) throw Error('Describe the strategy rules first.');
    setProgress('Generating strategy.js…');
    const token = await client.getIdToken();
    let response: string;
    try {
      response = await postApiStream(chatStreamPath(import.meta.env.VITE_AI_SDK_CHAT_ENABLED), {
        asset: market.asset, maxTokens: 6000, includeMarketContext: false, researchMode: false,
        messages: [
          {role: 'system', content: 'Generate a complete deterministic Trading Vibes strategy.js in one JavaScript code fence. Export const config = {timeframes, executionTimeframe, riskPercent, riskReward}; use lowercase m1, m5, m15, m30, h1, h4 or d1. riskPercent must be greater than 0 and at most 10. Export function onCandle(ctx). Use completed candles from ctx.timeframes, return BUY or SELL with valid stopLoss and takeProfit, or WAIT. No imports, network calls, future prices or hard-coded market prices. Only output code.'},
          {role: 'user', content: `Venue: ${venueLabel[market.venue]}. Instrument: ${market.asset}.\nRules: ${rules.trim()}`},
        ],
      }, 'OpenRouter', () => {}, AbortSignal.any([signal, AbortSignal.timeout(55_000)]), token);
    } catch (cause) {
      if (cause instanceof AiOutputLimitError) throw Error('AI stopped before completing the code. Try a shorter description or write the code manually.');
      throw cause;
    }
    const source = (response.match(/```(?:js|javascript)\s*([\s\S]*?)```/i)?.[1] || response).trim();
    validateWorkbenchSource(source);
    setCode(source);
    setNotice('AI draft ready. Review the generated code before saving or running it.');
  });

  const backtest = () => void perform('backtest', async signal => {
    const config = validateWorkbenchSource(code);
    backtestRange(from, to, config.timeframes);
    const target = await save(signal);
    runStarted.current = true;
    const completed = await simulateWorkbench({venue, asset: target.asset, strategyCode: code, from, to}, signal, setProgress);
    setRun(completed);
    setRunSaved(false);
    setView('result');
    requestAnimationFrame(() => resultsSection.current?.scrollIntoView({block: 'nearest'}));
    await persistRun(target, completed);
  });

  const reviewDeployment = () => void perform('review', async () => {
    if (!canReview || !savedBot) return;
    const {riskPercent} = validateWorkbenchSource(code);
    const digest = venue === 'propdao' ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)) : null;
    const codeHash = digest ? Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') : undefined;
    onDeploy(savedBot, riskPercent, codeHash);
  });
  const card = run ? savedBacktestCard({id, name, venue, asset, prompt: rules}, run) : null;
  return <Dialog title={bot ? bot.name : 'Write a strategy'} className="tv-strategy-workbench" busy={Boolean(busy)} onClose={onClose}>
    <div className="market-buttons tv-workbench-tabs" role="group" aria-label="Strategy workspace">
      {(['write', 'backtest', 'result'] as const).map(tab => <button key={tab} type="button" disabled={Boolean(busy)} aria-pressed={view === tab} className={view === tab ? 'primary' : 'ghost'} onClick={() => setView(tab)}>{{write: 'Write strategy', backtest: 'Backtest', result: 'Results'}[tab]}</button>)}
    </div>
    <p>{lockedIdentity ? `${asset} · ${venueLabel[venue]}` : 'Write JavaScript yourself or describe your rules and let AI generate a draft.'}</p>
    {!lockedIdentity && <div className="tv-workbench-fields">
      <label>Strategy name<input value={name} maxLength={64} disabled={Boolean(busy)} onChange={event => setName(event.target.value)} data-dialog-initial-focus /></label>
      <label>Venue<select value={venue} disabled={Boolean(busy)} onChange={event => {
        setVenue(event.target.value as Venue); setAsset(''); setMarkets([]);
      }}>{writableVenues.map(item => <option key={item} value={item}>{venueLabel[item]}</option>)}</select></label>
      <label>Instrument<input value={asset} list={marketsId} maxLength={64} disabled={Boolean(busy)} onChange={event => setAsset(event.target.value)} placeholder={markets.length ? 'Search markets…' : 'Loading markets…'} /></label>
      <datalist id={marketsId}>{markets.map(symbol => <option key={symbol} value={symbol} />)}</datalist>
    </div>}
    {marketError && <p role="alert">{marketError} <button type="button" className="ghost" onClick={() => setReloadMarkets(value => value + 1)}>Retry markets</button></p>}
    {error && <p role="alert" className="share-error">{error}</p>}
    {(progress || notice) && <p role="status">{progress || notice}</p>}
    {view === 'write' && <>
      {venue !== 'ctrader' && <details className="tv-workbench-ai">
        <summary>Generate code with AI</summary>
        <label>Trading rules<textarea rows={4} value={rules} maxLength={12_000} disabled={Boolean(busy)} onChange={event => setRules(event.target.value)} placeholder="Describe the timeframe, entries, exits and risk rules." /></label>
        <button type="button" className="ghost" disabled={Boolean(busy) || !sourceReady || !rules.trim()} onClick={generate}>Generate strategy.js</button>
      </details>}
      <label>Strategy JavaScript<textarea className="tv-workbench-editor" rows={12} spellCheck={false} readOnly={venue === 'ctrader'} value={code} disabled={Boolean(busy) || !sourceReady} onChange={event => setCode(event.target.value)} placeholder={sourceReady ? 'Paste or write strategy.js here.' : 'Loading saved source…'} /></label>
      <div className="market-buttons">
        {!code && sourceReady && <button type="button" className="ghost" disabled={Boolean(busy)} onClick={() => setCode(starterCode)}>Insert example</button>}
        <button type="button" className="ghost" disabled={Boolean(busy) || !sourceReady || !code.trim() || savedCode === code || venue === 'ctrader'} onClick={() => void perform('save', async signal => {
          await save(signal); setNotice('Strategy saved.');
        })}>Save strategy</button>
        <button type="button" className="primary" disabled={Boolean(busy) || !sourceReady || !code.trim() || venue === 'ctrader'} onClick={() => setView('backtest')}>Set up backtest</button>
      </div>
    </>}
    {view === 'backtest' && <>
      <p>Choose completed UTC dates. A new run saves the current strategy and replaces its last saved result once the simulation succeeds.</p>
      {venue === 'ctrader' && <p>cTrader historical backtesting is unavailable in this workspace.</p>}
      <div className="field-row">
        <label>From (UTC)<input type="date" value={from} max={to || yesterdayUtc()} disabled={Boolean(busy)} onChange={event => setFrom(event.target.value)} /></label>
        <label>To (UTC)<input type="date" value={to} min={from} max={yesterdayUtc()} disabled={Boolean(busy)} onChange={event => setTo(event.target.value)} /></label>
      </div>
      <div className="market-buttons">
        <button type="button" className="primary" disabled={Boolean(busy) || !sourceReady || !code.trim() || !from || !to || venue === 'ctrader'} onClick={backtest}>Run backtest</button>
      </div>
    </>}
    {view === 'result' && <section ref={resultsSection} aria-label="Strategy backtest result">
      {card ? <>
        <BacktestChatCard data={card} />
        <p>{runSaved ? currentRun ? 'Saved result for the current strategy code.' : 'Saved historical result. Run a new backtest to test the current code.' : 'Result is visible here but has not been saved.'}</p>
        {run?.logs?.length ? <details><summary>Simulation assumptions and log</summary><pre className="tv-code-source">{run.logs.join('\n')}</pre></details> : null}
      </> : <p>{loadingRun ? 'Loading saved result…' : 'Run a backtest to see results here.'}</p>}
      <div className="market-buttons">
        {run && !runSaved && savedBot && <button type="button" className="ghost" disabled={Boolean(busy) || !currentRun || savedCode !== code} onClick={() => void perform('save result', () => persistRun(savedBot, run))}>Retry saving result</button>}
        {canReview && savedBot && <button type="button" className="primary" disabled={Boolean(busy)} onClick={reviewDeployment}>Review deployment</button>}
        {venue === 'hyperliquid' && <p>Hyperliquid is available for historical research. Deployment is unavailable here.</p>}
      </div>
    </section>}
    {(busy === 'generate' || busy === 'backtest') && progress && !progress.startsWith('Saving') && <button type="button" className="ghost" onClick={() => operation.current?.abort()}>Cancel {busy === 'generate' ? 'generation' : 'backtest'}</button>}
  </Dialog>;
}
