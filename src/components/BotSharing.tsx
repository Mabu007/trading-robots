import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, Check, Copy, ImagePlus, Link2, Play, Unplug, X } from 'lucide-react';
import type { CloudBot, CloudClient } from '../firebase';
import { readApiJson } from '../api';

export type PublicBot = { id: string; name: string; asset: string; description: string; coverImage: string; access: 'free'; publishedAt: string };
type Publication = PublicBot & { published: boolean };
export function sharedIdFromPath(path: string) {
  const match = path.match(/^\/bot\/([A-Za-z0-9_-]+)\/?$/);
  return match?.[1] ?? null;
}
async function privateRequest<T>(client: CloudClient, path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = await client.getIdToken();
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return readApiJson<T>(response, 'Robot sharing');
}
async function resizeCover(file: File): Promise<string> {
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

export function ShareBotDialog({ bot, client, prepare, onClose }: { bot: CloudBot; client: CloudClient; prepare: () => Promise<void>; onClose: () => void }) {
  const [publication, setPublication] = useState<Publication | null>(null);
  const [description, setDescription] = useState(bot.prompt.slice(0, 2000));
  const [cover, setCover] = useState('');
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
      if (saved) { setDescription(saved.description); setCover(saved.coverImage); }
    }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : 'Could not load sharing settings.'); setLoadError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, path, retry]);
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
      const saved = await privateRequest<{ publication: Publication }>(client, path, 'PUT', { name: bot.name, asset: bot.asset, description, coverImage: cover, access: 'free' });
      setPublication(saved.publication);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not publish this robot.'); }
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
            try { setCover(await resizeCover(file)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not use this image.'); } finally { setWorking(false); }
          }}/></label>
          <label className="share-description">Description<textarea rows={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} required placeholder="Tell people what your robot does…"/></label>
          <div className="share-access" role="group" aria-label="Bot access"><span className="selected"><Check size={14}/> Free</span><span aria-disabled="true">Paid <small>Coming soon</small></span></div>
          <p className="share-hint">Anyone with the link can view this page and backtest a private, editable copy. Updates apply when you publish again.</p>
        </fieldset>
        {error && <p className="share-error" role="alert">{error}</p>}
        {loadError && <button type="button" className="ghost" onClick={() => setRetry(value => value + 1)}>Retry</button>}
        {publication?.published && <div className="share-link-row"><input aria-label="Shareable robot link" value={shareUrl} readOnly onFocus={event => event.target.select()}/><button type="button" className="icon-button" onClick={() => void copy()} aria-label={copied ? 'Link copied' : 'Copy bot link'}>{copied ? <Check size={16}/> : <Copy size={16}/>}</button><a href={shareUrl} target="_blank" rel="noreferrer" aria-label="Open bot page"><Link2 size={16}/></a></div>}
        {publication && !publication.published && <p className="share-hint">Link unpublished. Publish again to reactivate the same link.</p>}
        <footer className="share-dialog-foot">{publication?.published && <button type="button" className="text-button" onClick={() => void unpublish()} disabled={working}>Unpublish</button>}<button type="submit" className="primary" disabled={loading || working || loadError || !description.trim()}>{loading ? 'Loading…' : working ? 'Saving…' : publication?.published ? 'Update page' : 'Create free link'}</button></footer>
      </form>
    </section>
  </div>;
}

export function SharedBotPage({ shareId, busy, error, onBacktest, onConnect }: { shareId: string; busy: boolean; error: string; onBacktest: () => void; onConnect: () => void }) {
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
  return <main className="public-bot-shell"><header className="public-bot-brand"><a href="/"><img src="/logo.png" alt=""/> Trading Vibes</a><span>ROBOT BY ITS CREATOR</span></header>
    {loading ? <div className="public-bot-state" role="status"><span className="spinner"/> Loading robot…</div> : !bot ? <div className="public-bot-state"><h1>Robot unavailable</h1><p role="alert">{loadError}</p><a href="/">Go to Trading Vibes</a></div> : <article className="public-bot-card">
      <div className="public-bot-cover"><img src={bot.coverImage || '/robot-cover.svg'} alt={`${bot.name} cover`}/><span>{bot.asset} <i/> FREE BOT</span></div>
      <div className="public-bot-copy"><h1>{bot.name}</h1><p>{bot.description}</p></div>
      <div className="public-bot-actions"><button type="button" className="public-side-action" onClick={onBacktest} disabled={busy}><Activity size={20}/><strong>{busy ? 'Opening…' : 'Backtest'}</strong></button><button type="button" className="public-start-action" disabled title="Live trading is coming soon"><Play size={25} fill="currentColor"/><strong>Start</strong><small>Coming soon</small></button><button type="button" className="public-side-action" onClick={onConnect} disabled={busy}><Unplug size={20}/><strong>Connect broker</strong><small>cTrader</small></button></div>
      {error && <p className="public-bot-notice" role="status">{error}</p>}
    </article>}
  </main>;
}

export { privateRequest as sharingRequest };
