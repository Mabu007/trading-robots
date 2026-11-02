// Explicit operator deployment command. Never invoked by the normal app build.
// Credentials remain inside the Vercel build process and are sent only to Cloudflare.
import { spawnSync } from 'node:child_process';
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const secret = process.env.PROPDAO_LIVE_INTERNAL_SECRET;
if (!token || !/^[a-f0-9]{32}$/.test(account || '') || !secret || secret.length < 32) {
  throw new Error('Cloudflare deployment credentials or runtime secret are missing/invalid');
}
if (process.env.PROPDAO_LIVE_ENABLED !== 'false') throw new Error('Deployment requires disabled execution');
const headers = { Authorization: `Bearer ${token}` };
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts`, { headers });
const body = await response.json();
if (!response.ok || !body.success) {
  throw new Error(`Cloudflare Workers access rejected (HTTP ${response.status}; codes ${(body.errors || []).map(e => e.code).join(',')}). Check token Workers Scripts permissions and account scope.`);
}
console.log('Cloudflare Workers account access verified');
function run(args, input) {
  const result = spawnSync('npx', ['--no-install', 'wrangler', ...args], {
    encoding: 'utf8', input, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  // Redact secrets even if an upstream CLI unexpectedly echoes them.
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  console.log(output.replaceAll(token, '[redacted]').replaceAll(secret, '[redacted]'));
  if (result.status !== 0) throw new Error('Cloudflare deployment command failed');
  return output;
}
const config = ['--config', 'workers/wrangler.propdao-live.jsonc'];
const output = run(['deploy', ...config]);
const url = output.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/)?.[0];
if (!url) throw new Error('No deployed Worker URL returned');
run(['secret', 'put', 'PROPDAO_LIVE_INTERNAL_SECRET', ...config], secret);
const health = `${url}/health`;
const unauthorized = await fetch(health);
if (unauthorized.status !== 401) throw new Error('Unauthenticated Worker request was not rejected');
const authenticated = await fetch(health, { headers: { Authorization: `Bearer ${secret}` } });
const state = await authenticated.json();
if (!authenticated.ok || state.runtime !== 'propdao-durable-object' || state.ready !== false) throw new Error('Worker health or disabled gate verification failed');
console.log(`PROPDAO_WORKER_URL=${url}`);
console.log('Verified authenticated health, unauthorized rejection, and disabled order submission');
