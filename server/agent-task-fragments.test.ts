import {describe,it,expect} from 'vitest';
import {makeDraftFragment,assembleDraftFragments} from './agent-task-fragments.ts';
const ctx={ownerUid:'alice',taskId:'task_12345678',slot:'gold-scalper',asset:'GOLDUSDC',venue:'propdao' as const};
const pair=()=>{
 const one=makeDraftFragment(ctx,0,2,'export const config = {riskPercent:.25,timeframes:["m1"]};');
 const two=makeDraftFragment(ctx,1,2,'export function onCandle(ctx){return {signal:"WAIT"}};');
 return [one,two];
};
describe('durable multi-turn robot code fragments',()=>{
 it('assembles immutable ordered source without feeding old code through model context',()=>{
  const rows=pair();
  const source=assembleDraftFragments(ctx,rows);
  expect(source).toContain('onCandle');
  expect(source).toContain('riskPercent');
  expect(rows[0].id).toMatch(/^fragment_[a-f0-9]{32}$/);
 });
 it('identical fragment retry yields same ID and hash',()=>{
  const f=pair()[0];
  const retried=makeDraftFragment(ctx,0,2,f.source,f.createdAt);
  expect(retried).toEqual(f);
 });
 it('rejects out-of-order, wrong-owner and duplicate-index fragments',()=>{
  const rows=pair();
  expect(()=>assembleDraftFragments(ctx,[rows[1],rows[0]])).toThrow();
  expect(()=>assembleDraftFragments({...ctx,ownerUid:'bob'},rows)).toThrow();
  expect(()=>assembleDraftFragments(ctx,[rows[0],rows[0]])).toThrow();
 });
 it('rejects modified source, missing fragments and oversized combined code',()=>{
  const rows=pair();
  expect(()=>assembleDraftFragments(ctx,[{...rows[0],source:rows[0].source+'  // modified'},rows[1]])).toThrow();
  expect(()=>assembleDraftFragments(ctx,[rows[0]])).toThrow();
  expect(()=>makeDraftFragment(ctx,0,2,'x'.repeat(4501))).toThrow();
 });
});
