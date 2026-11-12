import {useEffect, useId, useRef, useState} from 'react';
import {Activity,ArrowRight,Bot,CalendarDays,CheckCircle2,Code2,FileCode2,Play,ShieldCheck,Sparkles} from 'lucide-react';
import './premium-workbench.css';
import {venueLabel, venueOf, type Venue} from '../../shared/venues';
import {chatStreamPath, postApiStream} from '../api';
import {generateStrategyWithRecovery} from '../strategy-ai-generation';
import {compressBacktest, decompressBacktest, isCompressedBacktest} from '../backtest-storage';
import type {CloudBot, CloudClient} from '../firebase';
import {savedBacktestCard} from '../saved-backtest-card';
import {BacktestTradeInspector} from './BacktestTradeInspector';
import type {Trade} from '../types';
import type {AppTheme} from '../theme';
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
  onAuditTrade?: (run: StrategyRun, trade: Trade, bot: CloudBot | null) => void;
  theme?: AppTheme;
  onClose: () => void;
};
const writableVenues = ['propdao', 'hyperliquid', 'valr'] as const;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';
const yesterdayUtc = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

export function StrategyWorkbench({bot, client, initialView, onSaved, onDeploy, onAuditTrade, theme='light', onClose}: Props) {
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
  const [inspectedTradeId,setInspectedTradeId] = useState<number|null>(null);
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
    const system = 'Generate a concise, complete deterministic Trading Vibes strategy.js in a single JavaScript code fence. Use a static export const config = {timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2}; with a trailing semicolon. Allowed timeframe strings: m1,m5,m15,m30,h1,h4,d1. Export function onCandle(ctx). Only use COMPLETED candles in ctx.timeframes. Return BUY or SELL with positive stopLoss and takeProfit, or WAIT; include warmup and zero-volatility guards. Use short, clear functions and no dependencies. No imports, network, broker keys, future candles or hard-coded prices. No explanations, tests, comments or markdown outside the code fence. Keep under 350 lines.';
    const user = 'Venue: '+venueLabel[market.venue]+'. Instrument: '+market.asset+'.\nStrategy rules: '+rules.trim();
    const source = await generateStrategyWithRecovery({
      system,user,signal,
      progress:setProgress,
      request:async(messages,requestSignal)=>{
        const token=await client.getIdToken();
        return postApiStream(chatStreamPath(import.meta.env.VITE_AI_SDK_CHAT_ENABLED),{
          asset:market.asset,maxTokens:6000,includeMarketContext:false,researchMode:false,messages
        },'OpenRouter',()=>{},AbortSignal.any([requestSignal,AbortSignal.timeout(55_000)]),token);
      }
    });
    setCode(source);
    setNotice('AI draft ready. Review the generated code before saving or running it.');
  });

  const backtest = () => void perform('backtest', async signal => {
    const config = validateWorkbenchSource(code);
    backtestRange(from, to, config.timeframes);
    const target = await save(signal);
    runStarted.current = true;
    setInspectedTradeId(null);
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
  const presets=[{name:'Yesterday',days:1},{name:'7 days',days:7},{name:'30 days',days:30}] as const;
  const presetRange=(days:number)=>{
    const end=new Date(Date.now()-86_400_000).toISOString().slice(0,10);
    const start=new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86_400_000).toISOString().slice(0,10);
    setFrom(start);setTo(end);
  };
  const prettyDate=(value:string)=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return 'Choose a date';
    const date=new Date(value+'T00:00:00Z');
    if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)return 'Choose a date';
    return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(date);
  };

  return <Dialog title={bot ? bot.name : 'Build a strategy'} className="tv-strategy-workbench" busy={Boolean(busy)} onClose={onClose}>
   <div className="tv-workbench-studio">
    <div className="tv-workbench-hero">
     <div className="tv-workbench-hero-brand"><span className="tv-workbench-orb"><Bot size={21}/></span><div><span className="tv-workbench-eyebrow">TRADING VIBES / BACKTEST STUDIO</span><h3>{name.trim()||'Your next backtest strategy'}</h3><p>{savedBot?'Saved strategy · '+venueLabel[venue]+' · '+asset:'Create the idea, backtest it, then track your signals.'}</p></div></div>
     <span className={'tv-workbench-pill'+(savedBot?' is-saved':'')}><span className="tv-workbench-dot"/>{savedBot?'Saved':'Draft'}</span>
    </div>
    <div className="tv-workbench-stepper" role="tablist" aria-label="Strategy backtesting workflow">
     {([{id:'write',icon:FileCode2,label:'Build',desc:'Strategy rules'},{id:'backtest',icon:Activity,label:'Backtest',desc:'Historical research'},{id:'result',icon:ShieldCheck,label:'Review',desc:'Results & signals'}] as const).map(({id,icon:Icon,label,desc},index)=>
      <button key={id} type="button" role="tab" aria-selected={view===id} className={'tv-workbench-step'+(view===id?' is-active':'')} disabled={Boolean(busy)} onClick={()=>setView(id)}>
       <span className="tv-workbench-step-icon"><Icon size={17}/></span><span className="tv-workbench-step-copy"><strong>{String(index+1).padStart(2,'0')} · {label}</strong><small>{desc}</small></span>
      </button>)}
    </div>
    {(error||marketError)&&<div className="tv-workbench-alert" role="alert"><strong>Action needed</strong><p>{error||marketError}</p>{marketError&&<button type="button" className="tv-workbench-text-action" onClick={()=>setReloadMarkets(value=>value+1)}>Retry loading markets</button>}</div>}
    {(progress||notice)&&<div className="tv-workbench-feedback" role="status"><CheckCircle2 size={16}/>{progress||notice}</div>}
    {view==='write'&&<div className="tv-workbench-content">
     <div className="tv-workbench-section-intro"><div><span className="tv-workbench-section-kicker">01 / STRATEGY RULES</span><h4>Make it yours.</h4><p>Define the market, then write your rules or have VIBES draft the JavaScript.</p></div></div>
     {!lockedIdentity&&<div className="tv-workbench-identity">
      <label className="tv-workbench-input"><span>Strategy name</span><input value={name} maxLength={64} disabled={Boolean(busy)} onChange={event=>setName(event.target.value)} placeholder="e.g. Gold Session Scalper" data-dialog-initial-focus/></label>
      <label className="tv-workbench-input"><span>Trading venue</span><select value={venue} disabled={Boolean(busy)} onChange={event=>{setVenue(event.target.value as Venue);setAsset('');setMarkets([])}}>{writableVenues.map(item=><option key={item} value={item}>{venueLabel[item]}</option>)}</select></label>
      <label className="tv-workbench-input"><span>Instrument</span><input value={asset} list={marketsId} maxLength={64} disabled={Boolean(busy)} onChange={event=>setAsset(event.target.value)} placeholder={markets.length?'Search symbols…':'Loading symbols…'}/><datalist id={marketsId}>{markets.map(symbol=><option key={symbol} value={symbol}/>)}</datalist></label>
     </div>}
     {lockedIdentity&&<div className="tv-workbench-locked"><ShieldCheck size={17}/><span>Strategy identity is locked to <strong>{asset}</strong> on <strong>{venueLabel[venue]}</strong>. Edits won't silently switch the trading instrument.</span></div>}
     <details className="tv-workbench-ai">
      <summary><span className="tv-workbench-ai-icon"><Sparkles size={19}/></span><span><strong>Generate with VIBES</strong><small>Describe your strategy in plain English. Review all generated code.</small></span><span className="tv-workbench-ai-caret">Expand</span></summary>
      <div className="tv-workbench-ai-body"><label className="tv-workbench-input"><span>Trading rules</span><textarea rows={5} value={rules} maxLength={12_000} disabled={Boolean(busy)} onChange={event=>setRules(event.target.value)} placeholder="Example: Trade Gold on M1, follow the H1 trend, enter after a pullback and use a fixed 1:2 risk/reward ratio…"/></label>
       <div className="tv-workbench-ai-controls"><small>Uses your connected OpenRouter model. Rate limits belong to your selected provider.</small><button type="button" className="tv-workbench-primary" disabled={Boolean(busy)||!sourceReady||!rules.trim()} onClick={generate}><Sparkles size={15}/>{busy==='generate'?'Generating…':'Generate strategy.js'}</button></div>
      </div>
     </details>
     <div className="tv-workbench-code-wrap">
      <div className="tv-workbench-code-head"><span><Code2 size={16}/><strong>strategy.js</strong></span><small>{sourceReady?'JavaScript · editable source':'Loading saved source…'}</small></div>
      <textarea className="tv-workbench-editor" rows={15} spellCheck={false} readOnly={venue==='ctrader'} value={code} disabled={Boolean(busy)||!sourceReady} onChange={event=>setCode(event.target.value)} aria-label="Strategy JavaScript" placeholder={sourceReady?'Paste or write your deterministic strategy.js source here.':'Loading saved strategy source…'}/>
      <div className="tv-workbench-code-footer"><small><ShieldCheck size={13}/> Saving code never authorizes orders.</small><span>{code.length.toLocaleString()} characters</span></div>
     </div>
     <div className="tv-workbench-toolbar">
      <div>{!code&&sourceReady&&<button type="button" className="tv-workbench-secondary" disabled={Boolean(busy)} onClick={()=>setCode(starterCode)}>Insert example</button>}<button type="button" className="tv-workbench-secondary" disabled={Boolean(busy)||!sourceReady||!code.trim()||savedCode===code||venue==='ctrader'} onClick={()=>void perform('save',async signal=>{await save(signal);setNotice('Signal strategy saved.')})}>Save strategy</button></div>
      <button type="button" className="tv-workbench-primary" disabled={Boolean(busy)||!sourceReady||!code.trim()||venue==='ctrader'} onClick={()=>setView('backtest')}>Set up backtest <ArrowRight size={16}/></button>
     </div>
    </div>}
    {view==='backtest'&&<div className="tv-workbench-content">
     <div className="tv-workbench-section-intro"><div><span className="tv-workbench-section-kicker">02 / HISTORICAL RESEARCH</span><h4>Pick your research window.</h4><p>Dates are interpreted in UTC. Results use historical data and simulated fills, not actual broker execution.</p></div><CalendarDays className="tv-workbench-heading-icon" size={26}/></div>
     <div className="tv-workbench-range-card">
      <div className="tv-workbench-range-head"><strong>Backtest date range</strong><span>UTC calendar dates</span></div>
      <div className="tv-workbench-dates">
       <label className="tv-workbench-date"><span>FROM · UTC</span><strong>{prettyDate(from)}</strong><input type="date" aria-label="From (UTC)" value={from} max={to||yesterdayUtc()} disabled={Boolean(busy)} onChange={event=>setFrom(event.target.value)}/><CalendarDays size={17}/></label>
       <span className="tv-workbench-date-arrow"><ArrowRight size={18}/></span>
       <label className="tv-workbench-date"><span>TO · UTC</span><strong>{prettyDate(to)}</strong><input type="date" aria-label="To (UTC)" value={to} min={from} max={yesterdayUtc()} disabled={Boolean(busy)} onChange={event=>setTo(event.target.value)}/><CalendarDays size={17}/></label>
      </div>
      <div className="tv-workbench-presets"><span>Quick range</span>{presets.map(preset=><button type="button" key={preset.days} disabled={Boolean(busy)} onClick={()=>presetRange(preset.days)}>{preset.name}</button>)}</div>
     </div>
     <div className="tv-workbench-summary"><div><Play size={17}/><span><strong>{asset||'Select a market'} · {venueLabel[venue]}</strong><small>Executes your saved strategy against available completed candles</small></span></div><span className="tv-workbench-utc">UTC</span></div>
     <div className="tv-workbench-toolbar"><button type="button" className="tv-workbench-secondary" disabled={Boolean(busy)} onClick={()=>setView('write')}>Edit strategy</button><button type="button" className="tv-workbench-primary" disabled={Boolean(busy)||!sourceReady||!code.trim()||!from||!to||venue==='ctrader'} onClick={backtest}><Play size={16}/>{busy==='backtest'?'Backtesting…':'Run backtest'}</button></div>
     {(busy==='generate'||busy==='backtest')&&progress&&!progress.startsWith('Saving')&&<button type="button" className="tv-workbench-cancel" onClick={()=>operation.current?.abort()}>Cancel operation</button>}
    </div>}
    {view==='result'&&<section ref={resultsSection} className="tv-workbench-content tv-workbench-results" aria-label="Signal strategy backtest result">
      <div className="tv-workbench-section-intro"><div><span className="tv-workbench-section-kicker">03 / BACKTEST RESULTS</span><h4>Understand the backtest.</h4><p>Inspect simulated BUY/SELL entries, exits and performance. You can separately create a live condition in Signals.</p></div><Activity className="tv-workbench-heading-icon" size={26}/></div>
      {card?<><BacktestChatCard data={card} onInspect={tradeId=>setInspectedTradeId(tradeId)}/>
        {run&&inspectedTradeId!==null&&run.result.trades.some(trade=>trade.id===inspectedTradeId)&&
         <BacktestTradeInspector run={run} tradeId={inspectedTradeId} theme={theme} onClose={()=>setInspectedTradeId(null)} onAskAI={onAuditTrade?trade=>onAuditTrade(run,trade,savedBot):undefined}/>}
        <p className="tv-workbench-result-status">{runSaved?(currentRun?'Saved results match the current strategy source.':'The saved backtest belongs to an older revision. Run it again before activating tracking.'):'Simulation complete, but the result has not yet been saved.'}</p>
        {run?.logs?.length?<details className="tv-workbench-logs"><summary>Simulation methodology and logs</summary><pre>{run.logs.join('\n')}</pre></details>:null}
       </>:<div className="tv-workbench-empty-result"><Activity size={23}/><strong>{loadingRun?'Loading saved research…':'No backtest results yet'}</strong><p>Choose a completed UTC date range and run your strategy against historical candles.</p><button type="button" className="tv-workbench-secondary" onClick={()=>setView('backtest')}>Go to backtest <ArrowRight size={14}/></button></div>}
      <div className="tv-workbench-toolbar">
       {run&&!runSaved&&savedBot&&<button type="button" className="tv-workbench-secondary" disabled={Boolean(busy)||!currentRun||savedCode!==code} onClick={()=>void perform('save result',()=>persistRun(savedBot,run))}>Retry saving result</button>}
       <button type="button" className="tv-workbench-secondary" disabled={Boolean(busy)} onClick={()=>setView('backtest')}>Change dates</button>
       {canReview&&savedBot&&<button type="button" className="tv-workbench-primary" disabled={Boolean(busy)} onClick={reviewDeployment}><ShieldCheck size={16}/> Track signals <ArrowRight size={15}/></button>}
      </div>
      {venue==='hyperliquid'&&<p className="tv-workbench-quiet">Hyperliquid research is available, but live signal monitoring for this venue is not yet supported.</p>}
      {venue==='propdao'&&!canReview&&<p className="tv-workbench-quiet">To track this strategy: save the current code and complete a backtest, then review its Gold signal monitor. No broker trade will be placed.</p>}
    </section>}
   </div>
  </Dialog>;
}
