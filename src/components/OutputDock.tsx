import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Activity, AlertTriangle, Check, ChevronDown, ChevronRight, Copy, GripHorizontal, History, ListChecks, Pencil, Sparkles, Terminal as TerminalIcon, Trash2, X } from 'lucide-react';
import type { Result, Trade } from '../types';
import type { BotVersion } from '../firebase';

export type OutputTab = 'terminal' | 'results' | 'trades' | 'versions';

type Props = {
  asset: string;
  timeframe?: string;
  from: string;
  to: string;
  logs: string[];
  result: Result | null;
  selectedTrade: Trade | null;
  showTradeModal?: boolean;
  busy: string;
  active: OutputTab;
  collapsed: boolean;
  onTabChange: (tab: OutputTab) => void;
  onCollapse: () => void;
  onClear: () => void;
  onDeleteBacktest: () => Promise<void>;
  onStop: () => void;
  onSelectTrade: (trade: Trade) => void;
  onClearSelectedTrade: () => void;
  onAuditTrade: (trade: Trade) => void;
  versions: BotVersion[];
  versionsLoading: boolean;
  versionError: string;
  onLoadVersion: (version: BotVersion) => void;
  onRenameVersion: (version: BotVersion, name: string) => Promise<void>;
  onDeleteVersion: (version: BotVersion) => Promise<void>;
  compact?: boolean;
};

export function createTradeId(asset: string, timeframe: string | undefined, trade: Trade): string {
  const day = new Date(trade.entryTime * 1000).toISOString().slice(0, 10).replaceAll('-', '');
  return `${asset}-${timeframe?.toUpperCase() || 'BT'}-${day}-${String(trade.id).padStart(4, '0')}`;
}

function formatTime(time: number) {
  return new Date(time * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function displayPrice(value: number, asset: string) {
  const digits = asset === 'USDJPY' ? 3 : asset === 'XAUUSD' ? 2 : 5;
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function duration(entry: number, exit: number) {
  const minutes = Math.max(0, Math.round((exit - entry) / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h${remainder ? ` ${remainder}m` : ''}`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Clipboard access was denied.');
}

function ResultPanel({ result, from, to, asset }: { result: Result | null; from: string; to: string; asset: string }) {
  if (!result) return <div className="output-empty"><Activity size={18}/><strong>No backtest results yet</strong><span>Run a backtest to see performance and data coverage.</span></div>;
  const metrics = result.metrics;
  return <div className="output-result-panel">
    <div className="output-result-heading"><div><span className="output-eyebrow">BACKTEST SNAPSHOT</span><strong>{asset} <i>·</i> {result.timeframe?.toUpperCase() || '—'}</strong><small>{from} <span>→</span> {to} · {result.candles.length.toLocaleString()} candles</small></div><span className="output-result-mark"><Check size={15}/></span></div>
    <div className="output-metrics">
      <div className="output-metric featured"><span>NET RESULT</span><strong className={metrics.netReturn >= 0 ? 'green' : 'red'}>{metrics.netReturn >= 0 ? '+' : ''}{metrics.netReturn.toFixed(2)}R</strong></div>
      <div className="output-metric"><span>PROFIT FACTOR</span><strong>{metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</strong></div>
      <div className="output-metric"><span>WIN RATE</span><strong>{(metrics.winRate * 100).toFixed(1)}%</strong></div>
      <div className="output-metric"><span>MAX DRAWDOWN</span><strong className="red">{metrics.maxDrawdown.toFixed(2)}R</strong></div>
      <div className="output-metric"><span>WINS / LOSSES</span><strong>{metrics.wins} <i>/</i> {metrics.losses}</strong></div>
    </div>
    <p className="output-disclaimer">Price-relative R results. Spread, slippage, commission, swaps and contract values are not modeled.</p>
  </div>;
}

function TradesPanel({ props }: { props: Props }) {
  const [copied, setCopied] = useState('');
  const trades = props.result?.trades || [];
  const selected = trades.find(trade => trade.id === props.selectedTrade?.id) || null;
  const copyId = async (trade: Trade) => {
    const id = createTradeId(props.asset, props.result?.timeframe, trade);
    try { await copyText(id); setCopied(id); window.setTimeout(() => setCopied(''), 1600); }
    catch { setCopied(''); }
  };

  if (!props.result) return <div className="output-empty"><ListChecks size={18}/><strong>No trades to inspect</strong><span>Run a backtest and each trade will be available here.</span></div>;
  return <>
    <div className="output-trade-list" role="list" aria-label="Backtest trades">
      {trades.length ? trades.map(trade => {
        const id = createTradeId(props.asset, props.result?.timeframe, trade);
        const active = selected?.id === trade.id;
        return <div key={trade.id} className={`output-trade-row${active ? ' active' : ''}`}>
          <button type="button" className="output-trade-select" aria-pressed={active} onClick={() => props.onSelectTrade(trade)}>
            <span className={`output-trade-side ${trade.side === 'LONG' ? 'long' : 'short'}`}>{trade.side === 'LONG' ? '↗' : '↘'}</span>
            <span className="output-trade-main"><strong>{id}</strong><small>{formatTime(trade.entryTime)} <i>·</i> {trade.reason}</small></span>
            <b className={trade.pnl >= 0 ? 'green' : 'red'}>{trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}R</b>
          </button>
          <button type="button" className="copy-trade-button" aria-label={`Copy trade ID ${id}`} title="Copy trade ID" onClick={() => void copyId(trade)}>{copied === id ? <Check size={14}/> : <Copy size={14}/>}</button>
        </div>;
      }) : <div className="output-empty"><ListChecks size={18}/><strong>No trades in this period</strong><span>Try a different date range or strategy.</span></div>}
    </div>
    {selected && props.showTradeModal && <div className="trade-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onClearSelectedTrade(); }}>
      <section className="trade-modal" role="dialog" aria-modal="true" aria-labelledby="trade-modal-title">
        <header className="trade-modal-head"><div><span className="output-eyebrow">TRADE AUDIT</span><h2 id="trade-modal-title">{createTradeId(props.asset, props.result?.timeframe, selected)}</h2></div><button type="button" className="shadcn-icon-button" aria-label="Close trade details" onClick={props.onClearSelectedTrade}><X size={16}/></button></header>
        <div className="trade-audit-pills"><span className={selected.side === 'LONG' ? 'long' : 'short'}>{selected.side}</span><span>{selected.reason.toUpperCase()}</span><b className={selected.pnl >= 0 ? 'green' : 'red'}>{selected.pnl >= 0 ? '+' : ''}{selected.pnl.toFixed(2)}R</b></div>
        <div className="trade-audit-grid">
          <div><small>ENTRY</small><strong>{displayPrice(selected.entry, props.asset)}</strong><span>{formatTime(selected.entryTime)}</span></div>
          <div><small>EXIT</small><strong>{displayPrice(selected.exit, props.asset)}</strong><span>{formatTime(selected.exitTime)}</span></div>
          <div><small>STOP LOSS</small><strong>{displayPrice(selected.stop, props.asset)}</strong></div>
          <div><small>TAKE PROFIT</small><strong>{displayPrice(selected.target, props.asset)}</strong></div>
          <div><small>RISK DISTANCE</small><strong>{displayPrice(Math.abs(selected.entry - selected.stop), props.asset)}</strong></div>
          <div><small>TIME IN TRADE</small><strong>{duration(selected.entryTime, selected.exitTime)}</strong></div>
        </div>
        <footer className="trade-modal-foot"><span>Audit uses the selected trade and surrounding OHLC prices.</span><button type="button" className="audit-ai-button" onClick={() => props.onAuditTrade(selected)} disabled={Boolean(props.busy)}><Sparkles size={14}/> Ask AI to audit this trade</button></footer>
      </section>
    </div>}
  </>;
}

function VersionsPanel({ props, onRename, onDelete }: { props: Props; onRename: (version: BotVersion) => void; onDelete: (version: BotVersion) => void }) {
  if (props.versionsLoading) return <div className="versions-state"><span className="spinner"/> Loading saved versions…</div>;
  if (props.versionError) return <div className="versions-state version-error">{props.versionError}</div>;
  if (!props.versions.length) return <div className="output-empty"><History size={18}/><strong>No saved versions yet</strong><span>Use the bookmark icon above the editor to save a version of this robot.</span></div>;
  return <div className="versions-list">{props.versions.map(version=><article className="version-row" key={version.id}><span className="version-mark"><History size={15}/></span><div className="version-info"><strong>{version.name}</strong><small>{new Date(version.createdAt).toLocaleString()}</small></div><button className="version-icon-action" onClick={()=>onRename(version)} aria-label={`Rename ${version.name}`} title="Rename version"><Pencil size={13}/></button><button className="version-icon-action danger" onClick={()=>onDelete(version)} aria-label={`Delete ${version.name}`} title="Delete version"><Trash2 size={13}/></button><button className="version-load" onClick={()=>props.onLoadVersion(version)}>Load</button></article>)}</div>;
}

export function OutputDock(props: Props) {
  const [height, setHeight] = useState(218);
  const dragRef = useRef<{ y: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [renameTarget, setRenameTarget] = useState<BotVersion | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BotVersion | null>(null);
  const [deleteBacktestConfirm, setDeleteBacktestConfirm] = useState(false);
  const [versionActionBusy, setVersionActionBusy] = useState(false);
  const [versionActionError, setVersionActionError] = useState('');
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setHeight(Math.max(96, Math.min(Math.round(window.innerHeight * .72), drag.height + drag.y - event.clientY)));
    };
    const up = () => { dragRef.current = null; setDragging(false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragging]);
  useEffect(() => {
    if (!props.selectedTrade || !props.showTradeModal) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClearSelectedTrade(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [props.selectedTrade, props.showTradeModal, props.onClearSelectedTrade]);
  const tabs: { id: OutputTab; label: string; count?: number; icon: typeof TerminalIcon }[] = [
    { id: 'terminal', label: 'Terminal', count: props.logs.length, icon: TerminalIcon },
    { id: 'results', label: 'Results', count: props.result ? 1 : 0, icon: Activity },
    { id: 'trades', label: 'Trades', count: props.result?.trades.length || 0, icon: ListChecks },
    { id: 'versions', label: 'Versions', count: props.versions.length, icon: History },
  ];
  const beginRename = (version: BotVersion) => { setRenameTarget(version); setRenameValue(version.name); setVersionActionError(''); };
  const saveRename = async (event: FormEvent) => { event.preventDefault(); if (!renameTarget || !renameValue.trim()) return; setVersionActionBusy(true); setVersionActionError(''); try { await props.onRenameVersion(renameTarget, renameValue.trim()); setRenameTarget(null); } catch (error) { setVersionActionError(error instanceof Error ? error.message : 'Could not rename this version.'); } finally { setVersionActionBusy(false); } };
  const confirmDeleteVersion = async () => { if (!deleteTarget) return; setVersionActionBusy(true); setVersionActionError(''); try { await props.onDeleteVersion(deleteTarget); setDeleteTarget(null); } catch (error) { setVersionActionError(error instanceof Error ? error.message : 'Could not delete this version.'); } finally { setVersionActionBusy(false); } };
  return <section className={`output-dock${props.collapsed ? ' closed' : ''}${props.compact ? ' compact' : ''}`} style={props.compact ? undefined : { height: props.collapsed ? 42 : height }}>
    {!props.compact && !props.collapsed && <div className={`output-resize-handle${dragging ? ' dragging' : ''}`} role="separator" aria-label="Resize output panel" aria-orientation="horizontal" aria-valuenow={height} aria-valuemin={96} aria-valuemax={Math.round(window.innerHeight * .72)} tabIndex={0} onPointerDown={event => { event.preventDefault(); dragRef.current = { y: event.clientY, height }; setDragging(true); }} onKeyDown={event => { if (event.key === 'ArrowUp') { event.preventDefault(); setHeight(value => Math.min(Math.round(window.innerHeight * .72), value + 24)); } if (event.key === 'ArrowDown') { event.preventDefault(); setHeight(value => Math.max(96, value - 24)); } if (event.key === 'Home') setHeight(96); if (event.key === 'End') setHeight(Math.round(window.innerHeight * .72)); }}><GripHorizontal size={18}/></div>}
    <header className="output-dock-head">
      <div className="output-tab-list" role="tablist" aria-label="Backtest output">
        {tabs.map(({ id, label, count, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={props.active === id} aria-controls={`output-panel-${id}`} className={`output-tab${props.active === id ? ' selected' : ''}`} onClick={() => { props.onTabChange(id); if (props.collapsed) props.onCollapse(); }}><Icon size={14}/><span>{label}</span>{count !== undefined && <small>{count}</small>}</button>)}
      </div>
      <div className="output-dock-actions">{props.busy === 'backtest' && <span className="running-label"><i/> RUNNING</span>}{props.busy === 'backtest' && <button type="button" className="output-stop" onClick={props.onStop}>Stop</button>}{props.active === 'terminal' && <button type="button" className="output-clear" aria-label="Clear terminal" title="Clear terminal" onClick={()=>setClearConfirm(true)}><Trash2 size={15}/></button>}{props.result&&['results','trades'].includes(props.active)&&<button type="button" className="output-clear" aria-label="Delete saved backtest" title="Delete saved backtest" onClick={()=>setDeleteBacktestConfirm(true)}><Trash2 size={15}/></button>}<button type="button" className="shadcn-icon-button output-collapse" aria-label={props.collapsed ? 'Expand output dock' : 'Collapse output dock'} onClick={props.onCollapse}>{props.collapsed ? <ChevronRight size={16}/> : <ChevronDown size={16}/>}</button></div>
    </header>
    {!props.collapsed && <div className="output-dock-body" role="tabpanel" id={`output-panel-${props.active}`}>
      {props.active === 'terminal' && <div className="terminal-content">{props.logs.length ? props.logs.map((line, index) => <div className={`log-line ${line.includes('failed')||line.includes('stopped')?'error':''}`} key={`${index}-${line}`}><span className="log-prompt">›</span>{line}</div>) : <div className="terminal-placeholder"><span>›</span> Backtest activity, market data, and errors appear here.</div>}</div>}
      {props.active === 'results' && <ResultPanel result={props.result} from={props.from} to={props.to} asset={props.asset}/>}
      {props.active === 'trades' && <TradesPanel props={props}/>}
      {props.active === 'versions' && <VersionsPanel props={props} onRename={beginRename} onDelete={version=>{setDeleteTarget(version);setVersionActionError('')}}/>}
    </div>}
    {clearConfirm&&createPortal(<div className="trade-modal-backdrop clear-confirm-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setClearConfirm(false)}}><section className="trade-modal clear-confirm" role="alertdialog" aria-modal="true" aria-labelledby="clear-confirm-title"><span className="clear-confirm-icon"><AlertTriangle size={19}/></span><h2 id="clear-confirm-title">Are you sure you want to clear the terminal?</h2><p>This removes the visible terminal log from this workspace. Saved robot code and versions are unaffected.</p><div className="clear-confirm-actions"><button className="ghost" onClick={()=>setClearConfirm(false)}>Cancel</button><button className="clear-confirm-delete" onClick={()=>{props.onClear();setClearConfirm(false)}}><Trash2 size={14}/> Clear terminal</button></div></section></div>,document.body)}
    {deleteBacktestConfirm&&createPortal(<div className="trade-modal-backdrop clear-confirm-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!versionActionBusy)setDeleteBacktestConfirm(false)}}><section className="trade-modal clear-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-backtest-title"><span className="clear-confirm-icon"><AlertTriangle size={19}/></span><h2 id="delete-backtest-title">Delete this backtest?</h2><p>This removes the saved results, chart data, trades, and terminal history for this robot. Your strategy and saved versions stay unchanged.</p>{versionActionError&&<div className="version-error-inline">{versionActionError}</div>}<div className="clear-confirm-actions"><button className="ghost" disabled={versionActionBusy} onClick={()=>setDeleteBacktestConfirm(false)}>Cancel</button><button className="clear-confirm-delete" disabled={versionActionBusy} onClick={()=>{setVersionActionBusy(true);setVersionActionError('');void props.onDeleteBacktest().then(()=>setDeleteBacktestConfirm(false)).catch(error=>setVersionActionError(error instanceof Error?error.message:'Could not delete this backtest.')).finally(()=>setVersionActionBusy(false))}}><Trash2 size={14}/>{versionActionBusy?'Deleting…':'Delete backtest'}</button></div></section></div>,document.body)}
    {renameTarget&&createPortal(<div className="trade-modal-backdrop clear-confirm-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!versionActionBusy)setRenameTarget(null)}}><form className="trade-modal clear-confirm version-action-modal" onSubmit={saveRename} role="dialog" aria-modal="true" aria-labelledby="rename-version-title"><span className="clear-confirm-icon"><Pencil size={17}/></span><h2 id="rename-version-title">Rename saved version</h2><p>Give this snapshot a clear name. Its saved code stays unchanged.</p><label>VERSION NAME<input autoFocus maxLength={64} value={renameValue} onChange={event=>setRenameValue(event.target.value)} placeholder="e.g. RSI filter experiment"/></label>{versionActionError&&<div className="version-error-inline">{versionActionError}</div>}<div className="clear-confirm-actions"><button type="button" className="ghost" disabled={versionActionBusy} onClick={()=>setRenameTarget(null)}>Cancel</button><button type="submit" className="version-confirm-primary" disabled={versionActionBusy||!renameValue.trim()}>{versionActionBusy?'Saving…':'Save name'}</button></div></form></div>,document.body)}
    {deleteTarget&&createPortal(<div className="trade-modal-backdrop clear-confirm-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!versionActionBusy)setDeleteTarget(null)}}><section className="trade-modal clear-confirm version-action-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-version-title"><span className="clear-confirm-icon"><Trash2 size={18}/></span><h2 id="delete-version-title">Delete “{deleteTarget.name}”?</h2><p>This permanently removes the saved code snapshot from your cloud workspace. This cannot be undone.</p>{versionActionError&&<div className="version-error-inline">{versionActionError}</div>}<div className="clear-confirm-actions"><button className="ghost" disabled={versionActionBusy} onClick={()=>setDeleteTarget(null)}>Cancel</button><button className="clear-confirm-delete" disabled={versionActionBusy} onClick={()=>void confirmDeleteVersion()}><Trash2 size={14}/>{versionActionBusy?'Deleting…':'Delete version'}</button></div></section></div>,document.body)}
  </section>;
}
