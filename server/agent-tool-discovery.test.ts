import {describe,it,expect} from 'vitest';
import {selectPrivateReadTools,scopePrivateTools,privateReadToolNames} from './agent-tool-discovery.ts';
describe('private SDK capability selection',()=>{
 it('does not expose account tools to unrelated market questions',()=>{
  expect(selectPrivateReadTools({query:'What is the Gold price today?',researchMode:false})).toEqual([]);
 });
 it('discovers a strategy before attempting to read its source',()=>{
  const names=selectPrivateReadTools({query:'Can you inspect my saved robot source?',researchMode:false});
  expect(names).toContain('listSavedStrategies');expect(names).toContain('getSavedStrategy');
 });
 it('discovers owned backtests and trade details only for relevant requests',()=>{
  const names=selectPrivateReadTools({query:'Audit trade #2 from my last backtest',researchMode:false});
  expect(names).toEqual(expect.arrayContaining(['getSavedBacktest','getSavedBacktestTrade','listSavedStrategies']));
 });
 it('excludes all private tools during third-party research',()=>{
  expect(selectPrivateReadTools({query:'Search the web about my strategies',researchMode:true})).toEqual([]);
 });
 it('does not expose unexpected tools even if present in registry object',()=>{
  const input={getSavedStrategy:1,readSecret:2,orderOpen:3,listSavedStrategies:4};
  expect(scopePrivateTools(input,{query:'my saved strategy',researchMode:false})).toEqual({getSavedStrategy:1,listSavedStrategies:4});
  expect(privateReadToolNames).not.toContain('orderOpen');
 });
});
