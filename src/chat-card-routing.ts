import type {ToolTrace} from './tool-trace.ts';
import {wantsRobotEnvironment} from './robot-environment-intent.ts';
export type ChatCardKind='robot'|'market'|'none';
export function selectChatCard(question:string,trace:ToolTrace[]):ChatCardKind{
 const completed=(name:string)=>trace.some(t=>t.state==='completed'&&t.name===name);
 const hasReview=trace.some(t=>t.state==='completed'&&
  ['proposeStrategySourceEdit','proposeCreateRobot','proposeDeleteRobot'].includes(t.name));
 // Source CRUD is a single human-reviewed card, not an irrelevant account P/L.
 if(hasReview)return 'none';
 const explicitRobot=wantsRobotEnvironment(question)||
  /\b(?:ai\s*2|my robot|my bot|the running|this robot|its strategy|that bot|its trades|which robot|which bot)\b/i.test(question);
 if(completed('getRobotContextCard')||explicitRobot&&
   (completed('discoverRunningPropDAORobots')||completed('getPropDAORobotOperations')||
    completed('getRunningPropDAORobotEnvironment')))
  return 'robot';
 if(completed('getCurrentMarketConditions'))return 'market';
 return 'none';
}
