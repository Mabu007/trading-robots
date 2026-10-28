import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, Check, Copy, ImagePlus, Link2, Play, Unplug, X } from 'lucide-react';
import type { CloudBot, CloudClient } from '../firebase';
import { readApiJson } from '../api';

export type PublicBot = { id: string; name: string; asset: string; description: string; coverImage: string; access: 'free'|'paid';priceMinor?:number;currency?:string;creator?:string;timeframe?:string;performance?:{kind:'backtest';verification:'creator_reported';from:string;to:string;source:string;trades:number;netReturnR:number;maxDrawdownR:number;winRate:number}; publishedAt: string };
type Publication = PublicBot & { published: boolean };
export function sharedIdFromPath(path: string) {
  const match = path.match(/^\/bot\/([A-Za-z0-9_-]+)\/?$/);
  return match?.[1] ?? null;
}
async function privateRequest<T>(client: CloudClient, path: string, method = 'GET', body?: unknown, options?: {signal?: AbortSignal}): Promise<T> {
  const request = async (forceRefresh: boolean) => {
    const token = await client.getIdToken(forceRefresh);
    return fetch(path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), ...(options?.signal ? { signal: options.signal } : {}) });
  };
  let response = await request(false);
  if (response.status === 401) response = await request(true);
  return readApiJson<T>(response, 'Robot sharing');
}
export async function resizeCover(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10_000_000) throw new Error('Choose a JPG, PNG, or WebP image under 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const picture = new Image();
    await new Promise<void>((resolve, reject) => { picture.onload = () => resolve(); picture.onerror = () => reject(new Error('This image could not be opened. Choose another image.')); picture.src = url; });
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 1200 / picture.naturalWidth, 675 / picture.naturalHeight);
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this cover. Please try another browser.');
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL('image/webp', .82);
    if (result.length > 660_000) result = canvas.toDataURL('image/jpeg', .65);
    if (result.length > 660_000) throw new Error('This image is too detailed. Choose a smaller cover.');
    return result;
  } finally { URL.revokeObjectURL(url); }
}

async function coverForShare(cover: string): Promise<string> {
  if (!cover || cover.startsWith('data:image/')) return cover;
  if (!/^\/api\/economy\/images\/[a-f0-9]{64}$/.test(cover)) throw new Error('Could not load this cover. Choose it again.');
  const response = await fetch(cover);
  if (!response.ok) throw new Error('Could not load the saved cover. Please retry.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the saved cover.'));
    reader.onerror = () => reject(new Error('Could not read the saved cover.'));
    reader.readAsDataURL(blob);
  });
}

export function ShareBotDialog({ bot, client, prepare, makePublic, coverUrl, onCoverChanged, coverLoadError, creator, onClose }: { bot: CloudBot; client: CloudClient; prepare: () => Promise<void>; makePublic:(description:string|undefined,coverImage?:string)=>Promise<string>; coverUrl:string; onCoverChanged:(cover:string)=>void; coverLoadError:string; creator:string; onClose: () => void }) {
  const [publication, setPublication] = useState<Publication | null>(null);
  const [description, setDescription] = useState(bot.prompt.slice(0, 2000)), [descriptionDirty,setDescriptionDirty]=useState(false);
  const [access,setAccess]=useState<'free'|'paid'>('free'),[price,setPrice]=useState('99.00');
  const [cover, setCover] = useState(coverUrl), [coverDirty, setCoverDirty] = useState(false), [publicUrl, setPublicUrl] = useState('');
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(false), [working, setWorking] = useState(false);
  const [error, setError] = useState(''), [copied, setCopied] = useState(false), [retry, setRetry] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const path = `/api/user-bots/${encodeURIComponent(bot.id)}/publication`;
  const shareUrl = publication ? `${window.location.origin}/bot/${publication.id}` : '';
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(false); setError('');
    privateRequest<{ publication: Publication | null }>(client, path).then(({ publication: saved }) => {
      if (!active) return;
      setPublication(saved);
      if (saved) { setDescription(saved.description); setCover(saved.coverImage || coverUrl);setAccess(saved.access);setPrice(((saved.priceMinor||9900)/100).toFixed(2)); }
    }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : 'Could not load sharing settings.'); setLoadError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, path, retry]);
  useEffect(() => { if (!coverDirty && coverUrl && (!publication || !publication.coverImage)) setCover(coverUrl); }, [coverUrl, coverDirty, publication]);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; closeRef.current?.focus(); return () => previous?.focus(); }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) onClose();
      if (event.key === 'Tab') {
        const dialog = closeRef.current?.closest('section');
        const controls = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [working, onClose]);
  const publish = async (event: FormEvent) => {
    event.preventDefault(); if (working || loading || loadError) return;
    setWorking(true); setError(''); setCopied(false);
    try {
      await prepare();
      const coverImage = await coverForShare(cover);
      const saved = await privateRequest<{ publication: Publication }>(client, path, 'PUT', { name: bot.name, asset: bot.asset, description, coverImage, access,priceMinor:Math.round(Number(price)*100),currency:'ZAR',creator });
      setPublication(saved.publication);
      if (coverDirty) onCoverChanged(coverImage);
      setCoverDirty(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not publish this robot.'); }
    finally { setWorking(false); }
  };
  const publishListing = async () => {
    if (working || loading || loadError) return;
    setWorking(true); setError(''); setPublicUrl('');
    try {
      await prepare();
      const url = await makePublic(descriptionDirty ? description : undefined, coverDirty ? cover : undefined);
      setPublicUrl(url);
      setCoverDirty(false); setDescriptionDirty(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not make this bot public.'); }
    finally { setWorking(false); }
  };
  const unpublish = async () => {
    if (working) return;
    setWorking(true); setError('');
    try { await privateRequest(client, path, 'DELETE'); setPublication(current => current ? { ...current, published: false } : null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not unpublish this robot.'); }
    finally { setWorking(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); }
    catch { setError('Copy the link from the field below.'); }
  };
  return <div className="trade-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !working) onClose(); }}>
    <section className="trade-modal share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <header className="share-dialog-head"><div><span className="output-eyebrow">SHARE YOUR ROBOT</span><h2 id="share-title">{bot.name}</h2></div><button ref={closeRef} type="button" className="icon-button" aria-label="Close sharing settings" onClick={onClose} disabled={working}><X size={18}/></button></header>
      <form onSubmit={publish}>
        <fieldset disabled={loading || working || loadError}>
          <label className="share-cover-upload"><img src={cover || '/robot-cover.svg'} alt="Robot cover preview"/><span><ImagePlus size={16}/> Change cover</span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Robot cover image" onChange={async event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return;
            setWorking(true); setError('');
            try { setCover(await resizeCover(file)); setCoverDirty(true); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not use this image.'); } finally { setWorking(false); }
          }}/></label>
          <label className="share-description">Description<textarea rows={3} maxLength={2000} value={description} onChange={event => {setDescription(event.target.value);setDescriptionDirty(true)}} required placeholder="Tell people what your robot does…"/></label>
          <div className="market-form-grid"><label>Share-link access<select value={access} onChange={e=>setAccess(e.target.value as 'free'|'paid')}><option value="free">Free</option><option value="paid">Paid · checkout coming soon</option></select></label>{access==='paid'&&<label>Price (ZAR)<input type="number" min="1" max="1000000" step="0.01" required value={price} onChange={e=>setPrice(e.target.value)}/></label>}</div>
          <p className="share-hint">Make public lists your bot in Explore and on your profile without sharing its code. A free share link allows others to make editable copies of your code.</p>
        </fieldset>
        {error && <p className="share-error" role="alert">{error}</p>}
        {!cover && coverLoadError && <p className="share-hint" role="status">{coverLoadError}</p>}
        {loadError && <button type="button" className="ghost" onClick={() => setRetry(value => value + 1)}>Retry</button>}
        {publicUrl && <p className="share-hint" role="status">Your bot is public in Explore and on your profile. <a href={publicUrl} target="_blank" rel="noreferrer">View bot ↗</a></p>}
        {publication?.published && <div className="share-link-row"><input aria-label="Shareable robot link" value={shareUrl} readOnly onFocus={event => event.target.select()}/><button type="button" className="icon-button" onClick={() => void copy()} aria-label={copied ? 'Link copied' : 'Copy bot link'}>{copied ? <Check size={16}/> : <Copy size={16}/>}</button><a href={shareUrl} target="_blank" rel="noreferrer" aria-label="Open bot page"><Link2 size={16}/></a></div>}
        {publication && !publication.published && <p className="share-hint">Link unpublished. Publish again to reactivate the same link.</p>}
        <footer className="share-dialog-foot">{publication?.published && <button type="button" className="text-button" onClick={() => void unpublish()} disabled={working}>Unpublish</button>}<button type="submit" className="ghost" disabled={loading || working || loadError || !description.trim()}>{publication?.published ? 'Update share link' : 'Create share link'}</button><button type="button" className="primary" disabled={loading || working || loadError} onClick={() => void publishListing()}>{loading ? 'Loading…' : working ? 'Saving…' : publicUrl ? 'Update public page' : 'Make public'}</button></footer>
      </form>
    </section>
  </div>;
}

export function SharedBotPage({ shareId, busy, error, onBacktest, onConnect, onStart, client, onSettings, onSignIn }: { shareId: string; busy: boolean; error: string; onBacktest: () => void; onConnect: () => void;onStart:()=>void;client?:CloudClient|null;onSettings?:()=>void;onSignIn?:()=>void;children?:React.ReactNode }) {
  const [bot, setBot] = useState<PublicBot | null>(null), [loadError, setLoadError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    setLoading(true); setLoadError(''); setBot(null);
    fetch(`/api/shared-bots/${encodeURIComponent(shareId)}`, { signal: controller.signal }).then(response => readApiJson<{ bot: PublicBot }>(response, 'Robot page'))
      .then(data => { if (active) { setBot(data.bot); document.title = `${data.bot.name} · Trading Vibes`; } })
      .catch(cause => { if (active) setLoadError(cause instanceof Error ? cause.message : 'Could not load this robot.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); document.title = 'Trading Vibes — strategy studio'; };
  }, [shareId]);
  return <main className="public-bot-shell"><header className="public-bot-brand"><a href="/"><img src="/logo.png" alt=""/> Trading Vibes</a><span>ROBOT BY ITS CREATOR</span><button className="ghost" onClick={client?onSettings:onSignIn} aria-label={client?"Open profile settings":"Sign in"}>{client?"Profile":"Sign in"}</button></header>
    {loading ? <div className="public-bot-state" role="status"><span className="spinner"/> Loading robot…</div> : !bot ? <div className="public-bot-state"><h1>Robot unavailable</h1><p role="alert">{loadError}</p><a href="/">Go to Trading Vibes</a></div> : <article className="public-bot-card">
      <div className="public-bot-cover"><img src={bot.coverImage || '/robot-cover.svg'} alt={`${bot.name} cover`}/><span>{bot.asset} · {bot.timeframe?.toUpperCase()||'Strategy'} <i/> {bot.access==='free'?'FREE BOT':new Intl.NumberFormat(undefined,{style:'currency',currency:bot.currency||'ZAR'}).format((bot.priceMinor||0)/100)}</span></div>
      <div className="public-bot-copy"><h1>{bot.name}</h1><small>By {bot.creator||'Bot creator'}</small><p>{bot.description}</p></div>
      {bot.performance&&<div className="public-bot-performance"><small>CREATOR’S BACKTEST · UNVERIFIED · {bot.performance.from} – {bot.performance.to}</small><p>{bot.performance.trades} trades · {bot.performance.netReturnR.toFixed(2)}R net · {bot.performance.maxDrawdownR.toFixed(2)}R drawdown · {(bot.performance.winRate*100).toFixed(1)}% win rate</p><small>{bot.performance.source} · Historical simulation; actual results can differ.</small></div>}<div className="public-bot-actions"><button type="button" className="public-side-action" onClick={onBacktest} disabled={busy||bot.access==='paid'}><Activity size={20}/><strong>{busy ? 'Opening…' : 'Backtest'}</strong></button><button type="button" className="public-start-action" onClick={onStart} disabled={busy||bot.access==='paid'} title={bot.access==='paid'?'Paid checkout coming soon':'Review demo trading risk settings'}><Play size={25} fill="currentColor"/><strong>Start</strong><small>{bot.access==='paid'?'Checkout coming soon':'Demo trading'}</small></button><button type="button" className="public-side-action" onClick={onConnect} disabled={busy}><Unplug size={20}/><strong>Connect broker</strong><small>cTrader</small></button></div>
      {bot.access==='paid'&&<p className="public-bot-notice">Paid checkout · Coming soon. Access is not available yet.</p>}{error && <p className="public-bot-notice" role="status">{error}</p>}
    </article>}
  </main>;
}

export { privateRequest as sharingRequest };
