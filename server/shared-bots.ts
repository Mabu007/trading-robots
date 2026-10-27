import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export type PublicBot = {
  id: string;
  name: string;
  asset: string;
  description: string;
  coverImage: string;
  access: 'free';
  publishedAt: string;
};
type PublishedBot = PublicBot & { ownerUid: string; botId: string; code: string; published: boolean };
type Storage = {
  read: (key: string) => Promise<string | null>;
  write: (key: string, body: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  uid: (req: Request, res: Response) => Promise<string | null>;
  root: (uid: string, botId: string) => string;
};
const validId = (id: string) => /^[A-Za-z0-9_-]{1,100}$/.test(id);
export const validShareId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
const publicKey = (id: string) => `shared-bots/v1/${id}.json`;
const pointerKey = (storage: Storage, uid: string, botId: string) => `${storage.root(uid, botId)}/publication.json`;
function publicView(bot: PublishedBot): PublicBot {
  return { id: bot.id, name: bot.name, asset: bot.asset, description: bot.description, coverImage: bot.coverImage, access: 'free', publishedAt: bot.publishedAt };
}
export function validCover(value: unknown): value is string {
  if (value === '') return true;
  if (typeof value !== 'string') return false;
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length > 700_000) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 12 || bytes.length > 500_000) return false;
  return match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

export function sharedBotRoutes(app: Express, storage: Storage) {
  const readPublished = async (id: string) => {
    const body = await storage.read(publicKey(id));
    return body ? JSON.parse(body) as PublishedBot : null;
  };
  const readPointer = async (uid: string, botId: string) => {
    const pointer = await storage.read(pointerKey(storage, uid, botId));
    if (!pointer) return null;
    const id = JSON.parse(pointer).id;
    if (typeof id !== 'string' || !validShareId(id)) throw new Error('Invalid publication pointer');
    return id;
  };
  const ownerPublication = async (uid: string, botId: string) => {
    const id = await readPointer(uid, botId);
    if (!id) return null;
    const published = await readPublished(id);
    if (published && (published.ownerUid !== uid || published.botId !== botId)) throw new Error('Publication ownership mismatch');
    return published;
  };
  const unpublish = async (uid: string, botId: string) => {
    const published = await ownerPublication(uid, botId);
    if (published) await storage.write(publicKey(published.id), JSON.stringify({ ...published, published: false }));
  };
  const removePublication = async (uid: string, botId: string) => {
    const published = await ownerPublication(uid, botId);
    if (published) await storage.remove(publicKey(published.id));
  };

  app.get('/api/user-bots/:botId/publication', async (req, res) => {
    const uid = await storage.uid(req, res); if (!uid) return;
    if (!validId(req.params.botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const bot = await ownerPublication(uid, req.params.botId);
      return res.json({ publication: bot ? { ...publicView(bot), published: bot.published } : null });
    } catch { return res.status(502).json({ error: 'Could not load sharing settings. Please retry.' }); }
  });
  app.put('/api/user-bots/:botId/publication', async (req, res) => {
    const uid = await storage.uid(req, res); if (!uid) return;
    const { botId } = req.params;
    if (!validId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
    const { name, asset, description, coverImage = '', access = 'free' } = req.body ?? {};
    if (access !== 'free') return res.status(400).json({ error: 'Paid bots are coming soon. Publish this robot for free.' });
    if (typeof name !== 'string' || !name.trim() || name.length > 64 || !['EURUSD','GBPUSD','USDJPY','XAUUSD'].includes(asset)
      || typeof description !== 'string' || !description.trim() || description.length > 2000 || !validCover(coverImage)) {
      return res.status(400).json({ error: 'Add a name, description (up to 2,000 characters), and a JPG, PNG, or WebP cover under 500 KB.' });
    }
    try {
      const current = await storage.read(`${storage.root(uid, botId)}/current.json`);
      const saved = current ? JSON.parse(current) : null;
      if (!saved || saved.userId !== uid || saved.botId !== botId || typeof saved.code !== 'string' || !saved.code.trim()) {
        return res.status(409).json({ error: 'Save the robot’s strategy before sharing it.' });
      }
      const previous = await ownerPublication(uid, botId);
      const id = previous?.id || await readPointer(uid, botId) || randomUUID();
      const bot: PublishedBot = { id, ownerUid: uid, botId, name: name.trim(), asset, description: description.trim(), coverImage, access: 'free',
        code: saved.code, published: true, publishedAt: new Date().toISOString() };
      // Store the stable pointer first; a failed public write can be retried without losing the link.
      await storage.write(pointerKey(storage, uid, botId), JSON.stringify({ id }));
      await storage.write(publicKey(id), JSON.stringify(bot));
      return res.json({ publication: { ...publicView(bot), published: true } });
    } catch { return res.status(502).json({ error: 'Could not publish this robot. Your private robot is safe; retry in a moment.' }); }
  });
  app.delete('/api/user-bots/:botId/publication', async (req, res) => {
    const uid = await storage.uid(req, res); if (!uid) return;
    if (!validId(req.params.botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
    try { await unpublish(uid, req.params.botId); return res.json({ unpublished: true }); }
    catch { return res.status(502).json({ error: 'Could not unpublish the robot. Please retry.' }); }
  });
  app.get('/api/shared-bots/:shareId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!validShareId(req.params.shareId)) return res.status(404).json({ error: 'This robot link is unavailable.' });
    try {
      const bot = await readPublished(req.params.shareId);
      if (!bot?.published) return res.status(404).json({ error: 'This robot link is unavailable or has been unpublished.' });
      return res.json({ bot: publicView(bot) });
    } catch { return res.status(502).json({ error: 'Could not load this robot. Please try again.' }); }
  });
  app.post('/api/shared-bots/:shareId/copy', async (req, res) => {
    const uid = await storage.uid(req, res); if (!uid) return;
    if (!validShareId(req.params.shareId)) return res.status(404).json({ error: 'This robot link is unavailable.' });
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const shared = await readPublished(req.params.shareId);
      if (!shared?.published) return res.status(404).json({ error: 'This robot link is unavailable or has been unpublished.' });
      if (shared.access !== 'free') return res.status(403).json({ error: 'This robot is not available for free.' });
      const id = `shared-${shared.id}`;
      const storageKey = `${storage.root(uid, id)}/current.json`;
      const existing = await storage.read(storageKey);
      const stored = existing ? JSON.parse(existing) : null;
      if (stored && (stored.userId !== uid || stored.botId !== id)) throw new Error('Copy ownership mismatch');
      const code = stored?.code ?? shared.code;
      if (!existing) await storage.write(storageKey, JSON.stringify({ schemaVersion: 1, userId: uid, botId: id, code, updatedAt: new Date().toISOString() }));
      return res.json({ bot: { id, name: shared.name, asset: shared.asset, prompt: shared.description, storageKey, code } });
    } catch { return res.status(502).json({ error: 'Could not open a private copy of this robot. Please retry.' }); }
  });
  return { unpublish, removePublication };
}
