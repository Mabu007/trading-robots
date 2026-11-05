/** Only unambiguous explicit action requests invoke tools; ordinary questions stay with the LLM. */
export type ChatCommand = 'backtest' | 'status' | 'deploy' | 'stop' | null;
export function classifyChatCommand(message: string): ChatCommand {
  const text = message.trim().toLowerCase().replace(/[.!?]+$/g, '').trim();
  if (!text) return null;
  // Never treat an explanation or hypothetical question as an execution instruction.
  if (/^(what|why|how|explain|teach|describe|tell me about|would|could|should|if |when |is it |can a |can the )\b/.test(text)) return null;
  if (/^(?:please\s+)?(?:run|start|execute|perform|do)\s+(?:a\s+|the\s+|my\s+)?backtest\b/.test(text)
    || /^(?:please\s+)?backtest\s+(?:it|this|my\s+(?:bot|strategy|agent)|the\s+(?:bot|strategy|agent))\b/.test(text)
    || /^(?:please\s+)?test\s+(?:my\s+|the\s+|this\s+)?(?:bot|strategy|agent)\s+(?:on|against|using)\s+(?:historical|past)\b/.test(text)) return 'backtest';
  if (/^(?:please\s+)?(?:show|check|get|refresh|inspect|what's|what is)\s+(?:me\s+)?(?:the\s+|my\s+)?(?:agent|bot|robot|deployment|live|paper)\s+(?:status|state)\b/.test(text)
    || /^(?:please\s+)?(?:is|are)\s+(?:my\s+|the\s+)?(?:agent|bot|robot)\s+(?:running|online|active|stopped)\b/.test(text)) return 'status';
  if (/^(?:please\s+)?(?:deploy|set up deployment|open deployment|prepare deployment)\b/.test(text)) return 'deploy';
  if (/^(?:please\s+)?(?:stop|halt|pause|disable)\s+(?:my\s+|the\s+|this\s+)?(?:live\s+|paper\s+)?(?:agent|bot|robot|trading)\b/.test(text)) return 'stop';
  return null;
}
