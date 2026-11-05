import {defineConfig,mergeConfig} from 'vite';
import base from '../vite.config';
import {resolve} from 'node:path';
export default defineConfig(async env=>{
 if(env.command!=='serve')throw Error('UI fixtures cannot be built for deployment.');
 const config=typeof base==='function'?await base(env):base;
 return mergeConfig(config,{plugins:[{name:'isolated-ui-fixture',enforce:'pre',resolveId(source:string){if(/(?:^|\/)firebase$/.test(source))return resolve('qa/firebase-fixture.ts')},transform(code:string,id:string){if(id.endsWith('/src/main.tsx'))return {code:"import '/qa/network-fixture.ts';\n"+code,map:null}}}]});
});
