import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { sharedBotRoutes, validCover } from './shared-bots';

describe('shared robots', () => {
  const objects = new Map<string, string>();
  let server: Server, base: string;
  const root = (uid: string, botId: string) => `private/${uid}/${botId}`;
  const app = express(); app.use(express.json());
  const routes = sharedBotRoutes(app, {
    root, read: async key => objects.get(key) ?? null, write: async (key, body) => { objects.set(key, body); }, remove: async key => { objects.delete(key); },
    uid: async (req, res) => { const uid = req.header('x-test-user'); if (!uid) { res.status(401).json({ error: 'Sign in' }); return null; } return uid; },
  });
  const request = async (path: string, method = 'GET', uid?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(uid ? { 'x-test-user': uid } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  const settings = { name: 'Gold robot', asset: 'XAUUSD', description: 'A public strategy description.', coverImage: '', access: 'free' };
  const publish = () => request('/api/user-bots/original/publication', 'PUT', 'creator', settings);
  beforeAll(async () => { await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); }); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  beforeEach(() => { objects.clear(); objects.set(`${root('creator','original')}/current.json`, JSON.stringify({ userId: 'creator', botId: 'original', code: 'export function onCandle() { return { action: "WAIT" }; }' })); });

  it('exposes a public page without disclosing owner IDs, source code, or private storage', async () => {
    const saved = await publish(); expect(saved.status).toBe(200);
    const result = await request(`/api/shared-bots/${saved.body.publication.id}`);
    expect(result.status).toBe(200);
    expect(Object.keys(result.body.bot).sort()).toEqual(['id','name','asset','description','coverImage','access','publishedAt','priceMinor','currency','creator'].sort());
    expect(result.body.bot.name).toBe('Gold robot');
  });
  it('publishes and copies a VALR pair without changing its symbol', async () => {
    const saved = await request('/api/user-bots/original/publication', 'PUT', 'creator', {...settings, asset:'ETHZAR'});
    expect(saved.status).toBe(200);
    const copy = await request(`/api/shared-bots/${saved.body.publication.id}/copy`, 'POST', 'visitor');
    expect(copy.status).toBe(200); expect(copy.body.bot.asset).toBe('ETHZAR');
  });
  it('requires authentication for publishing, settings, and copying', async () => {
    const saved = await publish(), id = saved.body.publication.id;
    expect((await request('/api/user-bots/original/publication', 'PUT', undefined, settings)).status).toBe(401);
    expect((await request('/api/user-bots/original/publication')).status).toBe(401);
    expect((await request(`/api/shared-bots/${id}/copy`, 'POST')).status).toBe(401);
  });
  it('isolates ownership and rejects a forged publication pointer', async () => {
    const saved = await publish();
    expect((await request('/api/user-bots/original/publication', 'GET', 'other')).body.publication).toBeNull();
    expect((await request('/api/user-bots/original/publication', 'PUT', 'other', settings)).status).toBe(409);
    objects.set(`${root('other','original')}/publication.json`, JSON.stringify({ id: saved.body.publication.id }));
    expect((await request('/api/user-bots/original/publication', 'DELETE', 'other')).status).toBe(502);
    expect((await request(`/api/shared-bots/${saved.body.publication.id}`)).status).toBe(200);
  });
  it('copies for each visitor and preserves their edits on repeated opens', async () => {
    const saved = await publish(), id = saved.body.publication.id;
    const first = await request(`/api/shared-bots/${id}/copy`, 'POST', 'visitor');
    expect(first.status).toBe(200);
    expect(first.body.bot.id).not.toBe('original');
    const key = first.body.bot.storageKey;
    objects.set(key, JSON.stringify({ userId: 'visitor', botId: first.body.bot.id, code: 'my edited code' }));
    const second = await request(`/api/shared-bots/${id}/copy`, 'POST', 'visitor');
    expect(second.body.bot.code).toBe('my edited code');
    expect(second.body.bot.id).toBe(first.body.bot.id);
    const other = await request(`/api/shared-bots/${id}/copy`, 'POST', 'another');
    expect(other.body.bot.storageKey).not.toBe(key);
    expect(objects.get(`${root('creator','original')}/current.json`)).toContain('onCandle');
  });
  it('keeps the link stable across updates and unpublishing, and blocks new copies while unpublished', async () => {
    const saved = await publish(), id = saved.body.publication.id;
    expect((await request('/api/user-bots/original/publication', 'DELETE', 'creator')).status).toBe(200);
    expect((await request(`/api/shared-bots/${id}`)).status).toBe(404);
    expect((await request(`/api/shared-bots/${id}/copy`, 'POST', 'visitor')).status).toBe(404);
    const republished = await publish(); expect(republished.body.publication.id).toBe(id);
    await routes.removePublication('creator', 'original');
    expect((await request(`/api/shared-bots/${id}`)).status).toBe(404);
  });
  it('blocks paid publishing and unsupported cover formats', async () => {
    expect((await request('/api/user-bots/original/publication', 'PUT', 'creator', { ...settings, access: 'paid' })).status).toBe(400);
    expect((await request('/api/user-bots/original/publication', 'PUT', 'creator', { ...settings, coverImage: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400);
    expect(validCover('https://attacker.example/image.png')).toBe(false);
    expect(validCover('data:image/png;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect((await request('/api/shared-bots/invalid-id')).status).toBe(404);
  });
});
