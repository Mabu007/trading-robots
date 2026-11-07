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
    return ¶»§q«^