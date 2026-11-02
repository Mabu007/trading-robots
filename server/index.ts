import {venueOf} from '../shared/venues.ts';
import 'dotenv/config';
import {requestLimit} from './request-limits.ts';
import express from 'express';
import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { deleteR2Object, getR2Config, listR2Objects, readR2Object, writeR2Object } from './r2.ts';
import {recordAIUsage} from './usage.ts';
import { BotEconomy, economyRoutes } from './bot-economy.ts';
import { sharedBotRoutes } from './shared-bots.ts';
import { marketplace,marketplaceRoutes } from './marketplace.ts';
import { FirestoreStore } from './firestore-store.ts';
import { ValrMarketData } from './valr-market-data.ts';
import { VenueMarketData } from './venue-market-data.ts';
import { DwellirHistory } from './dwellir-history.ts';
import { PropDAOAccounts, propDAORoutes } from './propdao-account.ts';
import { valrAccountRoutes } from './valr-routes.ts';
import { valrPaperRoutes } from './valr-paper-routes.ts';
import {ValrAccountLock} from './valr-account-lock.ts';
import {valrLiveRoutes} from './valr-live-routes.ts';
import { OpenRouterAccounts, openRouterRoutes } from './openrouter-account.ts';
import { readOwnedBotAsset } from './firebase-owned-bot.ts';

const app = express();
const valrMarketData = new ValrMarketData();
const venueMarketData = new VenueMarketData();
const dwellirHistory = new DwellirHistory();
app.use(['/api/marketplace','/api/economy','/api/valr','/api/venues','/api/openrouter'],requestLimit);
app.use(express.json({ limit: '10mb' }));


type FirebaseClaims = { email?:string; email_verified?:boolean; name?:string; sub?: string; user_id?: string; aud?: string; iss?: string; exp?: number; iat?: number };
let secureTokenJwks: { keys: any[]; expiresAt: number } | undefined;
async function verifyFirebaseUser(authorization: string | undefined): Promise<{uid:string;email?:string;emailVerified:boolean;name?:string}> {
  const serverProject = process.env.FIREBASE_PROJECT_ID?.trim();
  const webProject = process.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (serverProject && webProject && serverProject !== webProject) throw new Error('Firebase project configuration mismatch: server and web project IDs must match.');
  const projectId = webProject || serverProject;
  if (!projectId) throw new Error('Firebase project ID is not configured on the API server.');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error('Sign in to use this feature.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Firebase sign-in token is invalid.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as FirebaseClaims;
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Firebase sign-in token is invalid.');
  if (!secureTokenJwks || secureTokenJwks.expiresAt <= Date.now()) {
    const response = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Could not verify Firebase sign-in right now. Retry in a moment.');
    const jwks = await response.json() as { keys?: any[] };
    if (!Array.isArray(jwks.keys)) throw new Error('Firebase sign-in verification is unavailable.');
    const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 3600);
    secureTokenJwks = { keys: jwks.keys, expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000 };
  }
  const jwk = secureTokenJwks.keys.find(key => key.kid === header.kid);
  if (!jwk) { secureTokenJwks = undefined; throw new Error('Firebase signing key has rotated. Retry the request.'); }
  const publicJwk = { kty: jwk.kty, n: jwk.n, e: jwk.e, ...(jwk.alg ? { alg: jwk.alg } : {}) };
  const validSignature = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: publicJwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  const now = Math.floor(Date.now() / 1000);
  if (!validSignature || claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` || !claims.exp || claims.exp <= now || !claims.iat || claims.iat > now + 60) {
    throw new Error('Firebase sign-in token is expired or invalid. Sign in again.');
  }
  const uid = claims.user_id || claims.sub;
  if (!uid || uid.length > 128) throw new Error('Firebase account ID is invalid.');
  return {uid,email:claims.email,emailVerified:claims.email_verified===true,name:claims.name};
}

app.get('/api/health', (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.OPENROUTER_API_KEY) }));
// VALR is the sole market-data provider. Public calls need no credentials.
app.get('/api/valr/markets', async (_req, res) => {
  try { return res.json({ markets: await valrMarketData.pairs() }); }
  catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'VALR market data unavailable.' }); }
});
app.post('/api/valr/candles', async (req, res) => {
  try { return res.json(await valrMarketData.candles(req.body ?? {})); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'VALR market data unavailable.';
    return res.status(/^Choose|^Unsupported|^Dates|^A page|^This market/.test(message) ? 400 : 502).json({ error: message });
  }
});
app.get('/api/venues/propdao/markets', async (_req,res) => {
  try { res.json(await venueMarketData.propdaoMarkets()); } catch { res.status(502).json({error:'PropDAO markets are unavailable.'}); }
});
app.get('/api/venues/hyperliquid/markets', async (_req,res) => {
  try { res.json(await venueMarketData.hyperliquidMarkets()); } catch { res.status(502).json({error:'Hyperliquid markets are unavailable.'}); }
});
app.post('/api/venues/propdao/candles', async (req,res) => {
 try {
  const market=(await venueMarketData.propdaoMarkets()).markets.find((m:any)=>m.symbol===req.body?.asset);
  if(!market)return res.status(400).json({error:'Choose an available PropDAO market.'});
  const coin=market.dex?(market.coin.includes(':')?market.coin:`${market.dex}:${market.coin}`):market.coin;
  const discovered=(await venueMarketData.hyperliquidMarkets()).markets.some((m:any)=>m.symbol===coin);
  if(!discovered)return res.status(422).json({error:'No verified matching Hyperliquid market is available.'});
  const data=await dwellirHistory.candles({...req.body,asset:coin});
  return res.json({...data,asset:market.symbol,source:`Dwellir / Hyperliquid reference (${coin}) for PropDAO; fills may differ`});
 }catch(error){
  const message=error instanceof Error?error.message:'PropDAO historical data is unavailable.';
  const invalid=/^(Choose|Select)/.test(message);
  return res.status(invalid?400:502).json({error:message});
 }
});
app.post('/api/venues/hyperliquid/candles', async (req,res) => {
  try { res.json(await venueMarketData.hyperliquidCandles(req.body ?? {})); } catch (error) {
    const message = error instanceof Error ? error.message : 'Hyperliquid data unavailable.';
    res.status(message.startsWith('Choose') ? 400 : 502).json({error:message});
  }
});
function validBotId(value: string): boolean { return /^[A-Za-z0-9_-]{1,100}$/.test(value); }
function userBotRoot(uid: string, botId: string): string { return `user-bots/${Buffer.from(uid).toString('base64url')}/${botId}`; }
async function firebaseUidOrReply(req: express.Request, res: express.Response): Promise<string | null> {
  try { const identity=await verifyFirebaseUser(req.header('authorization'));(req as any).verifiedIdentity=identity;res.locals.identity=identity;return identity.uid; }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Could not verify Firebase sign-in.';
    const unavailable = /not configured|configuration mismatch|Could not verify Firebase|verification is unavailable/i.test(message);
    res.status(unavailable ? 503 : 401).json({ error: message });
    return null;
  }
}

propDAORoutes(app,new PropDAOAccounts({read:readR2Object,write:writeR2Object,remove:deleteR2Object}),firebaseUidOrReply);
const openRouterAccounts = new OpenRouterAccounts({read:readR2Object,write:writeR2Object,remove:deleteR2Object});
openRouterRoutes(app,openRouterAccounts,firebaseUidOrReply);
const economy=new BotEconomy(marketplace.store,{read:readR2Object,write:writeR2Object,root:userBotRoot},marketplace);
const ownedValrBot=async(uid:string,id:string,req:express.Request)=>{
 const [bot,raw]=await Promise.all([FirestoreStore.configured()?marketplace.store.get(`users/${uid}/bots/${id}`):readOwnedBotAsset(uid,id,req.header('authorization')),readR2Object(`${userBotRoot(uid,id)}/current.json`)]);
 if(!bot||!raw)return null;if('venue' in bot && bot.venue!==undefined && bot.venue!=='valr')return null;const saved=JSON.parse(raw);if(saved.userId!==uid||saved.botId!==id||typeof saved.code!=='string'||typeof bot.asset!=='string')return null;return {asset:bot.asset,code:saved.code};
};
const valrLock=new ValrAccountLock(marketplace.store);
const valrExclusive=<T>(uid:string,task:()=>Promise<T>)=>FirestoreStore.configured()?valrLock.run(uid,task):task();
const liveService=valrLiveRoutes(app,{lockReady:()=>FirestoreStore.configured(),exclusive:valrExclusive,uid:firebaseUidOrReply,bot:ownedValrBot,read:readR2Object,write:writeR2Object,remove:deleteR2Object});
valrAccountRoutes(app,{uid:firebaseUidOrReply,read:readR2Object,write:writeR2Object,remove:deleteR2Object,beforeChange:uid=>liveService.beforeKeyChange(uid),mutate:valrExclusive});
valrPaperRoutes(app,{uid:firebaseUidOrReply,bot:ownedValrBot});
economyRoutes(app,economy,async(req,res)=>{const uid=await firebaseUidOrReply(req,res);return uid?res.locals.identity:null;});
const publications = sharedBotRoutes(app, { read: readR2Object, write: writeR2Object, remove: deleteR2Object, uid: firebaseUidOrReply, root: userBotRoot,...(FirestoreStore.configured()?{onPublish:(bot:any)=>economy.publishSharedBot(bot),onAcquire:async(uid:string,id:string,bot:any)=>{if(!await marketplace.store.get(`marketplaceBots/${id}`))await marketplace.publish(bot);return economy.acquireSharedBot(uid,bot)},onUnpublish:(uid:string,id:string)=>marketplace.unpublish(uid,id),onView:(bot:any,visitor:string)=>marketplace.view(bot,visitor)}:{}) });
marketplaceRoutes(app,{uid:firebaseUidOrReply,read:readR2Object,write:writeR2Object,root:userBotRoot});

app.put('/api/user-bots/:botId/current', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  const { code } = req.body ?? {};
  if (!validBotId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
  if (typeof code !== 'string' || !code.trim() || code.length > 180_000) return res.status(400).json({ error: 'Robot code must be between 1 and 180,000 characters.' });
  if (!getR2Config()) return res.status(503).json({ error: 'Robot storage is not configured on the server.' });
  const storageKey = `${userBotRoot(uid, botId)}/current.json`;
  try {
    await writeR2Object(storageKey, JSON.stringify({ schemaVersion: 1, userId: uid, botId, code, venue:venueOf(req.body?.venue), updatedAt: new Date().toISOString() }));
    return res.json({ storageKey });
  } catch (error) {
    console.error('User robot save failed', { botId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not save this robot to secure storage. Retry in a moment.' });
  }
});

app.get('/api/user-bots/:botId/current', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  if (!validBotId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
  try {
    const body = await readR2Object(`${userBotRoot(uid, botId)}/current.json`);
    if (!body) return res.status(404).json({ error: 'No saved code was found for this robot.' });
    const stored = JSON.parse(body) as { userId?: string; botId?: string; code?: string };
    if (stored.userId !== uid || stored.botId !== botId || typeof stored.code !== 'string') return res.status(409).json({ error: 'Stored robot data failed its ownership check.' });
    return res.json({ code: stored.code });
  } catch (error) {
    console.error('User robot read failed', { botId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not load this robot from secure storage. Retry in a moment.' });
  }
});

app.delete('/api/user-bots/:botId', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  if (!validBotId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
  if (!getR2Config()) return res.status(503).json({ error: 'Robot storage is not configured.' });
  try {
    await valrExclusive(uid,async()=>{
    const grant=await liveService.grant(uid);if(grant?.botId===botId)await liveService.beforeKeyChange(uid);
    const prefix = `${userBotRoot(uid, botId)}/`;
    const keys = await listR2Objects(prefix, 1001);
    if (keys.length > 1000) throw Error('This robot has too many stored versions to delete safely. Contact support.');
    await publications.removePublication(uid, botId);
    for (let i = 0; i < keys.length; i += 10) await Promise.all(keys.slice(i, i + 10).map(deleteR2Object));
    });
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Robot deletion failed', { botId, error });
    return res.status(502).json({ error: 'Could not delete all robot files. Retry the deletion.' });
  }
});

type CompressedRun = {format:'gzip-base64';version:2;payload:string;uncompressedBytes:number};
function isCompressedRun(value:unknown):value is CompressedRun {
 const v=value as Partial<CompressedRun>|null;
 return !!v&&v.format==='gzip-base64'&&v.version===2&&typeof v.payload==='string'&&v.payload.length>0&&v.payload.length<3_000_000&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.payload)&&Number.isInteger(v.uncompressedBytes)&&v.uncompressedBytes!>0&&v.uncompressedBytes!<=60_000_000;
}
function checkBacktestState(state:any):boolean {
 return !!state&&typeof state==='object'&&!!state.result&&Array.isArray(state.result.candles)&&Array.isArray(state.result.trades)&&Array.isArray(state.logs);
}
function verifyCompressedRun(value:CompressedRun):boolean {
 const bytes=gunzipSync(Buffer.from(value.payload,'base64'),{maxOutputLength:60_000_000});
 if(bytes.byteLength!==value.uncompressedBytes)return false;
 const state=JSON.parse(bytes.toString('utf8'));
 return checkBacktestState(state);
}

app.put('/api/user-bots/:botId/backtest', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  const state = req.body;
  if (!validBotId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
  if (!isCompressedRun(state)) return res.status(400).json({ error: 'Invalid compressed backtest payload. Reload the application and retry.' });
  try { if (!verifyCompressedRun(state)) return res.status(400).json({ error: 'The completed backtest is incomplete.' }); }
  catch { return res.status(400).json({ error: 'Backtest compression failed integrity validation.' }); }
  const serialized = JSON.stringify({ ...state, schemaVersion: 2, userId: uid, botId, savedAt: new Date().toISOString() });
  try {
    await writeR2Object(`${userBotRoot(uid, botId)}/backtest.json`, serialized);
    return res.json({ saved: true });
  } catch (error) {
    console.error('User backtest save failed', { botId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not sync this backtest. It is still available in this session.' });
  }
});

app.delete('/api/user-bots/:botId/backtest', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  if (!validBotId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
  try {
    await deleteR2Object(`${userBotRoot(uid, botId)}/backtest.json`);
    return res.json({ deleted: true });
  } catch (error) {
    console.error('User backtest delete failed', { botId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not delete this saved backtest. Retry in a moment.' });
  }
});

app.patch('/api/user-bots/:botId/backtest', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  if (!validBotId(botId) || !Array.isArray(req.body?.logs)) return res.status(400).json({ error: 'Terminal state is invalid.' });
  try {
    const key = `${userBotRoot(uid, botId)}/backtest.json`;
    const body = await readR2Object(key);
    if (!body) return res.status(404).json({ error: 'No completed backtest was found for this robot.' });
    const stored = JSON.parse(body);
    if (stored.userId !== uid || stored.botId !== botId) return res.status(409).json({ error: 'Saved backtest data failed its ownership check.' });
    stored.logs = req.body.logs.slice(-500).filter((line: unknown) => typeof line === 'string').map((line: string) => line.slice(0, 2000));
    stored.savedAt = new Date().toISOString();
    await writeR2Object(key, JSON.stringify(stored));
    return res.json({ saved: true });
  } catch (error) {
    console.error('Terminal state save failed', { botId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not sync terminal changes.' });
  }
});

app.get('/api/user-bots/:botId/backtest', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  if (!validBotId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
  try {
    const body = await readR2Object(`${userBotRoot(uid, botId)}/backtest.json`);
    if (!body) return res.status(404).json({ error: 'No completed backtest was found for this robot.' });
    const stored = JSON.parse(body);
    if (stored.userId !== uid || stored.botId !== botId || !(isCompressedRun(stored) || checkBacktestState(stored))) {
      return res.status(409).json({ error: 'Saved backtest data failed its ownership or format check.' });
    }
    const { userId: _userId, botId: _botId, schemaVersion: _schemaVersion, ...state } = stored;
    return res.json(state);
  } catch (error) {
    console.error('User backtest read failed', { botId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not load this robot’s saved backtest. Retry in a moment.' });
  }
});

app.post('/api/user-bots/:botId/versions', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  const { code } = req.body ?? {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 64) : '';
  if (!validBotId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
  if (typeof code !== 'string' || !code.trim() || code.length > 180_000) return res.status(400).json({ error: 'Robot code must be between 1 and 180,000 characters.' });
  if (!getR2Config()) return res.status(503).json({ error: 'Robot storage is not configured on the server.' });
  const id = `${Date.now()}-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const storageKey = `${userBotRoot(uid, botId)}/versions/${id}.json`;
  try {
    await writeR2Object(storageKey, JSON.stringify({ schemaVersion: 1, userId: uid, botId, versionId: id, name: name || `Version ${new Date().toLocaleString()}`, code, createdAt }));
    return res.json({ id, name: name || `Version ${new Date().toLocaleString()}`, storageKey, createdAt });
  } catch (error) {
    console.error('User robot version save failed', { botId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not save this robot version. Retry in a moment.' });
  }
});

app.get('/api/user-bots/:botId/versions/:versionId', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId, versionId } = req.params;
  if (!validBotId(botId) || !/^[A-Za-z0-9_-]{8,100}$/.test(versionId)) return res.status(400).json({ error: 'Robot or version ID is invalid.' });
  try {
    const body = await readR2Object(`${userBotRoot(uid, botId)}/versions/${versionId}.json`);
    if (!body) return res.status(404).json({ error: 'This saved version could not be found.' });
    const stored = JSON.parse(body) as { userId?: string; botId?: string; versionId?: string; code?: string };
    if (stored.userId !== uid || stored.botId !== botId || stored.versionId !== versionId || typeof stored.code !== 'string') return res.status(409).json({ error: 'Stored version failed its ownership check.' });
    return res.json(stored);
  } catch (error) {
    console.error('User robot version read failed', { botId, versionId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not load this saved version. Retry in a moment.' });
  }
});

app.patch('/api/user-bots/:botId/versions/:versionId', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId, versionId } = req.params;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 64) : '';
  if (!validBotId(botId) || !/^[A-Za-z0-9_-]{8,100}$/.test(versionId)) return res.status(400).json({ error: 'Robot or version ID is invalid.' });
  if (!name) return res.status(400).json({ error: 'Version name must contain 1 to 64 characters.' });
  const key = `${userBotRoot(uid, botId)}/versions/${versionId}.json`;
  try {
    const body = await readR2Object(key);
    if (!body) return res.status(404).json({ error: 'This saved version could not be found.' });
    const stored = JSON.parse(body) as { userId?: string; botId?: string; versionId?: string; code?: string; createdAt?: string; name?: string };
    if (stored.userId !== uid || stored.botId !== botId || stored.versionId !== versionId || typeof stored.code !== 'string') return res.status(409).json({ error: 'Stored version failed its ownership check.' });
    await writeR2Object(key, JSON.stringify({ ...stored, name, updatedAt: new Date().toISOString() }));
    return res.json({ id: versionId, name, storageKey: key, createdAt: stored.createdAt || new Date().toISOString() });
  } catch (error) {
    console.error('User robot version rename failed', { botId, versionId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not rename this saved version. Retry in a moment.' });
  }
});

app.delete('/api/user-bots/:botId/versions/:versionId', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId, versionId } = req.params;
  if (!validBotId(botId) || !/^[A-Za-z0-9_-]{8,100}$/.test(versionId)) return res.status(400).json({ error: 'Robot or version ID is invalid.' });
  const key = `${userBotRoot(uid, botId)}/versions/${versionId}.json`;
  try {
    const body = await readR2Object(key);
    if (!body) return res.status(404).json({ error: 'This saved version could not be found.' });
    const stored = JSON.parse(body) as { userId?: string; botId?: string; versionId?: string };
    if (stored.userId !== uid || stored.botId !== botId || stored.versionId !== versionId) return res.status(409).json({ error: 'Stored version failed its ownership check.' });
    await deleteR2Object(key);
    return res.json({ id: versionId, deleted: true });
  } catch (error) {
    console.error('User robot version delete failed', { botId, versionId, message: error instanceof Error ? error.message : String(error) });
    return res.status(502).json({ error: 'Could not delete this saved version. Retry in a moment.' });
  }
});

const aiHits = new Map<string, { started: number; count: number }>();
async function requestOpenRouter(body: string, apiKey: string, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173', 'X-Title': 'TradeFoundry' },
      body,
      signal,
    });
  } catch (error) {
    const causes: any[] = []; const pending: any[] = [error]; const seen = new Set<unknown>();
    while (pending.length) { const cause = pending.shift(); if (!cause || seen.has(cause)) continue; seen.add(cause); causes.push(cause); if (cause.cause) pending.push(cause.cause); if (Array.isArray(cause.errors)) pending.push(...cause.errors); }
    const network = causes.find(cause => typeof cause.code === 'string' && /^(EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)$/.test(cause.code));
    if (network && !signal.aborted) {
      await new Promise(resolve => setTimeout(resolve, 250));
      return fetch('https://openrouter.ai/api/v1/chat/completions', {
        method:'POST', headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','HTTP-Referer':process.env.APP_URL||'http://localhost:5173','X-Title':'TradeFoundry'}, body, signal,
      });
    }
    throw error;
  }
}

app.post('/api/ai', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  let personalAI: Awaited<ReturnType<typeof openRouterAccounts.load>>;
  try { personalAI = await openRouterAccounts.load(uid); } catch { return res.status(503).json({ error: 'Unable to access AI credentials. Reconnect your key.' }); }
  const apiKey = personalAI?.apiKey || (process.env.ALLOW_SHARED_OPENROUTER_KEY === 'true' ? process.env.OPENROUTER_API_KEY?.trim() : undefined);
  if (!apiKey) return res.status(503).json({ error: 'Connect your OpenRouter API key to enable AI.' });
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 24
    || messages.some((m: any) => !m || !['system', 'user', 'assistant'].includes(m.role)
      || typeof m.content !== 'string' || m.content.length > 80_000)) {
    return res.status(400).json({ error: 'Send 1–24 chat messages with supported roles and text content under 80 KB each.' });
  }
  const selectedAsset = req.body?.asset;
  if (selectedAsset !== undefined && (typeof selectedAsset !== 'string' || !/^[a-zA-Z0-9_:.@-]{1,64}$/.test(selectedAsset))) return res.status(400).json({ error: 'Choose a supported instrument for AI context.' });
  const requestedTokens = Number(req.body?.maxTokens);
  const maxTokens = Number.isInteger(requestedTokens) ? Math.max(200, Math.min(6000, requestedTokens)) : 1600;

  const now = Date.now();
  const clientId = uid;
  const hit = aiHits.get(clientId);
  const current = !hit || now - hit.started >= 60_000 ? { started: now, count: 0 } : hit;
  if (current.count >= 12) return res.status(429).json({ error: 'AI request limit reached. Wait a minute and try again.' });
  current.count++;
  aiHits.set(clientId, current);
  for (const [id, entry] of aiHits) if (now - entry.started > 120_000) aiHits.delete(id);

  const model = personalAI?.model || process.env.OPENROUTER_MODEL?.trim() || 'minimax/minimax-m3:free';
  const meteredModel=model;
  let usageStatus:'completed'|'failed'|'interrupted'='failed',measuredUsage:any=null,usageBuffer='',finishReason:string|null=null,sawDone=false,providerError=false;const usageDecoder=new TextDecoder();
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const clientAbort = new AbortController();
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': stream-open\n\n');
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keep-alive\n\n'); }, 10_000);
  res.on('close', () => { if (!res.writableEnded) { clientAbort.abort(); void upstreamReader?.cancel().catch(() => undefined); } });
  try {
    const requestModel = (targetModel: string) => requestOpenRouter(
      JSON.stringify({ model: targetModel, messages, temperature: 0.2, max_tokens: maxTokens, stream: true,stream_options:{include_usage:true} }),
      apiKey,
      AbortSignal.any([clientAbort.signal, AbortSignal.timeout(45_000)]),
    );
    const response = await requestModel(model);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      console.warn('OpenRouter rejected request', { model, status: response.status });
      const friendly = response.status === 401 ? 'OpenRouter rejected the API key. Check your connection and key settings.'
        : response.status === 402 ? 'OpenRouter needs available credits or billing before it can generate a response.'
          : response.status === 404 ? 'The selected OpenRouter model was not found. Choose another model.'
            : response.status === 429 ? 'OpenRouter rate limit reached. Wait briefly and retry.'
              : response.status === 400 ? 'The request is too long or invalid for this model. Shorten the request or configure another model.'
                : response.status === 403 ? 'The selected model is unavailable to this account. Choose another model.'
                  : response.status >= 500 ? 'The model provider is temporarily unavailable. Retry later.'
                    : `OpenRouter request failed (HTTP ${response.status}).`;
      throw new Error(friendly);
    }
    if (!response.body) throw new Error('OpenRouter returned no streaming response body.');
    upstreamReader = response.body.getReader();
    while (true) {
      const { value, done } = await upstreamReader.read();
      if (done) break;
      usageBuffer+=usageDecoder.decode(value,{stream:true});const lines=usageBuffer.split('\n');usageBuffer=lines.pop()!.slice(-16000);for(const line of lines){if(line.startsWith('data:')){const payload=line.slice(5).trim();if(payload==='[DONE]'){sawDone=true;continue}try{const event=JSON.parse(payload);if(event.usage)measuredUsage=event.usage;if(event.error)providerError=true;if(event.choices?.[0]?.finish_reason)finishReason=event.choices[0].finish_reason;}catch{}}}
      if (!res.write(value)) await new Promise<void>(resolve => res.once('drain', resolve));
    }
    usageStatus=providerError ? 'failed' : sawDone && finishReason !== 'length' ? 'completed' : 'interrupted';
    console.info('OpenRouter stream finished', { model, finishReason, sawDone, providerError, status: usageStatus, completionTokens: measuredUsage?.completion_tokens ?? null });
    return res.end();
  } catch (error) {
    if(clientAbort.signal.aborted)usageStatus='interrupted';
    const causes: any[] = [];
    const pending: any[] = [error];
    const seen = new Set<unknown>();
    while (pending.length) {
      const cause = pending.shift();
      if (!cause || seen.has(cause)) continue;
      seen.add(cause);
      causes.push(cause);
      if (cause.cause) pending.push(cause.cause);
      if (Array.isArray(cause.errors)) pending.push(...cause.errors);
    }
    const networkCode = causes.map(cause => cause.code).find(code => typeof code === 'string' && /^(EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)$/.test(code));
    const message = error instanceof Error && (error.name === 'TimeoutError' || causes.some(cause => cause.name === 'TimeoutError'))
      ? 'Generation timed out after 45 seconds. Retry or configure another permitted model.'
      : networkCode
        ? `Could not connect to OpenRouter (${networkCode}). Check server internet access, DNS, or firewall and retry.`
        : error instanceof Error && error.message.toLowerCase().includes('fetch failed')
          ? 'Could not connect to OpenRouter. Check server internet access, DNS, or firewall and retry.'
          : error instanceof Error ? error.message : 'AI request failed.';
    console.error('OpenRouter request failed', { model, networkCode: networkCode ?? null, name: error instanceof Error ? error.name : typeof error });
    if (!res.destroyed) res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
    return res.end();
  } finally {
    clearInterval(heartbeat);
    if(FirestoreStore.configured())await recordAIUsage(marketplace.store,uid,{provider:'openrouter',model:meteredModel,status:usageStatus,inputTokens:measuredUsage?.prompt_tokens,outputTokens:measuredUsage?.completion_tokens}).catch(()=>console.warn('AI usage record unavailable'));
  }
});

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  console.error('API request failed', error);
  return res.status(500).json({ error: 'The API encountered an unexpected error. Check the server logs and retry.' });
});

export default app;
