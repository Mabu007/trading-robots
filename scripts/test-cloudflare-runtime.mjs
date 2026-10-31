// Local workerd + local R2 + real alarms. Every broker/control response is a
// fixture. This script cannot reach cTrader or submit a provider order.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const directory=await mkdtemp(join(tmpdir(),'trading-runtime-check-'));
const secret='local-fixture-only-32-character-secret',headers={Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
const signals=[];let egressAttempts=0;
const mock=createServer(async(req,res)=>{try{let input='';for await(const chunk of req)input+=chunk;const body=JSON.parse(input||'{}');res.setHeader('Content-Type','application/json');
 if(req.url==='/egress-probe'){egressAttempts++;return res.end('{"reachable":true}')}
 if(req.url==='/rpc/candles'){const duration={m1:60,m5:300}[body.timeframe];if(!duration)throw Error('Unexpected timeframe');const candles=[];for(let t=body.from;t+duration*1000<=body.to;t+=duration*1000)candles.push({time:t/1000,open:100,high:101,low:99,close:100,volume:1});return res.end(JSON.stringify({candles}))}
 if(req.url==='/api/internal/trading/subscribers')return res.end(JSON.stringify({subscribers:[]}));
 if(req.url==='/api/internal/trading/signal'){signals.push(body.signal);return res.end('{"saved":true}')}
 throw Error('Unexpected external operation in fixture');
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}))}});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));const mockPort=mock.address().port;
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const workerPort=reservation.address().port;await new Promise(r=>reservation.close(r));
// Some hosted containers cannot enumerate network interfaces. This test-only
// shim falls back to loopback; production application code is never patched.
const shim=join(directory,'network.cjs');await writeFile(shim,"const os=require('node:os'),original=os.networkInterfaces;os.networkInterfaces=()=>{try{return original()}catch{return {lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]}}};");
const childEnv={...process.env,NODE_OPTIONS:`--require=${shim}`,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_API_TOKEN:''};
let worker,output='';
async function boot(){output='';worker=spawn(process.execPath,['node_modules/wrangler/wrangler-dist/cli.js','dev','--local','--config','workers/wrangler.local.jsonc','--persist-to',join(directory,'storage'),'--port',String(workerPort),'--ip','127.0.0.1','--var','STRATEGY_ISOLATION_VERIFIED:true','--var',`TRADING_INTERNAL_SECRET:${secret}`,'--var',`CONTROL_API_URL:http://127.0.0.1:${mockPort}`,'--var',`CTRADER_GATEWAY_URL:http://127.0.0.1:${mockPort}`],{env:childEnv,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});worker.stdout.on('data',d=>output+=d);worker.stderr.on('data',d=>output+=d);
 const deadline=Date.now()+45000;while(Date.now()<deadline){if(worker.exitCode!==null)throw Error('workerd exited: '+output.slice(-1000));try{const r=await fetch(`http://127.0.0.1:${workerPort}/bots/local-signal/status`,{headers,signal:AbortSignal.timeout(1000)});if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,200))}throw Error('workerd did not become ready: '+output.slice(-1000))}
async function stopWorker(){const target=worker;if(!target||target.exitCode!==null)return;await new Promise(resolve=>{const kill=signal=>{try{if(process.platform!=='win32')process.kill(-target.pid,signal);else target.kill(signal)}catch{}};const timeout=setTimeout(()=>{kill('SIGKILL');resolve()},3000);target.once('exit',()=>{clearTimeout(timeout);resolve()});kill('SIGTERM')})}
async function call(id,action,body){const response=await fetch(`http://127.0.0.1:${workerPort}/bots/${id}/${action}`,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(4000)});const data=await response.json();if(!response.ok)throw Error(JSON.stringify(data));return data}
const config='export const config={timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2};';
const fixtures=[
 ['local-signal',config+'export function onCandle(){return {action:"BUY",stopLoss:90,takeProfit:120,reason:"Fixture only"}}','success'],
 ['local-empty-env',config+'export function onCandle(){if(typeof process!=="undefined"||typeof require!=="undefined")throw Error("Unexpected host access");return {action:"WAIT"}}','success'],
 ['local-no-network',config+'export function onCandle(){if(typeof fetch!=="undefined")throw Error("Unexpected network access");return {action:"WAIT"}}','success'],
 ...(process.argv.includes('--cpu')?[[ 'local-cpu-limit',config+'export function onCandle(){while(true){}}','blocked']]:[]),
];
try{
 await boot();const unauthorized=await fetch(`http://127.0.0.1:${workerPort}/bots/local-signal/status`);if(unauthorized.status!==401)throw Error('Unauthenticated runtime access was accepted');
 for(const [id,code]of fixtures){await call(id,'deploy',{botId:id,ownerUid:'fixture',code,version:createHash('sha256').update(code).digest('hex'),asset:'XAUUSD',intervalMinutes:1,publicationDelaySeconds:5,sourceUid:'fixture',sourceAccountId:'1',sourceSymbolId:'1'});await call(id,'start',{})}
 const pending=new Map(fixtures.map(f=>[f[0],f[2]])),results={};const deadline=Date.now()+75000;
 while(pending.size&&Date.now()<deadline){for(const [id,expected]of pending){const state=await call(id,'status');if(state.lastSuccessfulEvaluation||state.lastError){if(expected==='success'&&!state.evaluating)throw Error(`${id}: ${state.lastError}`);if(expected==='blocked'&&!state.lastError)throw Error(`${id} was not isolated`);console.log('Alarm checked:',id,expected);results[id]={evaluations:state.evaluations,evaluating:state.evaluating,error:state.lastError};await call(id,'stop',{});pending.delete(id)}}await new Promise(r=>setTimeout(r,500))}
 if(pending.size)throw Error('Alarm verification timed out: '+[...pending.keys()]);
 if(egressAttempts!==0)throw Error('Isolated strategy reached the network');
 if(signals.length!==1)throw Error('Expected exactly one persisted fixture signal');
 await stopWorker();await boot();const recovered=await call('local-signal','status');if(recovered.evaluations!==1||recovered.running||recovered.nextAlarm!==null)throw Error('Persisted stop/state recovery failed');
 console.log(JSON.stringify({status:'passed',environment:'LOCAL ONLY; mock broker; no provider orders',signals:signals.length,egressAttempts,restartRecovered:true,results},null,2));
}catch(error){console.error(output.slice(-1800));throw error}finally{await stopWorker();await new Promise(r=>mock.close(r));await rm(directory,{recursive:true,force:true})}
