import express from 'express';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { valrAccountRoutes } from './valr-routes';

const objects = new Map<string, string>();
const provider = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/current') ? Response.json({ label:'Test', permissions:['View access','Trade'] }) : Response.json([{ currency:'ZAR', available:'25', total:'25', reserved:'0' }]));
const app = express(); app.use(express.json());
valrAccountRoutes(app, {
  uid: async (req, res) => { const uid = req.header('x-test-user'); if (!uid) { res.status(401).json({ error:'Sign in' }); return null; } return uid; },
  read: async key => objects.get(key) ?? null,
  write: async (key, value) => { objects.set(key, value); },
  remove: async key => { objects.delete(key); },
  request: provider as typeof fetch,
  key: () => Buffer.alloc(32, 1).toString('base64'),
});
let server: Server, base = '';
beforeAll(async () => { await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); }); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

it('authenticates users, encrypts their keys, isolates accounts and removes only their credentials', async () => {
  expect((await fetch(`${base}/api/valr/account`)).status).toBe(401);
  const creds = { apiKey:'a'.repeat(64), apiSecret:'b'.repeat(64) };
  const connected = await fetch(`${base}/api/valr/account/connect`, { method:'POST', headers:{ 'Content-Type':'application/json','x-test-user':'alice' }, body:JSON.stringify(creds) });
  expect(connected.status).toBe(200);
  expect(connected.headers.get('cache-control')).toBe('no-store');
  const responseText = await connected.text();
  expect(responseText).not.toContain(creds.apiKey);
  expect(responseText).not.toContain(creds.apiSecret);
  expect([...objects.values()].join('')).not.toContain(creds.apiSecret);
  expect(await (await fetch(`${base}/api/valr/account`, {headers:{'x-test-user':'bob'}})).json()).toEqual({connected:false});
  expect(((await (await fetch(`${base}/api/valr/account`, {headers:{'x-test-user':'alice'}})).json()) as {connected:boolean}).connected).toBe(true);
  const disconnected = await fetch(`${base}/api/valr/account/disconnect`, {method:'POST',headers:{'x-test-user':'alice'}});
  expect(await disconnected.json()).toEqual({connected:false,positionsClosed:false,revokeAtValr:true});
  expect(objects.size).toBe(0);
});
