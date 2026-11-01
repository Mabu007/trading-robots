import {afterAll,beforeAll,expect,it} from 'vitest';
import type {Server} from 'node:http';
import app from './index';
let server:Server,base:string;
beforeAll(async()=>{await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve())});base=`http://127.0.0.1:${(server.address() as {port:number}).port}`});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()))});
it('does not expose the removed non-VALR market data endpoints',async()=>{
 for(const [method,path] of [['GET','/api/assets'],['GET','/api/market-data/availability'],['GET','/api/r2/status'],['POST','/api/market-data'],['POST','/api/market-data/import'],['GET','/api/brokers/ctrader/status'],['POST','/api/brokers/ctrader/connect'],['GET','/api/brokers/ctrader/accounts']]){
  expect((await fetch(base+path,{method})).status).toBe(404);
 }
});
