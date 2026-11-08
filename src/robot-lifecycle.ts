import type {PersistentAgent} from './agents';
export type RobotDisplayState='running'|'paused'|'stopped'|'verification-required';
export type RobotRuntimeStatus={state?:string;verified?:boolean;error?:string|null};
/** Authorization lifecycle is not equivalent to independent broker exposure verification.
 * A confirmed, persisted stop remains stopped after its temporary Worker grant is removed.
 */
export function robotDisplayState(agent:PersistentAgent,runtime?:RobotRuntimeStatus):RobotDisplayState{
 if(agent.mode!=='live')return 'verification-required';
 if(agent.state==='stopped'&&agent.permissions.liveExecution===false){
  if(runtime?.verified===true&&['running','paused'].includes(runtime.state||''))return 'verification-required';
  return 'stopped';
 }
 if(runtime?.verified===true&&runtime.state==='running'&&agent.permissions.liveExecution===true)return 'running';
 if(runtime?.verified===true&&runtime.state==='paused'&&agent.permissions.liveExecution===true)return 'paused';
 return 'verification-required';
}
export function canClearRobot(agent:PersistentAgent,runtime?:RobotRuntimeStatus):boolean{
 return !agent.archivedAt&&robotDisplayState(agent,runtime)==='stopped'&&Boolean(agent.deployment?.grantId);
}
