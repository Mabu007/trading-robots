/** Backfill completed UTC days into the existing shared replay cache.
 * Run with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET
 * in the environment: node --import tsx scripts/backfill-gold-history.ts
 * Optional: --from YYYY-MM-DD --through YYYY-MM-DD --report path
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AlertHistory } from '../server/alert-history.ts';
import { getR2Config, readR2Object, writeR2Object } from '../server/r2.ts';

const DAY = 86_400_000;
const options = new Map<string,string>();
for (let i=2; i<process.argv.length; i+=2) {
  const name=process.argv[i], value=process.argv[i+1];
  if (!['--from','--through','--report'].includes(name) || !value || options.has(name)) throw Error('Expected --from, --through or --report followed by a value.');
  options.set(name,value);
}
function parseDay(day:string) {
  const ms=Date.parse(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10)!==day) throw Error(`Invalid UTC date: ${day}`);
  return ms;
}
async function main() {
  if (!getR2Config()) throw Error('R2 credentials are missing. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.');
  const from=parseDay(options.get('--from') || '2022-01-01');
  const latestCompleted=Math.floor(Date.now()/DAY)*DAY-DAY;
  const through=parseDay(options.get('--through') || new Date(latestCompleted).toISOString().slice(0,10));
  if (through<from || through>latestCompleted) throw Error('The range must contain completed UTC days only.');
  const report=options.get('--report') || 'gold-backfill-report.jsonl';
  await mkdir(dirname(report),{recursive:true});
  const history=new AlertHistory({read:readR2Object,write:writeR2Object});
  let failures=0, empty=0, verified=0;
  for (let ms=from;ms<=through;ms+=DAY) {
    const day=new Date(ms).toISOString().slice(0,10);
    let result:Record<string,unknown>|undefined;
    for (let attempt=1;attempt<=3;attempt++) {
      try {
        const data=await history.day(day,'m1');
        if (!data.candles.length) { empty++; result={day,status:'empty-unverified',attempt}; break; }
        const checked=await history.day(day,'m1');
        if (!checked.cached || JSON.stringify(data.candles)!==JSON.stringify(checked.candles)) throw Error('Read-back verification failed');
        if (checked.candles.some(c=>c.time*1000<ms || c.time*1000>=ms+DAY)) throw Error('Candle lies outside the requested UTC day');
        verified++; result={day,status:'verified',candles:checked.candles.length,missingMinutes:checked.missingIntervals,wasCached:data.cached,attempt}; break;
      } catch (error) {
        if (attempt===3) { failures++; result={day,status:'error',error:error instanceof Error?error.message:'Unknown error',attempt}; }
        else await new Promise(resolve=>setTimeout(resolve,1000*2**(attempt-1)));
      }
    }
    await appendFile(report,JSON.stringify(result)+'\n');
    console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({summary:true,from:new Date(from).toISOString().slice(0,10),through:new Date(through).toISOString().slice(0,10),verified,emptyUnverified:empty,failures,report}));
  if (failures || empty) process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Backfill failed');process.exitCode=1;});
