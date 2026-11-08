import {expect,it} from 'vitest';
import {validateAIMessageBudget as check} from './ai-message-limits.ts';
it('accepts a 200K saved strategy source plus an audit snapshot',()=>{
 expect(check([{role:'system',content:'x'.repeat(215000)},{role:'user',content:'y'.repeat(229000)}],true)).toBeNull();
});
it('prevents oversized data, too many turns, unsupported roles and excessive total size',()=>{
 expect(check([{role:'user',content:'x'.repeat(90000)}],false)).toContain('80,000');
 expect(check([{role:'system',content:'x'.repeat(241000)}],false)).toContain('240,000');
 expect(check([{role:'system',content:'x'.repeat(235000)},{role:'user',content:'y'.repeat(265000)}],true)).toContain('460,000');
 expect(check([{role:'tool',content:'unsafe'}],true)).toContain('supported');
 expect(check(Array.from({length:25},()=>({role:'user',content:'hello'})),false)).toContain('1–24');
});
