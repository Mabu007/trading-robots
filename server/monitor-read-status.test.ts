import {it,expect,vi} from 'vitest';
import {readMonitorStatus} from './monitor-read-status.ts';
import type {RecordStore} from './firestore-store.ts';
it('verifies owner pointer and runtime response without leaking runtime credentials',async()=>{
 const get=vi.fn(async(path:string)=>path==='users/alice/codeWatches/analysis-12345678'?{id:'analysis-12345678'}:null);
 const store={get} as unknown as RecordStore;
 const request=vi.fn(async()=>Response.json({running:true,events:[{}],lastCheck:42}));
 const env={CODE_WATCH_ENABLED:'true',CODE_WATCH_RUNTIME_URL:'https://monitor.invalid',CODE_WATCH_INTERNAL_SECRET:'s'.repeat(32)};
 const result=await readMonitorStatus('alice','analysis-12345678',store,request as any,env);
 expect(result).toMatchObject({available:true,verified:true,running:true,eventCount:1});
 expect(JSON.stringify(result)).not.toContain(env.CODE_WATCH_INTERNAL_SECRET);
 expect((await readMonitorStatus('bob','analysis-12345678',store,request as any,env)).available).toBe(false);
 expect(request).toHaveBeenCalledTimes(1);
 expect((await readMonitorStatus('alice','analysis-12345678',store,request as any,{})).verified).toBe(false);
});
