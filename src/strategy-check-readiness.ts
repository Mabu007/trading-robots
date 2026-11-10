/** The only authoritative live filter readings are those emitted by the strategy. */
export function filterReadiness(input:unknown){
 const checks=(Array.isArray(input)?input:[]).slice(0,16).filter(c=>c&&typeof c.name==='string'&&c.name.trim()).map(c=>{
  const actual=typeof c.actual==='number'&&Number.isFinite(c.actual)?c.actual:null;
  const threshold=typeof c.threshold==='number'&&Number.isFinite(c.threshold)?c.threshold:null;
  const operator=['>=','>','<=','<','=='].includes(c.operator)?c.operator:null;
  const passed=typeof c.passed==='boolean'?c.passed:null;
  let gap:number|null=null,progressPercent:number|null=null;
  if(operator&&actual!==null&&threshold!==null&&passed!==null){
   gap=passed?0:operator==='>='||operator==='>'?Math.max(0,threshold-actual):
    operator==='<='||operator==='<'?Math.max(0,actual-threshold):Math.abs(actual-threshold);
   if((operator==='>='||operator==='>')&&threshold>0&&actual>=0)
    progressPercent=Math.max(0,Math.min(100,actual/threshold*100));
  }
  return {name:c.name.trim().slice(0,60),passed,actual,threshold,operator,
   unit:typeof c.unit==='string'?c.unit.slice(0,16):null,gap,progressPercent};
 });
 return {reported:checks.length>0,reportedCount:checks.length,passed:checks.filter(c=>c.passed===true).length,
  failed:checks.filter(c=>c.passed===false).length,unknown:checks.filter(c=>c.passed===null).length,checks,
  note:checks.length?'Only strategy-emitted measurements are included.':'WAIT did not contain condition telemetry; no distance to entry can be established.'};
}
