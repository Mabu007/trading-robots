import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { validShareId } from './shared-bots.ts';

type Dependencies = { read: (key: string) => Promise<string | null>; write: (key: string, body: string) => Promise<void>; uid: (req: Request, res: Response) => Promise<string | null> };
const connectionKey = (uid: string) => `broker-connections/${Buffer.from(uid).toString('base64url')}/ctrader.json`;
type Flow = { uid: string; shareId: string; expiresAt: number };
function sealFlow(flow: Flow, secret: string) {
  const iv = randomBytes(12), key = createHash('sha256').update(secret).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(flow)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function openFlow(state: string, secret: string): Flow {
  const bytes = Buffer.from(state, 'base64url'), key = createHash('sha256').update(secret).digest();
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12));
  cipher.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')) as Flow;
}
function config() {
  const clientId = process.env.CTRADER_CLIENT_ID?.trim(), clientSecret = process.env.CTRADER_CLIENT_SECRET?.trim(), redirectUri = process.env.CTRADER_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  try { const url = new URL(redirectUri); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) return null; }
  catch { return null; }
  return { clientId, clientSecret, redirectUri };
}
export function ctraderRoutes(app: Express, storage: Dependencies) {
  app.get('/api/brokers/ctrader/status', async (req, res) => {
    const uid = await storage.uid(req, res); if (!uid) return;
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const body = await storage.read(connectionKey(uid));
      const saved = body ? JSON.parse(body) : null;
      return res.json({ available: Boolean(config()), connected: Boolean(saved?.accessToken && saved.expiresAt > Date.now()), scope: 'accounts' });
    } catch { return res.status(502).json({ error: 'Could not check your broker connection. Please retry.' }); }
  });
  app.post('/api/brokers/ctrader/connect', async (req, res) => {
    const uid = await storage.uid(req, res); if (!uid) return;
    const settings = config();
    if (!settings) return res.status(503).json({ error: 'cTrader connection is not available yet. Broker setup is being completed.' });
    const shareId = req.body?.shareId;
    if (typeof shareId !== 'string' || !validShareId(shareId)) return res.status(400).json({ error: 'Open a valid robot page before connecting a broker.' });
    try {
      const publicBot = await storage.read(`shared-bots/v1/${shareId}.json`);
      if (!publicBot || !JSON.parse(publicBot).published) return res.status(404).json({ error: 'This robot link is unavailable.' });
      const state = sealFlow({ uid, shareId, expiresAt: Date.now() + 10 * 60_000 }, settings.clientSecret);
      res.cookie('tv_ctrader_state', state, { httpOnly: true, secure: settings.redirectUri.startsWith('https:'), sameSite: 'lax', path: '/api/brokers/ctrader', maxAge: 10 * 60_000 });
      const url = new URL('https://id.ctrader.com/my/settings/openapi/grantingaccess/');
      url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.redirectUri, scope: 'accounts', product: 'web', state }).toString();
      return res.json({ url: url.toString() });
    } catch { return res.status(502).json({ error: 'Could not start the cTrader connection. Please retry.' }); }
  });
  app.get('/api/brokers/ctrader/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const cookie = req.header('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith('tv_ctrader_state='))?.slice('tv_ctrader_state='.length) || '';
    if (!/^[A-Za-z0-9_-]{40,2048}$/.test(state) || !/^[A-Za-z0-9_-]{40,2048}$/.test(cookie) || cookie.length !== state.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(state))) {
      return res.status(400).type('text').send('The broker connection could not be verified. Return to the robot page and connect again.');
    }
    let returnPath = '/';
    try {
      const settings = config();
      if (!settings) throw new Error('Broker app is not configured');
      const flow = openFlow(state, settings.clientSecret);
      if (!flow || typeof flow.uid !== 'string' || !flow.uid || flow.expiresAt < Date.now() || !validShareId(flow.shareId)) throw new Error('Expired flow');
      returnPath = `/bot/${flow.shareId}`;
      res.clearCookie('tv_ctrader_state', { path: '/api/brokers/ctrader' });
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (req.query.error || !code || code.length > 2048) throw new Error('Broker authorization declined');
      const url = new URL('https://openapi.ctrader.com/apps/token');
      url.search = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: settings.redirectUri, client_id: settings.clientId, client_secret: settings.clientSecret }).toString();
      const upstream = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      const tokens = await upstream.json() as { accessToken?: string; refreshToken?: string; expiresIn?: number; errorCode?: string };
      if (!upstream.ok || tokens.errorCode || typeof tokens.accessToken !== 'string' || typeof tokens.refreshToken !== 'string' || !Number.isFinite(Number(tokens.expiresIn)) || Number(tokens.expiresIn) <= 0) throw new Error('Broker token exchange failed');
      await storage.write(connectionKey(flow.uid), JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: Date.now() + Number(tokens.expiresIn) * 1000, scope: 'accounts', connectedAt: new Date().toISOString() }));
      return res.redirect(303, `${returnPath}?broker=connected`);
    } catch { return res.redirect(303, `${returnPath}?broker=error`); }
  });
}
