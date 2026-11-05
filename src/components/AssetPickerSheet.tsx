import { useEffect, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { Venue } from '../../shared/venues';

type Props = {
  venue: Venue;
  assets: string[];
  value: string;
  disabled?: boolean;
  onChange: (asset: string) => void;
};

export function AssetPickerSheet({ venue, assets, value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open]);
  const filtered = assets.filter(item => item.toLowerCase().includes(search.toLowerCase())).slice(0, 120);
  return <>
    <button type="button" className="tvx-asset-trigger" disabled={disabled} onClick={() => { setSearch(''); setOpen(true); }} aria-label="Choose a trading market">
      <span>{value || (assets.length ? 'Choose a market' : 'Markets unavailable')}</span><ChevronDown size={17}/>
    </button>
    {open && <div className="tvx-asset-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="tvx-asset-sheet" role="dialog" aria-modal="true" aria-label="Select market">
        <div className="tvx-asset-grabber"/>
        <header><div><strong>Select an instrument</strong><p>{venue.toUpperCase()} · available market data</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close market selector"><X size={20}/></button></header>
        <div className="tvx-asset-search"><Search size={18}/><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search symbol…" aria-label="Search instrument"/></div>
        <div className="tvx-asset-results">{filtered.length ? filtered.map(asset => <button type="button" key={asset} className={asset === value ? 'selected' : ''} onClick={() => { onChange(asset); setOpen(false); }}><span><strong>{asset}</strong><small>Market data available · execution depends on account</small></span>{asset === value && <Check size={18}/>}</button>) : <p>No matching instruments. Check the venue or try another symbol.</p>}</div>
        <p className="tvx-asset-note">Changing instruments may invalidate strategy assumptions and backtest results. Data discovery is not broker approval.</p>
      </section>
    </div>}
  </>;
}
