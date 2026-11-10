/** AI chooses what to do; these guards prevent unintended executions and
 * old modal prompts consuming unrelated conversational turns. */
export function explicitBacktestRequest(message:string):boolean{
 const m=message.trim();
 if(/\b(?:don't|do not|not|without|stop|instead of)\s+(?:run(?:ning)?\s+)?(?:a\s+)?backtest\b/i.test(m))return false;
 if(/^\s*(?:why|what|which|when|where|how|is|are|was|were|did|does|am|i'm|im|we|can we discuss)\b/i.test(m))return false;
 return /^(?:(?:please|now|hey|papi|vibes|okay|ok|yeah|yes)[,\s!]*){0,3}(?:(?:can|could|would|will)\s+you\s+)?(?:(?:run|start|execute|launch|do)\s+(?:a\s+|the\s+|another\s+|new\s+)?(?:backtest|retest|historical simulation)|(?:backtest|retest)\b)/i.test(m);
}
export function explicitActionRequest(message:string):boolean{
 const m=message.trim();
 if(/^\s*(?:what|why|when|where|how|which|is|are|was|were|did|does|any|has|have|who|do you know|tell me|show me)\b/i.test(m))return false;
 if(/^\s*(?:i(?:'m| am) talking about|no,? i mean|papi|bro)\b/i.test(m)&&!explicitBacktestRequest(m))return false;
 return explicitBacktestRequest(m)||
  /^(?:please\s+|now\s+|can you\s+|could you\s+|would you\s+|let's\s+|lets\s+){0,3}(?:deploy|stop|pause|resume|start(?: the)? bot|create|build|generate|write|edit|update|modify|rewrite|rename|delete|remove|connect|disconnect|backtest|retest|run a backtest|set up (?:a )?watch|monitor|alert|analy[sz]e|scan)\b/i.test(m);
}
export function isPendingCreateAnswer(message:string):boolean{
 return /^\s*(?:propdao|hyperliquid|valr|ctrader)\s*(?:[,/-]\s*|\s+)(?:gold|goldusdc|xauusd|btc|btcusdc|eth|ethusdc)\s*$/i.test(message)
 ||/^(?:goldusdc|xauusd|btc(?:usdc)?|eth(?:usdc)?|gold|propdao|hyperliquid|valr|ctrader)$/i.test(message.trim())
 ||/^\s*(?:call (?:it|the robot)|name it|named)\s+[a-z0-9 -]{2,50}$/i.test(message);
}
export function isPendingRobotChoice(message:string,names:string[]):boolean{
 const m=message.trim();
 return /^robot:[A-Za-z0-9_-]{1,150}$/.test(m)||(m.length<=80&&names.some(name=>name.trim().toLowerCase()===m.toLowerCase()));
}
export function needsLiveBotContext(message:string):boolean{
 return /\b(?:trades?|positions?|orders?|fills?|bot|robot|agent|signals?|conditions?|thresholds?|entry|entries|stop[- ]loss|exits?|live|runtime|running|wait|market|price|volatility|ema|rsi|atr|yet|now|currently|today|still|updates?|anything new|loss(?:es)?|loses?|losing|lost|drawdown|performance|pnl|profit|stop.?out|win.?rate)\b/i.test(message);
}
