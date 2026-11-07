export type ToolTrace={id:string;name:string;state:'requested'|'completed';input?:unknown;output?:unknown;outputTruncated?:boolean};
function bounded(value:unknown):{value?:unknown;truncated?:boolean}{
 try{const json=JSON.stringify(value);if(!json)return {};if(json.length>16000)return {truncated:true};return {value:JSON.parse(json)}}catch{return {truncated:true}}
}
/** These are user-visible snapshots, never authorization or financial truth. */
export function updateToolTrace(existing:ToolTrace[],event:unknown):ToolTrace[]{
 if(!event||typeof event!=='object')return existing;
 const e=event as Record<string,unknown>;
 if(typeof e.toolCallId!=='string'||e.toolCallId.length>120)return existing;
 if(e.type==='tool-call'&&typeof e.toolName==='string'&&/^[A-Za-z0-9_]{1,100}$/.test(e.toolName)){
  if(existing.some(x=>x.id===e.toolCallId)||existing.length>=12)return existing;
  const input=bounded(e.input);
  return [...existing,{id:e.toolCallId,name:e.toolName,state:'requested',...(input.value!==undefined?{input:input.value}:{})}];
 }
 if(e.type==='tool-result'){
  const output=bounded(e.output);
  return existing.map(x=>x.id===e.toolCallId?{...x,state:'completed',...(output.value!==undefined?{output:output.value}:{}),...(output.truncated?{outputTruncated:true}:{})}:x);
 }
 return existing;
}

export function toolTraceLabel(name:string):string{
 const labels:Record<string,string>={getPublicMarketEvidence:'Public market evidence',runVerifiedBacktest:'Historical simulation',getBrokerConnections:'Broker connections',listSavedStrategies:'Saved strategy catalogue',listUserAgents:'Saved agents',getSavedStrategy:'Saved strategy',getSavedBacktest:'Saved backtest',getSavedBacktestTrade:'Backtest trade',getHyperliquidOrderBook:'Hyperliquid order book',getAgentRuntimeStatus:'Agent status',getMonitorStatus:'Monitor status',getFinancialHeadlines:'Financial headlines',getNewsCoverage:'News coverage'};
 return labels[name]||'Information source';
}
