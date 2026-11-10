/** Read routing only. No automatic broker action is authorized by this detector.
 * VIBES still interprets the question and answers from authenticated evidence. */
export function wantsLiveTradeEvidence(message:string){
 const text=message.trim();
 if(!text)return false;
 if(/\b(?:backtest|backtesting|simulat(?:ion|ed)|historical run|saved test)\b/i.test(text)&&
  !/\b(?:live|real|right now|not (?:the|a)? ?backtest|actual broker|currently)\b/i.test(text))return false;
 return /\b(?:loss(?:es)?|loses?|losing|lost|drawdown|stop(?:ped)? ?out|sl hit|red trades?|losers?|p\/?l|pnl|profit|money|trades?|fills?|positions?|activity|win ?rate|performance|results?)\b/i.test(text)&&
  (/\b(?:why|what|how|any|many|now|yet|recent|today|currently|still|trades?|losing|loss(?:es)?|loses?|profits?|p\/?l|pnl|broker|bot|robot|agent|account|live|performance)\b/i.test(text));
}
