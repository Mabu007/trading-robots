// Explicit operator deployment command. Never invoked by the normal app build.
// Credentials remain inside the Vercel build process and are sent only to Cloudflare.
import { spawnSync } from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const secret = process.env.PROPDAO_LIVE_INTERNAL_SECRET;
if (!token || !/^[a-f0-9]{32}$/.test(account || '') || !secret || secret.length < 32) {
  throw new Error('Cloudflare deployment credentials or runtime secret are missing/invalid');
}
// Activate the Worker first while Vercel remains disabled; the provider cannot execute
// until Vercel's separate flag is enabled after health and BOTS checks pass.
const activate = process.env.PROPDAO_WORKER_ACTIVATE === 'true';
if (process.env.PROPDAO_LIVE_ENABLED !== 'false') throw new Error('Worker deployment requires Vercel execution disabled');
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
const wranglerPath='workers/wrangler.propdao-live.jsonc';
if(activate){
 const configObject=JSON.parse(readFileSync(wranglerPath,'utf8'));
 if(configObject.vars?.PROPDAO_LIVE_ENABLED!=='false')throw Error('Worker activation baseline must be disabled in source');
 configObject.vars.PROPDAO_LIVE_ENABLED='true';
 writeFileSync(wranglerPath,JSON.stringify(configObject,null,2)+'\n');
}
const config = ['--config', wranglerPath];
const output = run(['deploy', ...config]);
const url = output.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/)?.[0];
if (!url) throw new Error('No deployed Worker URL returned');
run(['secret', 'put', 'PROPDAO_LIVE_INTERNAL_SECRET', ...config], secret);
const health = `${url}/health`;
async function probe(headers, expectedStatus) {
  for(let attempt=0;attempt<6;attempt++){
    const response=await fetch(health,{headers,signal:AbortSignal.timeout(10000)});
    if(response.status===expectedStatus)return response;
    if(attempt===5)throw new Error(`Worker health HTTP ${response.status}; expected ${expectedStatus}`);
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
}
const unauthorized = await probe({},401);
if (unauthorized.status !== 401) throw new Error('Unauthenticated Worker request was not rejected');
const authenticated = await probe({ Authorization: `Bearer ${secret}` },200);
const state = await authenticated.json();
if (!authenticated.ok || state.runtime !== 'propdao-durable-object' || state.version !== 2 || state.ready !== activate) throw new Error('Worker health or execution gate verification failed');
console.log(`PROPDAO_WORKER_URL=${url}`);
console.log('Verified authenticated health, unauthorized rejection, and Worker enabled gate = '+activate);
// Exercise the actual BOTS binding without a grant, alarm, account, or order.
const probePath = `${url}/live/${'0'.repeat(64)}`;
const probeHeaders = { Authorization: `Bearer ${secret}`, 'X-TV-UID': 'runtime-readiness-probe' };
const status = await fetch(`${probePath}/status`, { headers: probeHeaders });
const statusBody = await status.json();
if (!status.ok || statusBody.running !== false || statusBody.grant !== null) throw new Error('Durable Object status verification failed');
const denied = await fetch(`${probePath}/deploy`, {method:'POST',headers:probeHeaders,body:'{}'});
const deniedBody = await denied.json();
const expectedError=activate?'Invalid or expired deployment':'Live runtime is disabled';
if (denied.status !== 400 || deniedBody.error !== expectedError) throw new Error('Durable Object deployment gate verification failed');
console.log('Verified BOTS binding, empty stopped state, and invalid deployment rejection');
if(activate)console.log('Worker routing is active, but Vercel provider execution remains disabled until separately activated');
