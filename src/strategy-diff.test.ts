import {expect,it} from 'vitest';
import {strategyDiff} from './strategy-diff';
it('shows removed and added code without treating unchanged context as a modification',()=>{
 const original=Array.from({length:20},(_,i)=>'line '+i).join('\n');
 const revised=original.replace('line 10','new condition');
 const diff=strategyDiff(original,revised);
 expect(diff.some(row=>row.kind==='removed'&&row.text==='line 10')).toBe(true);
 expect(diff.some(row=>row.kind==='added'&&row.text==='new condition')).toBe(true);
 expect(diff.filter(row=>row.kind==='skip').length).toBe(2);
});
