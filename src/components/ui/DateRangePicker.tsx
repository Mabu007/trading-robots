import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

type Props = {
  dates: string[];
  from: string;
  to: string;
  setFrom: (date: string) => void;
  setTo: (date: string) => void;
  className?: string;
};

const pad = (value: number) => String(value).padStart(2, '0');
const keyFor = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const firstOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const monthLabel = (date: Date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (value: string) => value ? new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Choose date';

function CalendarMonth({ month, available, start, end, onSelect }: {
  month: Date; available: Set<string>; start: string; end: string; onSelect: (date: string) => void;
}) {
  const offset = month.getUTCDay();
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, index) => keyFor(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), index + 1))))];
  while (cells.length % 7) cells.push(null);
  const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  return <section className="calendar-month" aria-label={monthLabel(month)}>
    <h3>{monthLabel(month)}</h3>
    <div className="calendar-grid calendar-weekdays">{weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
    <div className="calendar-grid calendar-days">{cells.map((date, index) => {
      if (!date) return <span className="calendar-blank" key={`blank-${index}`}/>;
      const enabled = available.has(date);
      const inRange = Boolean(start && end && date >= start && date <= end);
      return <button type="button" key={date} disabled={!enabled} aria-label={`${date}${enabled ? '' : ', unavailable'}`} aria-pressed={date === start || date === end}
        className={`calendar-day${enabled ? '' : ' unavailable'}${inRange ? ' in-range' : ''}${date === start || date === end ? ' selected' : ''}`}
        onClick={() => onSelect(date)}>{Number(date.slice(-2))}</button>;
    })}</div>
  </section>;
}

export function DateRangePicker({ dates, from, to, setFrom, setTo, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => firstOfMonth(from ? new Date(`${from}T00:00:00Z`) : new Date()));
  const [pending, setPending] = useState({ start: from, end: to });
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 12 });
  const available = useMemo(() => new Set(dates), [dates]);
  const sorted = dates.filter(Boolean).sort();
  const minMonth = sorted.length ? firstOfMonth(new Date(`${sorted[0]}T00:00:00Z`)) : month;
  const maxMonth = sorted.length ? firstOfMonth(new Date(`${sorted.at(-1)}T00:00:00Z`)) : month;
  const nextMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const minKey = keyFor(minMonth).slice(0, 7), maxKey = keyFor(maxMonth).slice(0, 7);
  const monthKey = keyFor(month).slice(0, 7), nextKey = keyFor(nextMonth).slice(0, 7);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { const target=event.target as Node;if(!rootRef.current?.contains(target)&&!popoverRef.current?.contains(target))setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect=rootRef.current?.getBoundingClientRect();if(!rect)return;
      const width=Math.min(590,window.innerWidth-24),height=430;
      const left=Math.max(12,Math.min(window.innerWidth-width-12,rect.right-width));
      const below=rect.bottom+8;
      setPopoverPosition({left,top:below+height>window.innerHeight?Math.max(12,rect.top-height-8):below});
    };
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)};
  },[open]);

  const show = () => {
    if (!dates.length) return;
    setPending({ start: from, end: to });
    setMonth(firstOfMonth(from ? new Date(`${from}T00:00:00Z`) : new Date(`${dates.at(-1)}T00:00:00Z`)));
    setOpen(value => !value);
  };
  const selectDate = (date: string) => {
    if (!pending.start || pending.end || date < pending.start) {
      setPending({ start: date, end: '' });
      return;
    }
    setPending({ start: pending.start, end: date });
  };
  const applyRange = () => {
    if (!pending.start || !pending.end || pending.end < pending.start) return;
    setFrom(pending.start);
    setTo(pending.end);
    setOpen(false);
  };

  return <div className={`range-picker ${className}`} ref={rootRef}>
    <button type="button" className="range-trigger shadcn-button" onClick={show} disabled={!dates.length} aria-haspopup="dialog" aria-expanded={open}>
      <CalendarDays size={15}/><span className="range-trigger-label"><small>DATE RANGE</small><strong>{from && to ? `${shortDate(from)} – ${shortDate(to)}` : 'Choose a range'}</strong></span><ChevronRight size={14} className="range-trigger-chevron"/>
    </button>
    {open&&createPortal(<div ref={popoverRef} className="range-popover range-popover-portal shadcn-popover" style={{top:popoverPosition.top,left:popoverPosition.left}} role="dialog" aria-label="Choose backtest date range">
      <div className="range-popover-head"><div><strong>Select backtest period</strong><span>Only dates with available prices are enabled</span></div><div className="range-nav">
        <button type="button" className="shadcn-icon-button" aria-label="Previous month" disabled={monthKey<=minKey} onClick={()=>setMonth(new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()-1,1)))}><ChevronLeft size={16}/></button>
        <button type="button" className="shadcn-icon-button" aria-label="Next month" disabled={monthKey>=maxKey} onClick={()=>setMonth(nextMonth)}><ChevronRight size={16}/></button>
      </div></div>
      <div className="range-calendars"><CalendarMonth month={month} available={available} start={pending.start} end={pending.end} onSelect={selectDate}/><CalendarMonth month={nextMonth} available={available} start={pending.start} end={pending.end} onSelect={selectDate}/></div>
      <div className="range-popover-foot"><div className="range-pending-copy"><span>{pending.start ? shortDate(pending.start) : 'Start'} <i>→</i> {pending.end ? shortDate(pending.end) : 'End'}</span><small>{pending.start && !pending.end ? 'Now choose an end date' : 'Choose a start, then an end date'}</small></div><div className="range-actions"><button type="button" className="range-cancel" onClick={()=>setOpen(false)}>Cancel</button><button type="button" className="range-apply" disabled={!pending.start||!pending.end||pending.end<pending.start} onClick={applyRange}>Apply range</button></div></div>
    </div>,document.body)}
  </div>;
}
