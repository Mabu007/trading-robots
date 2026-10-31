// Local workerd integration test: mock VALR only, no keys and no real orders.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'valr-paper-check-'));
const mock=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Content-Type','application/json');
 if(url.pathname==='/v1/public/pairs')return res.end(JSON.stringify([{symbol:'ETHZAR',active:true,currencyPairType:'SPOT',baseDecimalPlaces:'3',minBaseAmount:'0.01',maxBaseAmount:'100',minQuoteAmount:'10',maxQuoteAmount:'100000'}]));
 if(url.pathname==='/v1/public/ETHZAR/buckets'){
  const from=Number(url.searchParams.get('startTime')),end=Number(url.searchParams.get('endTime')),period=Number(url.searchParams.get('periodSeconds')),rows=[];
  for(let t=from;t<=end;t+=period)rows.push({currencyPairSymbol:'ETHZAR',bucketPeriodInSeconds:period,startTime:new Date(t*1000).toISOString(),open:'100',high:'101',low:'99',close:'100',volume:'1'});
  return res.end(JSON.stringify(rows.reverse()));
 }
 res.statusCode=404;res.end('{}');
});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));const mockUrl=`http://127.0.0.1:${mock.address().port}`;
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const shim=join(dir,'network.cjs');await writeFile(shim,"const os=require('node:os'),original=os.networkInterfaces;os.networkInterfaces=()=>{try{return original()}catch{return {lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]}}};");
const secret='paper-local-fixture',base=`http://127.0.0.1:${port}`,headers={Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
const args=['node_modules/wrangler/wrangler-dist/cli.js','dev','--local','--config','workers/wrangler.local.jsonc','--persist-to',join(dir,'data'),'--port',String(port),'--ip','127.0.0.1','--var','STRATEGY_ISOLATION_VERIFIED:true','--var',`TRADING_INTERNAL_SECRET:${secret}`,'--var',`VALR_TEST_ENDPOINT:${mockUrl}`];
let child,output='';
async function boot(){output='';child=spawn(process.execPath,args,{env:{...process.env,NODE_OPTIONS:`--require=${shim}`,WRANGLER_SEND_METRICS:'false'},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const deadline=Date.now()+45000;while(Date.now()<deadline){if(child.exitCode!==null)throw Error('workerd exited: '+output.slice(-800));try{const r=await fetch(`${base}/paper/fixture/status`,{headers,signal:AbortSignal.timeout(1000)});if(r.status===200||r.status===400)return}catch{}await new Promise(r=>setTimeout(r,200))}throw Error('workerd did not start: '+output.slice(-800))}
async function stopWorker(){const target=child;if(!target||target.exitCode!==null)return;await new Promise(resolve=>{const kill=signal=>{try{if(process.platform!=='win32')process.kill(-target.pid,signal);else target.kill(signal)}catch{}};const timer=setTimeout(()=>{kill('SIGKILL');resolve()},3000);target.once('exit',()=>{clearTimeout(timer);resolve()});kill('SIGTERM')})}
async function call(action,body){const response=await fetch(`${base}/paper/fixture/${action}`,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(`${action}: ${JSON.stringify(data)}`);return data}
try{
 await boot();const unauthorized=await fetch(`${base}/paper/fixture/status`);if(unauthorized.status!==401)throw Error('Unauthenticated runtime access accepted');
 const code='export const config={timeframes:["m1"],executionTimeframe:"m1",riskPercent:1,riskReward:2};export function onCandle(){return {action:"WAIT"}}';
 await call('deploy',{pair:'ETHZAR',code,balance:1000,allocation:1000,riskPercent:1,dailyLossPercent:3});await call('start',{});
 let status;const deadline=Date.now()+30000;while(Date.now()<deadline){status=await call('status');if(status.state.lastCandle||status.lastError)break;await new Promise(r=>setTimeout(r,500))}
 if(!status?.state.lastCandle||status.lastError)throw Error(`Paper alarm did not process a candle: ${status?.lastError||'timeout'}`);
 const blocked=await fetch(`${base}/paper/fixture/reset`,{method:'POST',headers,body:'{}'});if(blocked.status!==400)throw Error('Reset accepted while running');
 await call('stop',{});await stopWorker();await boot();const recovered=await call('status');
 if(recovered.state.running||recovered.nextAlarm!==null||recovered.state.lastCandle!==status.state.lastCandle)throw Error('Paper stop or restart recovery failed');
 const reset=await call('reset',{});if(!reset.archived)throw Error('Paper reset was not archived');await call('deploy',{pair:'ETHZAR',code,balance:1000,allocation:1000,riskPercent:1,dailyLossPercent:3});
 console.log(JSON.stringify({status:'passed',source:'mock VALR',paperOnly:true,candleProcessed:true,stopRecovered:true}));
}catch(error){console.error(output.slice(-900));throw error}finally{await stopWorker();await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true})}
