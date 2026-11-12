import {describe,it,expect} from 'vitest';
import {createTaskFromMessage,createReady,completeCreatePrompt,isNewRobotRequest,isEditFollowup,backtestPreset,defaultTradingPreferences,saneTask} from './conversation-workflow';
describe('durable AI conversation tasks',()=>{
 it('uses previous answers and preferences instead of re-asking for venue and robot name',()=>{
  const task=createTaskFromMessage('nah make a new robot',null,defaultTradingPreferences,[{role:'user',content:'Build a dope liquidity sweep robot for tomorrow'}]);
  expect(task).toMatchObject({asset:'XAUUSD',venue:'research'});
  const named=createTaskFromMessage('Liquid man is the new name',task,defaultTradingPreferences);
  expect(createReady(named)).toBe(true);
  expect(completeCreatePrompt(named,defaultTradingPreferences)).toContain('named "Liquid man"');
 });
 it('does not route a robot follow-up to personality changes',()=>{
  expect(isEditFollowup('yeah edit it to make it dope')).toBe(true);
  expect(isEditFollowup('change my personality profile')).toBe(false);
  expect(isNewRobotRequest('nah make a new robot')).toBe(true);
  expect(isNewRobotRequest('how do I create a robot')).toBe(false);
  expect(isNewRobotRequest('make the Gold Digger robot better')).toBe(false);
 });
 it('shows exact UTC ranges and preserves only validated task fields',()=>{
  expect(backtestPreset(7,new Date('2026-11-08T20:00:00Z'))).toEqual({from:'2026-11-01',to:'2026-11-07'});
  expect(saneTask({kind:'backtest',botId:'abc',botName:'ai 2'})).toMatchObject({kind:'backtest',botId:'abc'});
 });
});
it('preserves an original live-loss question across an ambiguous robot-selection card',()=>{
 const raw={kind:'choose-robot',action:'status',robotIds:['bot-ai1','bot-ai2'],question:'Why am I losing so many trades?'};
 expect(saneTask(raw)).toMatchObject(raw);
 expect(saneTask({...raw,question:'x'.repeat(900)})?.kind).toBe('choose-robot');
});
