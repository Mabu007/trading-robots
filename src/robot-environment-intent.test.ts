import {describe,it,expect} from 'vitest';
import {wantsRobotEnvironment,chooseLiveRobot} from './robot-environment-intent';
const candidate=(robotId:string,runtime:'running'|'paused'|'inactive'|'unverified')=>({
 robotId,accountId:'prop-1',grantId:'grant-'+robotId,issuedAt:Date.now(),runtime
});
describe('owner-scoped live robot intent and selection',()=>{
 it('recognizes a newly deployed robot plus current market question',()=>{
  expect(wantsRobotEnvironment('i just deployed a robot please check market conditions and tell me if it might work')).toBe(true);
  expect(wantsRobotEnvironment('how come u dont have access to the running robot')).toBe(true);
  expect(wantsRobotEnvironment('how is my active bot doing?')).toBe(true);
 });
 it('keeps public market research and strategy-free questions separate',()=>{
  expect(wantsRobotEnvironment('what are the gold market conditions today?')).toBe(false);
  expect(wantsRobotEnvironment('news on gold?')).toBe(false);
 });
 it('chooses a uniquely verified running robot regardless of newest grant',()=>{
  const selected=chooseLiveRobot([candidate('newer-but-inactive','inactive'),
   candidate('actually-running','running')]);
  expect(selected).toMatchObject({kind:'resolved',choice:{robotId:'actually-running'}});
 });
 it('refuses to guess among two verified running robots',()=>{
  expect(chooseLiveRobot([candidate('bot-a','running'),candidate('bot-b','running')]))
   .toMatchObject({kind:'ambiguous',choice:null});
 });
 it('never represents unverified Worker state as running',()=>{
  expect(chooseLiveRobot([candidate('bot-a','unverified')]))
   .toMatchObject({kind:'unverified',choice:{robotId:'bot-a'}});
 });
 it('preserves explicit robot selection, even among multiple robots',()=>{
  expect(chooseLiveRobot([candidate('bot-a','running'),candidate('bot-b','running')],'bot-b'))
   .toMatchObject({kind:'resolved',choice:{robotId:'bot-b'}});
  expect(chooseLiveRobot([candidate('bot-a','running')],'not-owned'))
   .toMatchObject({kind:'not-found',choice:null});
 });
});
