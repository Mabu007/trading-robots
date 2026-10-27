import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
it('loads the server with the same native TypeScript stripping used by Vercel Node 24',async()=>{
 const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',"const {default:app}=await import('./server/index.ts');if(typeof app!=='function')throw Error('Express API not initialized');console.log('native-api-ok')"],{cwd:process.cwd(),timeout:5000});expect(result.stdout).toContain('native-api-ok');
});
