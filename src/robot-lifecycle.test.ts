import {it,expect} from 'vitest';
import {robotDisplayState,canClearRobot} from './robot-lifecycle.ts';
import type {PersistentAgent} from './agents';
const robot={mode:'live',state:'running',permissions:{liveExecution:true},deployment:{grantId:'g'}} as PersistentAgent;
it('shows a persisted stopped grant as stopped after Worker grant has been removed',()=>{
 const stopped={...robot,state:'stopped',permissions:{...robot.permissions,liveExecution:false}} as PersistentAgent;
 expect(robotDisplayState(stopped,{state:'stopped',verified:false})).toBe('stopped');
 expect(canClearRobot(stopped)).toBe(true);
});
it('will never call an unconfirmed or running robot stopped',()=>{
 expect(robotDisplayState(robot,{state:'unknown',verified:false})).toBe('verification-required');
 expect(canClearRobot(robot,{state:'stopped',verified:false})).toBe(false);
 const unknown={...robot,state:'unknown',permissions:{...robot.permissions,liveExecution:false}} as PersistentAgent;
 expect(robotDisplayState(unknown,{state:'stopped',verified:false})).toBe('verification-required');
});
