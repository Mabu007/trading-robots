/**
 * Decide whether the user is explicitly requesting a strategy.js edit.
 *
 * Safe default: explanation. Product questions, hypotheticals, quotes and
 * diagnostic questions must never create a code proposal just because their
 * sentences mention "make", "add", "indicator", "strategy", etc.
 *
 * This is a conservative gate, not an AI replacement. When a user explicitly
 * asks to edit strategy code, the existing syntax and apply validations remain
 * authoritative. No platform/backend fixes are applied through this gate.
 */
export type ChatTurn = {role:string;content:string};

const command = '(?:write|generate|create|build|code|rewrite|edit|update|change|modify|fix|implement|add|remove|replace|refactor|adjust|make|turn|convert|transform)';
const subject = '(?:strategy(?:\\.js)?|script|source code|code|onCandle|config|trading rules?|entry (?:rules?|logic|conditions?)|exit (?:rules?|logic|conditions?)|entry|entries|exit|exits|signals?|indicators?|stop(?:[ -]?loss)?|take[ -]?profit|targets?|risk[ -]?(?:reward|management)?|trailing stop|breakout|reversal|scalping|scalper|trend[ -]?following|liquidity[ -]?sweep|algorithm|algo|robot|bot)';
const action = new RegExp('\\b'+command+'\\b','i');
const target = new RegExp('\\b'+subject+'\\b','i');
const productOnly = /\b(?:app|website|platform|ui|ux|interface|chatbot|chat|assistant|api|backend|cloudflare|worker|durable object|deployment|deploy button|account|database|firestore|vercel|connectivity|data provider|data feed|historical data|market data)\b/i;

function isDiscussion(text:string):boolean {
 if(/^\s*(?:why|how|what|when|where|which|who|does|do|did|is|are|was|were|should|will|would|can|could|has|have)\b/i.test(text)&&!/^\s*(?:can|could|would|will)\s+you\b/i.test(text))return true;
 if(/^\s*(?:i(?:'m| am) (?:asking|wondering|trying to understand)|my question is|i have a question|quick question|explain|tell me|help me understand|do you know|i wonder)\b/i.test(text))return true;
 if(/\b(?:i(?:'m| am) (?:not|just) asking|not (?:asking|telling) (?:you|it) to (?:change|edit|modify|write|fix)|don't (?:edit|change|rewrite|modify)|do not (?:edit|change|rewrite|modify)|without (?:editing|changing|rewriting|modifying)|just (?:explain|discuss|answer)|discussion only|question only)\b/i.test(text))return true;
 if(/^\s*(?:what if|what would|what happens if|how (?:would|could|should|do|does|can) (?:i|we|it|my|the|a)\b|is there (?:a|any) way)\b/i.test(text))return true;
 // "I think the bot must load 200 candles" describes desired behavior but
 // does not instruct the assistant to overwrite a strategy.
 if(/^\s*(?:i think|i feel|it seems|so (?:why|can|does|is)|as you can see|i'm noticing)\b/i.test(text))return true;
 return false;
}
function offersSpecificEdit(previous:ChatTurn|undefined):boolean{
 if(!previous||previous.role!=='assistant')return false;
 // Require an explicit offer, not an explanation that happens to mention edits.
 return /(?:would|do)\s+you\s+(?:like|want)\s+(?:me|the ai)\s+to\s+(?:write|rewrite|edit|update|modify|change|build|create|implement|add|fix)\b[^?]{0,150}\?$/i.test(previous.content.trim());
}
export function requestsCodeChange(message:string,history:ChatTurn[]=[]):boolean{
 if(typeof message!=='string')return false;
 const text=message.trim().slice(0,3000);
 if(!text)return false;

 const affirmative=/^(?:y|yes|yeah|yep|sure|please|do it|go ahead|okay|ok)[.!]?$/.test(text.toLowerCase());
 if(affirmative)return offersSpecificEdit(history.at(-1));

 // A question about how code, warm-up, indicators or the platform work is
 // not an instruction, even if it includes words like "make" and "change".
 if(isDiscussion(text))return false;

 const explicitAddress=/^\s*(?:(?:please|hey|hi)[,\s]+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?/i.test(text);
 const directCommand=new RegExp('^\\s*(?:please[\\s,]+)?'+command+'\\b','i').test(text);
 const directive=/^\s*(?:i(?:'d| would) like|i want|i need)\s+(?:you|the ai|the assistant|chatgpt)\s+to\s+/i.test(text)
   ||/^\s*(?:let'?s|we (?:need|have) to)\s+/i.test(text);
 const now=/\b(?:please\s+(?:write|rewrite|edit|modify|update|change|implement|add|remove|fix)|go ahead and (?:write|rewrite|edit|modify|update|change|implement|add|remove|fix))\b/i.test(text);

 if(!(explicitAddress||directCommand||directive||now))return false;

 // Changing the *platform* is not the same as changing the strategy file.
 const explicitCode=/\b(?:strategy(?:\.js)?|script|source code|code|onCandle|trading rules?|entry (?:rules?|logic)|exit (?:rules?|logic))\b/i.test(text);
 if(productOnly.test(text)&&!explicitCode)return false;
 if(!target.test(text))return false;

 // Ensure the action is actually present in a direct user instruction.
 if(!action.test(text))return false;
 // Reject instructions which quote a code-edit request as an example.
 if(/^\s*(?:quote|for example|example:|someone said|the message said)\b/i.test(text))return false;
 return true;
}
