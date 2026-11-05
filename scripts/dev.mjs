import 'dotenv/config';
import {readFileSync} from 'node:fs';
const fixture=(()=>{try{return readFileSync('.env.local','utf8').includes('TV_UI_SMOKE=1')}catch{return false}})();
import {spawn} from 'node:child_process';
// Forward preview host/port arguments to Vite, not to the process supervisor.
const children=[spawn(process.execPath,['--import','tsx','server/local.ts'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','0.0.0.0',...(fixture?['--config','qa/vite.config.ts']:[]),...process.argv.slice(2)],{stdio:'inherit'})];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');process.exitCode=code}
for(const child of children){child.on('exit',code=>stop(code||0));child.on('error',()=>stop(1))}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
