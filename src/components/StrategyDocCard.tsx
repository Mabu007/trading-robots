import { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';
import { strategyDocumentation } from '../strategy-documentation';

export function StrategyDocCard({ asset, timeframes }: { asset: string; timeframes: string[] }) {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doc = strategyDocumentation(asset, timeframes);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  useEffect(() => { if (manualCopy) { textRef.current?.focus(); textRef.current?.select(); } }, [manualCopy]);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(doc);
      setManualCopy(false); setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false); setManualCopy(true);
      // Re-select when the fallback was already open and Copy is pressed again.
      textRef.current?.focus(); textRef.current?.select();
    }
  };
  return <section className="strategy-doc-card" aria-label="Trading Vibes AI strategy guide">
    <span className="strategy-doc-icon" aria-hidden="true"><FileCode2 size={17}/></span>
    <div className="strategy-doc-copy"><strong>Write with any AI</strong><span>Copy the strategy guide, then paste it into your AI chat.</span></div>
    <button type="button" className="strategy-doc-button" onClick={() => void copy()} aria-label={copied ? 'Strategy guide copied' : 'Copy strategy guide'}>{copied ? <Check size={15}/> : <Copy size={15}/>}<span>{copied ? 'Copied' : 'Copy Doc'}</span></button>
    {manualCopy && <div className="strategy-doc-manual"><p role="status">Automatic copy is unavailable. Select the text below and copy it.</p><textarea ref={textRef} readOnly aria-label="Strategy guide to copy" value={doc} onFocus={event => event.currentTarget.select()}/></div>}
    <span className="strategy-doc-status" role="status" aria-live="polite">{copied ? 'Strategy guide copied.' : ''}</span>
  </section>;
}
