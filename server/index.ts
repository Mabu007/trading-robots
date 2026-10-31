import 'dotenv/config';
import {requestLimit} from './request-limits.ts';
import express from 'express';
import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { deleteR2Object, getR2Config, listR2Objects, readR2Object, writeR2Object } from './r2.ts';
import { candleObjectKey, countObservedGaps, intervalMs, isAsset, isTimeframe, mapConcurrent, normalizeCandles, parseCandleCsv, utcDateKey, type MarketAsset, type MarketCandle, type MarketTimeframe } from './market-data.ts';
import {recordAIUsage} from './usage.ts';
import { BotEconomy, economyRoutes } from './bot-economy.ts';
import { sharedBotRoutes } from './shared-bots.ts';
import { ctraderRoutes } from './ctrader.ts';
import { marketplace,marketplaceRoutes,assertProjectEditable } from './marketplace.ts';
import { FirestoreStore } from './firestore-store.ts';
import { brokerRoutes,gatewayRequest,gatewayHealth } from './broker-routes.ts';
import { BrokerTokenStore } from './broker-tokens.ts';
import { ValrMarketData } from './valr-market-data.ts';
import { valrAccountRoutes } from './valr-routes.ts';
import { valrPaperRoutes } from './valr-paper-routes.ts';
import { legacyProviderGuard } from './legacy-provider-guard.ts';
import { OpenRouterAccounts, openRouterRoutes } from './openrouter-account.ts';

const app = express();
const valrMarketData = new ValrMarketData();
app.use(['/api/marketplace','/api/brokers','/api/economy','/api/valr','/api/openrouter'],requestLimit);
app.use(express.json({ limit: '10mb' }));
app.use(legacyProviderGuard);
const assets = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'] as const;

type StoredMarketDay = { schemaVersion: 1; asset: MarketAsset; timeframe: MarketTimeframe; date: string; source: 'manual'; priceType: 'unknown'; updatedAt: string; candles: MarketCandle[] };

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

function sameOhlc(left: MarketCandle, right: MarketCandle): boolean {
  return left.open === right.open && left.high === right.high && left.low === right.low && left.close === right.close;
}

async function readMarketDay(asset: MarketAsset, timeframe: MarketTimeframe, date: string): Promise<MarketCandle[] | null> {
  const body = await readR2Object(candleObjectKey(asset, timeframe, date));
  if (body === null) return null;
  let stored: StoredMarketDay;
  try { stored = JSON.parse(body) as StoredMarketDay; }
  catch { throw new Error(`R2 market data for ${asset} ${timeframe} ${date} is not valid JSON. Re-import this day.`); }
  if (stored.schemaVersion !== 1 || stored.asset !== asset || stored.timeframe !== timeframe || stored.date !== date || !Array.isArray(stored.candles)) {
    throw new Error(`R2 market data for ${asset} ${timeframe} ${date} has an unsupported or mismatched format.`);
  }
  const { candles, invalidRows } = normalizeCandles(stored.candles);
  if (invalidRows || candles.length !== stored.candles.length || candles.some(candle => utcDateKey(candle.time) !== date)) throw new Error(`R2 market data for ${asset} ${timeframe} ${date} contains invalid, duplicate, or misplaced candles. Re-import this day.`);
  return candles;
}

function storedDay(asset: MarketAsset, timeframe: MarketTimeframe, date: string, candles: MarketCandle[]): StoredMarketDay {
  return { schemaVersion: 1, asset, timeframe, date, source: 'manual', priceType: 'unknown', updatedAt: new Date().toISOString(), candles };
}

function parseR2CandleFile(key: string, body: string): MarketCandle[] {
  if (/\.(csv|txt)$/i.test(key)) return parseCandleCsv(body);
  const parsed: any = JSON.parse(body);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.candles) ? parsed.candles : Array.isArray(parsed.data) ? parsed.data : null;
  if (!rows) throw new Error(`R2 file ${key} must contain an array of OHLC candles.`);
  const { candles, invalidRows } = normalizeCandles(rows);
  if (invalidRows) throw new Error(`R2 file ${key} contains invalid OHLC candles.`);
  return candles;
}

function keyTimeframe(key: string): MarketTimeframe | null {
  const match = key.toLowerCase().match(/(?:^|[._/-])(m1|m5|m15|m30|h1|h4|d1|1m|5m|15m|30m|1h|4h|1d)(?=$|[._/-])/);
  if (!match) return null;
  const token = match[1];
  return ({ '1m': 'm1', '5m': 'm5', '15m': 'm15', '30m': 'm30', '1h': 'h1', '4h': 'h4', '1d': 'd1' } as Record<string, MarketTimeframe>)[token] ?? token as MarketTimeframe;
}

function medianCandleSpacing(candles: MarketCandle[]): number | null {
  if (candles.length < 5) return null;
  const deltas: number[] = [];
  const stride = Math.max(1, Math.floor((candles.length - 1) / 2048));
  for (let index = 1; index < candles.length; index += stride) {
    const delta = candles[index].time - candles[index - 1].time;
    if (delta > 0) deltas.push(delta);
  }
  if (!deltas.length) return null;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

async function readXauusdFiles(timeframe: MarketTimeframe): Promise<MarketCandle[]> {
  const keys = (await listR2Objects('xauusd/', 5000)).filter(key => /\.(csv|json|txt)$/i.test(key));
  const tagged = keys.flatMap(key => {
    const sourceTimeframe = keyTimeframe(key);
    return sourceTimeframe ? [{ key, sourceTimeframe }] : [];
  });
  const exact = tagged.filter(item => item.sourceTimeframe === timeframe);
  const finer = tagged.filter(item => intervalMs[item.sourceTimeframe] < intervalMs[timeframe]);
  // Untagged data is accepted only when it is already at the requested interval.
  // Never turn M1 observations into apparent H1 bars: backtest results must use
  // the actual stored timeframe and must not silently invent aggregate candles.
  const untagged = keys.filter(key => keyTimeframe(key) === null);
  const candidates = [...exact.map(item => item.key), ...untagged];
  if (!candidates.length && finer.length) {
    throw new Error(`XAUUSD R2 history is available at ${[...new Set(finer.map(item => item.sourceTimeframe))].join(', ')} only; choose one of those stored timeframes. The app will not aggregate candles.`);
  }
  if (!candidates.length) return [];
  const all: MarketCandle[] = [];
  let totalBytes = 0;
  const targetSeconds = intervalMs[timeframe] / 1000;
  for (const key of candidates) {
    const body = await readR2Object(key);
    if (!body) continue;
    totalBytes += Buffer.byteLength(body);
    if (totalBytes > 50_000_000) throw new Error('XAUUSD R2 data exceeds the 50 MB backtest read limit. Split the history into smaller timeframe files.');
    try {
      const parsed = parseR2CandleFile(key, body);
      const observedSeconds = medianCandleSpacing(parsed);
      if (observedSeconds !== null && (observedSeconds < targetSeconds * 0.75 || observedSeconds > targetSeconds * 1.5)) {
        if (keyTimeframe(key)) throw new Error(`R2 file ${key} is tagged ${timeframe}, but its candle spacing does not match.`);
        continue;
      }
      for (const candle of parsed) all.push(candle);
    }
    catch (error) {
      if (keyTimeframe(key)) throw error;
      // Ignore sibling metadata and unsupported files when the folder also has valid price data.
    }
  }
  const byTime = new Map<number, MarketCandle>();
  for (const candle of all) {
    const previous = byTime.get(candle.time);
    if (previous && !sameOhlc(previous, candle)) throw new Error(`XAUUSD R2 files contain conflicting prices at ${new Date(candle.time * 1000).toISOString()}. Separate or correct the overlapping files.`);
    byTime.set(candle.time, candle);
  }
  const unique = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (unique.length < 2) return unique;
  const medianSeconds = medianCandleSpacing(unique);
  if (medianSeconds === null) return unique;
  if (medianSeconds > targetSeconds * 1.5) {
    throw new Error(`XAUUSD R2 history is coarser than ${timeframe}; the app will not fabricate candles.`);
  }
  if (medianSeconds < targetSeconds * 0.75) {
    throw new Error(`XAUUSD R2 history is finer than ${timeframe}; choose the stored ${finer[0]?.sourceTimeframe ?? 'source'} timeframe instead. The app will not aggregate candles.`);
  }
  return unique;
}

type AvailableMarket = { asset: MarketAsset; timeframes: MarketTimeframe[]; dates: string[] };
async function getR2Availability(): Promise<AvailableMarket[]> {
  const byAsset = new Map<MarketAsset, Map<MarketTimeframe, Set<string>>>();
  const add = (asset: MarketAsset, timeframe: MarketTimeframe, date: string) => {
    const byTimeframe = byAsset.get(asset) ?? new Map<MarketTimeframe, Set<string>>();
    const dates = byTimeframe.get(timeframe) ?? new Set<string>();
    dates.add(date);
    byTimeframe.set(timeframe, dates);
    byAsset.set(asset, byTimeframe);
  };
  const keys = await listR2Objects('market-data/v1/', 5000);
  for (const key of keys) {
    const match = key.match(/^market-data\/v1\/([A-Z]+)\/(m1|m5|m15|m30|h1|h4|d1)\/(\d{4}-\d{2}-\d{2})\.json$/);
    if (match && isAsset(match[1]) && isTimeframe(match[2])) add(match[1], match[2], match[3]);
  }
  const xauusdKeys = (await listR2Objects('xauusd/', 5000)).filter(key => /\.(csv|json|txt)$/i.test(key));
  const taggedXauusd = xauusdKeys.flatMap(key => {
    const timeframe = keyTimeframe(key);
    return timeframe ? [{ key, timeframe }] : [];
  });
  const xauusdTimeframes = [...new Set(taggedXauusd.map(item => item.timeframe))];
  // Keep the current untagged M1 files visible when newer tagged timeframes
  // are added to the folder later.
  if (xauusdKeys.some(key => keyTimeframe(key) === null) && !xauusdTimeframes.includes('m1')) {
    try {
      const m1Candles = await readXauusdFiles('m1');
      if (m1Candles.length) for (const candle of m1Candles) add('XAUUSD', 'm1', utcDateKey(candle.time));
    } catch (error) {
      if (!xauusdTimeframes.length) throw error;
    }
  }
  for (const timeframe of xauusdTimeframes) {
    const candles = await readXauusdFiles(timeframe);
    for (const candle of candles) add('XAUUSD', timeframe, utcDateKey(candle.time));
  }
  return [...byAsset.entries()].map(([asset, timeframes]) => {
    const datesByTimeframe = Object.fromEntries([...timeframes.entries()].map(([timeframe, values]) => [timeframe, [...values].sort()]));
    const dates = [...new Set(Object.values(datesByTimeframe).flat())].sort();
    return { asset, timeframes: [...timeframes.keys()], dates, datesByTimeframe };
  }).filter(market => market.dates.length > 0).sort((a, b) => a.asset.localeCompare(b.asset));
}

function friendlyR2Error(error: unknown): string {
  const describe = (value: any): string => [value?.name, value?.message, value?.code, ...(Array.isArray(value?.errors) ? value.errors.map(describe) : []), value?.cause ? describe(value.cause) : ''].filter(Boolean).join(' ');
  const message = describe(error) || String(error);
  if (/TimeoutError|ETIMEDOUT|ENETUNREACH|ECONNRESET|ECONNREFUSED/i.test(message)) {
    return 'Cannot reach Cloudflare R2 over HTTPS (port 443). Check this computer’s internet connection, firewall, or network restrictions, then retry.';
  }
  return error instanceof Error ? error.message : 'Unknown R2 error.';
}

app.get('/api/health', (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.OPENROUTER_API_KEY) }));
// New provider endpoints are separate until the live runtime and workspace
// are migrated together. No credentials are needed for these public calls.
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
app.get('/api/r2/status', async (_req, res) => {
  if (!getR2Config()) return res.json({ configured: false, connected: false, mode: 'private-s3-compatible' });
  try {
    const markets = await getR2Availability();
    return res.json({ configured: true, connected: true, mode: 'private-s3-compatible', markets });
  } catch (error) {
    return res.status(502).json({ configured: true, connected: false, mode: 'private-s3-compatible', error: friendlyR2Error(error) });
  }
});
app.get('/api/market-data/availability', async (_req, res) => {
  if (!getR2Config()) return res.status(503).json({ error: 'R2 is not configured. Add the R2 credentials and bucket to .env.' });
  try { return res.json({ markets: await getR2Availability() }); }
  catch (error) { return res.status(502).json({ error: friendlyR2Error(error) }); }
});
app.get('/api/assets', (_req, res) => res.json([...assets]));

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

const openRouterAccounts = new OpenRouterAccounts({read:readR2Object,write:writeR2Object,remove:deleteR2Object});
openRouterRoutes(app,openRouterAccounts,firebaseUidOrReply);
const economy=new BotEconomy(marketplace.store,{read:readR2Object,write:writeR2Object,root:userBotRoot},marketplace);
valrAccountRoutes(app,{ uid:firebaseUidOrReply, read:readR2Object, write:writeR2Object, remove:deleteR2Object });
valrPaperRoutes(app,{uid:firebaseUidOrReply,bot:async(uid,id)=>{
  const [bot,raw]=await Promise.all([marketplace.store.get(`users/${uid}/bots/${id}`),readR2Object(`${userBotRoot(uid,id)}/current.json`)]);
  if(!bot||!raw)return null;const saved=JSON.parse(raw);
  if(saved.userId!==uid||saved.botId!==id||typeof saved.code!=='string'||typeof bot.asset!=='string')return null;
  return {asset:bot.asset,code:saved.code};
}});
economyRoutes(app,economy,async(req,res)=>{const uid=await firebaseUidOrReply(req,res);return uid?res.locals.identity:null;});
const publications = sharedBotRoutes(app, { read: readR2Object, write: writeR2Object, remove: deleteR2Object, uid: firebaseUidOrReply, root: userBotRoot,...(FirestoreStore.configured()?{onPublish:(bot:any)=>economy.legacyPublish(bot),onAcquire:async(uid:string,id:string,bot:any)=>{if(!await marketplace.store.get(`marketplaceBots/${id}`))await marketplace.publish(bot);return economy.legacyCopy(uid,bot)},onUnpublish:(uid:string,id:string)=>marketplace.unpublish(uid,id),onView:(bot:any,visitor:string)=>marketplace.view(bot,visitor)}:{}) });
if(process.env.ENABLE_LEGACY_CTRADER==='true')ctraderRoutes(app, { ...(process.env.CTRADER_GATEWAY_URL?{saveTokens:async(uid:string,tokens:any)=>{await gatewayRequest('authorizeTokens',{uid,tokens})}}:{}),read: readR2Object, write: writeR2Object, uid: firebaseUidOrReply,...(FirestoreStore.configured()?{onAuthorized:async(uid:string)=>{await marketplace.emergencyPause(uid,'Broker authorization changed');await marketplace.store.put(`brokerConnections/${Buffer.from(uid).toString('base64url')}`,{uid,connected:false,emergencyPaused:true,updatedAt:Date.now()})}}:{}) });
marketplaceRoutes(app,{uid:firebaseUidOrReply,read:readR2Object,write:writeR2Object,root:userBotRoot,gateway:gatewayRequest,gatewayHealth,checkLicense:(uid,botId,code)=>economy.checkDeployment(uid,botId,code),ensureMember:(uid,botId,req)=>economy.ensureMember((req as any).verifiedIdentity,botId),versionSource:(uid,versionId)=>economy.source(uid,versionId)});
if(process.env.ENABLE_LEGACY_CTRADER==='true')brokerRoutes(app,{uid:firebaseUidOrReply,tokens:new BrokerTokenStore({read:readR2Object,write:writeR2Object}),remove:deleteR2Object});

app.put('/api/user-bots/:botId/current', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  const { code } = req.body ?? {};
  if (!validBotId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
  if (typeof code !== 'string' || !code.trim() || code.length > 180_000) return res.status(400).json({ error: 'Robot code must be between 1 and 180,000 characters.' });
  if (!getR2Config()) return res.status(503).json({ error: 'Robot storage is not configured on the server.' });
  try { await assertProjectEditable(marketplace,readR2Object,userBotRoot,uid,botId); } catch(error) { return res.status(409).json({error:error instanceof Error?error.message:'Cannot verify robot state.'}); }
  const storageKey = `${userBotRoot(uid, botId)}/current.json`;
  try {
    await writeR2Object(storageKey, JSON.stringify({ schemaVersion: 1, userId: uid, botId, code, updatedAt: new Date().toISOString() }));
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
  try { await assertProjectEditable(marketplace,readR2Object,userBotRoot,uid,botId); } catch(error) { return res.status(409).json({error:error instanceof Error?error.message:'Cannot verify robot state.'}); }
  try {
    const prefix = `${userBotRoot(uid, botId)}/`;
    const keys = await listR2Objects(prefix, 1001);
    if (keys.length > 1000) return res.status(409).json({ error: 'This robot has too many stored versions to delete safely. Contact support.' });
    await publications.removePublication(uid, botId);
    for (let i = 0; i < keys.length; i += 10) await Promise.all(keys.slice(i, i + 10).map(deleteR2Object));
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Robot deletion failed', { botId, error });
    return res.status(502).json({ error: 'Could not delete all robot files. Retry the deletion.' });
  }
});

app.put('/api/user-bots/:botId/backtest', async (req, res) => {
  const uid = await firebaseUidOrReply(req, res); if (!uid) return;
  const { botId } = req.params;
  const state = req.body;
  if (!validBotId(botId)) return res.status(400).json({ error: 'Robot ID is invalid.' });
  if (!state || typeof state !== 'object' || !state.result || !Array.isArray(state.result.candles) || !Array.isArray(state.result.trades) || !Array.isArray(state.logs)) {
    return res.status(400).json({ error: 'The completed backtest data is incomplete.' });
  }
  try { await assertProjectEditable(marketplace,readR2Object,userBotRoot,uid,botId); } catch(error) { return res.status(409).json({error:error instanceof Error?error.message:'Cannot verify robot state.'}); }
  const serialized = JSON.stringify({ ...state, schemaVersion: 1, userId: uid, botId, savedAt: new Date().toISOString() });
  if (Buffer.byteLength(serialized, 'utf8') > 9_000_000) return res.status(413).json({ error: 'This backtest is too large to sync. Shorten the date range and run it again.' });
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
    if (stored.userId !== uid || stored.botId !== botId || !stored.result || !Array.isArray(stored.result.candles) || !Array.isArray(stored.result.trades)) {
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
  try { await assertProjectEditable(marketplace,readR2Object,userBotRoot,uid,botId); } catch(error) { return res.status(409).json({error:error instanceof Error?error.message:'Cannot verify robot state.'}); }
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

async function xauusdAiContext(): Promise<string> {
  if (!getR2Config()) return 'XAUUSD R2 price context: R2 is not configured; no bucket prices were supplied.';
  try {
    const keys = await listR2Objects('xauusd/', 1000);
    const dataKeys = keys.filter(key => /\.(csv|json|txt)$/i.test(key)).slice(-12);
    if (!dataKeys.length) return 'XAUUSD R2 price context: no CSV, JSON, or TXT data files were found under xauusd/. Do not invent or imply you used those prices.';
    const all = [] as MarketCandle[];
    const files: string[] = [];
    let bytes = 0;
    for (const key of dataKeys) {
      if (bytes >= 6_000_000) break;
      const body = await readR2Object(key);
      if (!body) continue;
      bytes += body.length;
      try {
        let rows: unknown[];
        if (/\.csv$/i.test(key) || /\.txt$/i.test(key)) rows = parseCandleCsv(body);
        else {
          const parsed: any = JSON.parse(body);
          const raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed.candles) ? parsed.candles : Array.isArray(parsed.data) ? parsed.data : null;
          if (!raw) continue;
          rows = normalizeCandles(raw).candles;
        }
        const candles = normalizeCandles(rows).candles;
        if (candles.length) { for (const candle of candles) all.push(candle); files.push(`${key} (${candles.length} candles)`); }
      } catch { /* A malformed sibling file should not hide valid market data. */ }
    }
    const byTime = new Map<number, MarketCandle>();
    for (const candle of all) {
      const previous = byTime.get(candle.time);
      if (previous && !sameOhlc(previous, candle)) throw new Error(`conflicting prices at ${new Date(candle.time * 1000).toISOString()}`);
      byTime.set(candle.time, candle);
    }
    const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
    if (!candles.length) return `XAUUSD R2 price context: found ${dataKeys.length} data files under xauusd/, but none had readable OHLC candles. Do not invent or imply you used those prices.`;
    const sample = candles.slice(-160).map(c => `${new Date(c.time * 1000).toISOString()},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join('\n');
    return `XAUUSD R2 price context (actual stored prices; use these to ground XAUUSD price levels, and never substitute example/current prices):\nFiles: ${files.join('; ')}\nCoverage: ${new Date(candles[0].time * 1000).toISOString()} through ${new Date(candles.at(-1)!.time * 1000).toISOString()} (${candles.length} unique candles).\nLast ${Math.min(160, candles.length)} candles, CSV columns time,open,high,low,close,volume:\n${sample}`;
  } catch (error) {
    return `XAUUSD R2 price context unavailable: ${error instanceof Error ? error.message : 'R2 listing/read failed'}. Do not invent or imply you used those prices.`;
  }
}

app.post('/api/market-data/import', async (req, res) => {
  try {
    // Imports overwrite shared historical prices. Only explicitly approved accounts may write them.
    const allowed = (process.env.MARKET_DATA_IMPORT_UIDS || '').split(',').map(uid => uid.trim()).filter(Boolean);
    if (!allowed.length) return res.status(503).json({ error: 'Market data imports are disabled. Configure MARKET_DATA_IMPORT_UIDS on the API server.' });
    const uid = await firebaseUidOrReply(req, res); if (!uid) return;
    if (!allowed.includes(uid)) return res.status(403).json({ error: 'This account cannot import shared market data.' });
    const { asset, timeframe, csv } = req.body ?? {};
    if (!isAsset(asset)) return res.status(400).json({ error: 'Choose a supported instrument before importing.' });
    if (!isTimeframe(timeframe)) return res.status(400).json({ error: 'Choose a supported timeframe before importing.' });
    if (typeof csv !== 'string' || !csv.trim()) return res.status(400).json({ error: 'Choose a non-empty CSV file.' });
    if (!getR2Config()) return res.status(503).json({ error: 'R2 credentials are incomplete. Add the account ID, access key, secret key, and bucket to .env.' });

    const candles = parseCandleCsv(csv);
    if (candles.length > 100_000) return res.status(413).json({ error: 'Import is limited to 100,000 candles per file.' });
    if (candles.at(-1)!.time > Math.floor(Date.now() / 1000)) return res.status(400).json({ error: 'CSV contains future candle timestamps. Check that the source times are UTC.' });
    const grouped = new Map<string, MarketCandle[]>();
    for (const candle of candles) {
      const date = utcDateKey(candle.time);
      const day = grouped.get(date) ?? [];
      day.push(candle);
      grouped.set(date, day);
    }
    const days = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [date, rows] of days) {
      const body = JSON.stringify(storedDay(asset, timeframe, date, rows));
      await writeR2Object(candleObjectKey(asset, timeframe, date), body);
      const check = await readMarketDay(asset, timeframe, date);
      if (!check || JSON.stringify(check) !== JSON.stringify(rows)) {
        throw new Error(`R2 read-back verification failed for ${asset} ${timeframe} ${date}.`);
      }
    }
    return res.json({ asset, timeframe, source: 'R2', verified: true, candles: candles.length, days: days.map(([date, rows]) => ({ date, candles: rows.length })), from: utcDateKey(candles[0].time), to: utcDateKey(candles.at(-1)!.time) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown R2 import error.';
    console.error('R2 market-data import failed', message);
    return res.status(502).json({ error: `Market data was not imported: ${message}` });
  }
});

app.post('/api/market-data', async (req, res) => {
  try {
    const { asset, timeframe, from, to } = req.body ?? {};
    if (!isAsset(asset)) return res.status(400).json({ error: 'Unsupported instrument.' });
    if (!isTimeframe(timeframe)) return res.status(400).json({ error: 'Unsupported timeframe.' });
    if (!getR2Config()) return res.status(503).json({ error: 'R2 is not configured. Add the R2 credentials and bucket to .env.' });

    const start = new Date(from);
    let end = new Date(to);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      return res.status(400).json({ error: 'Choose a valid UTC date range.' });
    }
    const now = Date.now();
    if (end.getTime() > now) end = new Date(now); // The UI sends an inclusive end-of-day timestamp for today.
    if (start >= end) return res.status(400).json({ error: 'The start date must be before the latest available data.' });
    if (end.getTime() - start.getTime() > 366 * 86_400_000) {
      return res.status(400).json({ error: 'Date range is limited to one year per request.' });
    }
    const interval = intervalMs[timeframe];
    const estimatedCandles = Math.ceil((end.getTime() - start.getTime()) / interval) + 500;
    if (estimatedCandles > 50_000) {
      return res.status(413).json({ error: 'This date range may exceed 50,000 candles. Choose a shorter range or slower timeframe.' });
    }

    const storedPrefix = `market-data/v1/${asset}/${timeframe}/`;
    const fromDate = start.toISOString().slice(0, 10);
    const toDate = end.toISOString().slice(0, 10);
    const dates = (await listR2Objects(storedPrefix, 10_000))
      .map(key => key.match(/^market-data\/v1\/[A-Z]+\/(?:m1|m5|m15|m30|h1|h4|d1)\/(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
      .filter((date): date is string => Boolean(date && date >= fromDate && date <= toDate));
    const dayRows = await mapConcurrent(dates, 4, async date => [date, await readMarketDay(asset, timeframe, date)] as const);
    const stored = dayRows.flatMap(([, rows]) => rows ?? []);
    const folderCandles = asset === 'XAUUSD' ? await readXauusdFiles(timeframe) : [];
    const candleMap = new Map<number, MarketCandle>();
    for (const group of [stored, folderCandles]) {
      for (const candle of group) {
        const previous = candleMap.get(candle.time);
        if (previous && !sameOhlc(previous, candle)) throw new Error(`${asset} ${timeframe} has conflicting R2 prices at ${new Date(candle.time * 1000).toISOString()}. Check overlapping stored files.`);
        candleMap.set(candle.time, candle);
      }
    }
    const candles = [...candleMap.values()].filter(c => c.time * 1000 >= start.getTime() && c.time * 1000 <= end.getTime()).sort((a, b) => a.time - b.time);
    if (candles.length > 50_000) return res.status(413).json({ error: 'R2 returned more than 50,000 candles. Choose a shorter range or slower timeframe.' });
    if (!candles.length) {
      const available = asset === 'XAUUSD' ? 'XAUUSD source files must contain CSV, JSON, or TXT OHLC candles under the bucket’s xauusd/ prefix.' : 'Import the requested instrument and timeframe in the Chart view first.';
      return res.status(404).json({ error: `No ${asset} ${timeframe} candles were found in R2 for ${start.toISOString().slice(0, 10)} through ${end.toISOString().slice(0, 10)}. ${available}` });
    }
    const observedGaps = countObservedGaps(candles, timeframe);

    return res.json({
      candles,
      source: 'R2',
      invalidRows: 0,
      duplicateRows: 0,
      observedGaps,
      requested: { from: start.toISOString(), to: end.toISOString() },
    });
  } catch (error) {
    console.error('R2 market-data request failed', error);
    return res.status(502).json({ error: `R2 market-data request failed: ${friendlyR2Error(error)}` });
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
  const apiKey = personalAI?.apiKey || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return res.status(503).json({ error: 'Connect your OpenRouter API key to enable AI.' });
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 24
    || messages.some((m: any) => !m || !['system', 'user', 'assistant'].includes(m.role)
      || typeof m.content !== 'string' || m.content.length > 80_000)) {
    return res.status(400).json({ error: 'Send 1–24 chat messages with supported roles and text content under 80 KB each.' });
  }
  const selectedAsset = req.body?.asset;
  if (selectedAsset !== undefined && (typeof selectedAsset !== 'string' || !/^[A-Z0-9]{3,30}$/.test(selectedAsset))) return res.status(400).json({ error: 'Choose a supported instrument for AI context.' });
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
    let marketContext = '';
    if (selectedAsset === 'XAUUSD' && req.body?.includeMarketContext === true) {
      let contextTimer: ReturnType<typeof setTimeout> | undefined;
      marketContext = await Promise.race([
        xauusdAiContext(),
        new Promise<string>(resolve => { contextTimer = setTimeout(() => resolve('Historical XAUUSD prices could not be loaded in time. Do not invent or imply you used those prices.'), 5_000); }),
      ]);
      if (contextTimer) clearTimeout(contextTimer);
    }
    const enrichedMessages = selectedAsset === 'XAUUSD' && req.body?.includeMarketContext === true
      ? [{ role: 'system', content: `Use the following available historical price data when writing XAUUSD code. Treat it as historical reference; code must still operate on runtime ctx candles, never hard-code a guessed live price.\n\n${marketContext}` }, ...messages]
      : messages;
    const requestModel = (targetModel: string) => requestOpenRouter(
      JSON.stringify({ model: targetModel, messages: enrichedMessages, temperature: 0.2, max_tokens: maxTokens, stream: true,stream_options:{include_usage:true} }),
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
