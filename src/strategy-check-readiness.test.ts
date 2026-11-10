import {it,expect} from 'vitest';
import {filterReadiness} from './strategy-check-readiness';
it('reports real threshold gaps without inferring missing checks',()=>{
 const x=filterReadiness([{name:'ATR minimum',passed:false,actual:.6,threshold:.8,operator:'>=',unit:'price'},{name:'EMA alignment',passed:true},{name:'Sweep',passed:false}]);
 expect(x).toMatchObject({reported:true,passed:1,failed:2,reportedCount:3});
 expect(x.checks[0].gap).toBeCloseTo(.2);expect(x.checks[0].progressPercent).toBeCloseTo(75);
 expect(x.checks[2].gap).toBeNull();
});
it('does not invent a failed condition',()=>{expect(filterReadiness([])).toMatchObject({reported:false,failed:0,checks:[]})});
