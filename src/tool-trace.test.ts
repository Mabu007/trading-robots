import {it,expect} from 'vitest';
import {updateToolTrace} from './tool-trace';
it('records bounded tool progress and completed output without treating it as authorization',()=>{
 const a=updateToolTrace([],{type:'tool-call',toolCallId:'c1',toolName:'getSavedBacktest',input:{botId:'bot-1'}});
 expect(a).toMatchObject([{id:'c1',state:'requested',name:'getSavedBacktest'}]);
 const b=updateToolTrace(a,{type:'tool-result',toolCallId:'c1',output:{available:true,kind:'simulation'}});
 expect(b[0]).toMatchObject({state:'completed',output:{available:true,kind:'simulation'}});
 const huge=updateToolTrace(a,{type:'tool-result',toolCallId:'c1',output:'x'.repeat(16001)});
 expect(huge[0]).toMatchObject({state:'completed',outputTruncated:true});expect(huge[0].output).toBeUndefined();
 expect(updateToolTrace(a,{type:'tool-result',toolCallId:'unknown',output:'x'})).toEqual(a);
});
