import type {Venue} from '../shared/venues';

export type AgentState='backtest_running'|'backtest_completed'|'backtest_failed'|'deployment_pending'|'running'|'paused'|'stopped'|'unknown';
export type PersistentAgent={
 schemaVersion:1;id:string;ownerUid:string;botId:string;name:string;asset:string;venue:Venue;mode:'backtest'|'live';state:AgentState;
 strategy:{version:string;codeHash:string;revision:number};
 configuration:{timeframes:string[];executionTimeframe:string;riskPercent:number;riskReward:number};
 permissions:{marketDataRead:boolean;backtests:boolean;strategyProposals:boolean;brokerStateRead:boolean;paperExecution:boolean;liveExecution:boolean;executionManagement:boolean};
 createdAt:number;updatedAt:number;lastEventAt:number;
 activeBacktest?:{runId:string;codeHash:string;startedAt:number;heartbeatAt?:number};
 deployment?:{grantId:string;authorizedAt:number;expiresAt:number;codeHash?:string;strategyVersion?:string;limits:Record<string,string|number|boolean>};
 lastBacktest?:{runId:string;codeHash:string;completedAt:number;summary:Record<string,number|string>};lastError?:string;
};
export type AgentAuditEvent={id:string;agentId:string;ownerUid:string;actorUid:string;action:string;fromState:AgentState|null;toState:AgentState;occurredAt:number;source:'backtest-workspace'|'live-runtime';strategyVersion:string;details:Record<string,string|number|boolean|null>};
