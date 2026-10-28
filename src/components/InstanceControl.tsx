import { Play, RefreshCw, Square } from 'lucide-react';
import type { InstanceAction, LiveReadiness } from '../live-status';
type Props = {
  status: LiveReadiness | null;
  check: 'checking' | 'ready' | 'unavailable';
  pending: InstanceAction | null;
  workBusy: boolean;
  onControl: (action: InstanceAction) => void;
  onSetup: () => void;
  onRefresh: () => void;
};

/** Controls the pinned strategy; broker orders and open positions have separate state. */
export function InstanceControl({ status, check, pending, workBusy, onControl, onSetup, onRefresh }: Props) {
  if (!status || (!status.runtime.deployed && !status.locked)) return null;
  if (pending) return <button type="button" className="ghost instance-control" disabled aria-busy="true">{pending === 'start' ? 'Starting…' : 'Stopping…'}</button>;
  const runtime = status.runtime;
  if (check !== 'ready' || !runtime.available || !runtime.deployed) return <button type="button" className="ghost instance-control instance-check" title="Instance status is unavailable. Check its connection." onClick={onRefresh}><RefreshCw size={13}/> Check status</button>;
  if (runtime.running) return <button type="button" className="ghost instance-control instance-stop" title="Stop future signals. Existing positions remain open." aria-label="Stop bot" onClick={() => onControl('stop')}><Square size={12} fill="currentColor"/> Stop</button>;
  const broker = status.broker;
  const ready = broker.environment === 'demo' && broker.accountVerified && broker.mappingVerified && broker.sourceMatches && broker.permission;
  return <button type="button" className="ghost instance-control instance-start" disabled={workBusy} title={ready ? 'Start the pinned strategy. Previously approved demo orders may resume.' : 'Connect the original demo account with trading permission and verify its symbol in Deploy before starting.'} aria-label={ready ? 'Start bot' : 'Set up broker to start bot'} onClick={() => ready ? onControl('start') : onSetup()}><Play size={12} fill="currentColor"/> Start</button>;
}
