#!/usr/bin/env node
/**
 * Trading Vibes production beta: read-only release smoke.
 * This does not authenticate users or verify broker/Firestore/R2 workflows.
 */
const origin = process.env.TV_PRODUCTION_URL || 'https://trading-robots.vercel.app';
const timeoutMs = Number(process.env.TV_SMOKE_TIMEOUT_MS || 12000);
let base;
try {
  base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Provide a plain HTTPS origin');
  }
} catch (error) {
  console.error('Invalid TV_PRODUCTION_URL:', error.message);
  process.exit(2);
}
const report = {
  kind: 'production-beta-read-only-smoke',
  origin: base.origin,
  checkedAt: new Date().toISOString(),
  checks: [],
  limitations: ['No authenticated browser journey', 'No Firestore/R2 writes', 'No broker/Worker order verification'],
};
async function check(name, path, expectedStatus, options = {}, verify = async () => {}) {
  try {
    const response = await fetch(new URL(path, base), {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'accept': 'application/json,text/html,*/*', ...(options.headers || {}) }
    });
    if (response.status !== expectedStatus) {
      throw new Error('Expected HTTP ' + expectedStatus + ', received ' + response.status);
    }
    await verify(response);
    report.checks.push({ name, path, status: response.status, passed: true });
    return response;
  } catch (error) {
    report.checks.push({ name, path, passed: false, reason: String(error.message || error).slice(0, 300) });
    return null;
  }
}
let asset = '';
await check('landing', '/', 200, {}, async (response) => {
  if (!(response.headers.get('content-type') || '').includes('text/html')) throw new Error('Expected HTML');
  const html = await response.text();
  if (!html.includes('id="root"') || !html.toLowerCase().includes('trading vibes')) {
    throw new Error('Missing application root/title');
  }
  asset = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1] || '';
  if (!asset.startsWith('/assets/')) throw new Error('Missing versioned JS entry asset');
});
if (asset) await check('versioned_frontend_bundle', asset, 200, {}, async r => {
  if (!(r.headers.get('content-type') || '').includes('javascript')) throw new Error('Expected JavaScript');
  if ((await r.text()).length < 1000) throw new Error('Asset unexpectedly empty');
});
await check('server_health', '/api/health', 200, {}, async r => {
  const body = await r.json();
  if (body.ok !== true || body.firebase?.clientConfigured !== true || body.firebase?.serverConfigured !== true) {
    throw new Error('Expected healthy Firebase configuration indicators');
  }
  if (body.ai?.sharedFallbackEnabled !== false) throw new Error('Shared model fallback unexpectedly enabled');
});
await check('agents_requires_auth', '/api/agents', 401);
await check('capabilities_requires_auth', '/api/agent/capabilities', 401);
await check('sdk_stream_requires_auth', '/api/ai-sdk/stream', 401, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] })
});
report.passed = report.checks.every(x => x.passed);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

