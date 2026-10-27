import express from 'express';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { ctraderRoutes } from './ctrader';

const app = express(); app.use(express.json());
const objects = new Map<string, string>();
ctraderRoutes(app, {
  read: async key => objects.get(key) ?? null, write: async (key, body) => { objects.set(key, body); },
  uid: async (req, res) => { if (!req.header('x-test-user')) { res.status(401).json({ error: 'Sign in' }); return null; } return req.header('x-test-user')!; },
});
let server: Server, base: string;
beforeAll(async () => { await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); }); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>(resolve => server.close(() => resolve())); });
it('does not start OAuth without an authenticated user or configured app', async () => {
  vi.stubEnv('CTRADER_CLIENT_ID', '');
  expect((await fetch(`${base}/api/brokers/ctrader/connect`, { method: 'POST' })).status).toBe(401);
  expect((await fetch(`${base}/api/brokers/ctrader/connect`, { method: 'POST', headers: { 'x-test-user': 'visitor' } })).status).toBe(503);
});
it('binds the OAuth flow to a secure browser cookie and rejects missing or mismatched state', async () => {
  vi.stubEnv('BROKER_TOKEN_ENCRYPTION_KEY',Buffer.alloc(32,1).toString('base64'));vi.stubEnv('CTRADER_CLIENT_ID','test-app'); vi.stubEnv('CTRADER_CLIENT_SECRET','test-secret'); vi.stubEnv('CTRADER_REDIRECT_URI','https://app.example/api/brokers/ctrader/callback');
  const id = '00000000-0000-4000-8000-000000000000';
  objects.set(`shared-bots/v1/${id}.json`, JSON.stringify({ published: true }));
  const response = await fetch(`${base}/api/brokers/ctrader/connect`, { method: 'POST', headers: { 'x-test-user':'visitor','Content-Type':'application/json' }, body: JSON.stringify({ shareId: id }) });
  const body = await response.json() as { url: string }, url = new URL(body.url);
  expect(url.origin).toBe('https://id.ctrader.com');
  expect(url.searchParams.get('scope')).toBe('trading');
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(response.headers.get('set-cookie')).toContain('Secure');
  const state = url.searchParams.get('state');
  expect(state!.length).toBeGreaterThan(64);
  expect((await fetch(`${base}/api/brokers/ctrader/callback?state=${state}&code=anything`)).status).toBe(400);
  expect((await fetch(`${base}/api/brokers/ctrader/callback?state=${state}&code=anything`, { headers:{cookie:`tv_ctrader_state=${'0'.repeat(64)}`} })).status).toBe(400);
});
it('stores tokens privately, exposes only connection status, and consumes the OAuth flow', async () => {
  const nativeFetch = fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => String(input).startsWith('https://openapi.ctrader.com/apps/token')
    ? Promise.resolve(new Response(JSON.stringify({ accessToken: 'private-access', refreshToken: 'private-refresh', expiresIn: 3600 })))
    : nativeFetch(input, init));
  try {
    const id = '00000000-0000-4000-8000-000000000000';
    const started = await fetch(`${base}/api/brokers/ctrader/connect`, { method: 'POST', headers: { 'x-test-user':'visitor','Content-Type':'application/json' }, body: JSON.stringify({ shareId: id }) });
    const { url } = await started.json() as { url: string };
    const state = new URL(url).searchParams.get('state');
    const response = await fetch(`${base}/api/brokers/ctrader/callback?state=${state}&code=code`, { redirect:'manual', headers:{cookie:`tv_ctrader_state=${state}`} });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`/bot/${id}?broker=connected`);
    expect([...objects.values()].join('')).not.toContain('private-access');
    expect([...objects.values()].join('')).not.toContain('private-refresh');
    expect([...objects.keys()].some(key => key.startsWith('broker-oauth/'))).toBe(false);
    const status = await fetch(`${base}/api/brokers/ctrader/status`, { headers:{'x-test-user':'visitor'} });
    expect(await status.json()).toEqual({ available:true, connected:true, scope:'trading' });
  } finally { vi.unstubAllGlobals(); }
});
