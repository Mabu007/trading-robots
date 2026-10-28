export type LiveReadiness = {
  registered?: boolean;
  strategyTimeframe?:string|null;
  bot: {id:string;name:string;asset:string;privateBotId:string;published:boolean};
  runtime: {available:boolean;timeframe?:string;asset?:string;deployed?:boolean;running?:boolean;evaluating?:boolean;demoExecutionEnabled?:boolean;version?:string;lastError?:string|null;lastSuccessfulEvaluation?:number|null;lastAttempt?:number|null;nextAlarm?:number|null;consecutiveFailures?:number;lastSignal?:{id:string;action:string;candleClose:number}|null};
  broker: {connected:boolean;environment:'demo'|'live'|null;broker:string|null;accountSuffix:string|null;permission:boolean;accountVerified:boolean;mappingVerified:boolean;sourceMatches:boolean;emergencyPaused:boolean;gatewayAvailable:boolean;gatewayConnected:boolean;gatewayLastMessageAt:number|null;demoExecutionEnabled:boolean};
  locked:boolean;following:boolean;live:boolean;realMoneyEnabled:boolean;observedAt:number;
};

export type LiveExecution={id:string;state:string;updatedAt:number;action:string|null;entryPrice:number|null;volume:number|null;error:string|null};

export type InstanceAction='start'|'stop';
export type InstanceObservation={deployed?:boolean;running?:boolean;evaluating?:boolean;nextAlarm?:number|null;lastError?:string|null};
