/** Conservative capability discovery for authenticated private tools.
 * This is a context minimization filter, NOT an authorization decision.
 * Each tool must independently verify ownership and source validity.
 */
export const privateReadToolNames=[
 'listSavedStrategies','listUserAgents','getSavedStrategy','getSavedBacktest',
 'getSavedBacktestTrade','getAgentRuntimeStatus','getMonitorStatus'
] as const;
export type PrivateReadToolName=typeof privateReadToolNames[number];
export type PrivateToolContext={query:string;researchMode:boolean};
export function selectPrivateReadTools({query,researchMode}:PrivateToolContext):readonly PrivateReadToolName[]{
 if(researchMode||typeof query!=='string'||query.length>16000)return [];
 const text=query.trim().toLowerCase();
 if(!text)return [];
 const isStrategy=/\b(strateg(?:y|ies)|robot|bot|code|source|script|algorithm|onCandle)\b/i.test(text);
 const isBacktest=/\b(backtests?|backtesting|replays?|historical results?|profit factor|drawdown|simulation|trades?)\b/i.test(text);
 const isAgent=/\b(agents?|bots?|robots?|runtimes?|running|deployed|paused|stopped)\b/i.test(text);
 const isWatch=/\b(watches?|monitors?|alerts?|scheduled|triggers?|watchers?)\b/i.test(text);
 const names:PrivateReadToolName[]=[];
 if(isStrategy||isBacktest)names.push('listSavedStrategies');
 if(isAgent)names.push('listUserAgents');
 if(isStrategy)names.push('getSavedStrategy');
 if(isBacktest)names.push('getSavedBacktest');
 if(isBacktest&&/\b(trade|position|entry|exit|fill)\b/i.test(text))names.push('getSavedBacktestTrade');
 if(isAgent)names.push('getAgentRuntimeStatus');
 if(isWatch)names.push('getMonitorStatus');
 return names;
}
export function scopePrivateTools<T extends Record<string,unknown>>(tools:T,context:PrivateToolContext):Partial<T>{
 const allowed=new Set<string>(selectPrivateReadTools(context));
 return Object.fromEntries(Object.entries(tools).filter(([name])=>allowed.has(name))) as Partial<T>;
}
