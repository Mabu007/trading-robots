/** Only high-confidence multi-step requests bypass ordinary chat. */
export function durableTaskIntent(message:unknown):boolean {
 if(typeof message!=='string')return false;
 const text=message.trim().slice(0,1250);
 if(text.length<12||/^(what|why|how|explain|show|tell|is|are|can you explain|does|do)\b/i.test(text))return false;
 const work=/\b(build|develop|research|investigate|find|create|generate|test|backtest|validate|improve|optimi[sz]e|manage|run|operate|monitor|trade|pass)\b/i.test(text);
 const target=/\b(propdao|challenge|evaluation|prop firm|funded account|strategy|strategies|robot|robots|bot|bots|gold scalping|trading strategy)\b/i.test(text);
 const sustained=/\b(and|then|until|after|over|for the next|for \d+ (?:hours|days)|end.to.end|automatically|autonomously|agent|work on|keep (?:trying|going|working)|while i)\b/i.test(text);
 const command=/^(?:vibes[\s,:!-]*)?(?:please\s+)?(?:i want(?: you)? to\s+|we need to\s+|can you\s+|could you\s+)?(?:research|investigate|build|develop|create|manage|run|operate|monitor|trade|pass|find|work on)\b/i.test(text);
 const goal=/\b(?:want|need|goal|objective|mission)\b/i.test(text)&&/\b(?:pass|make|build|research|manage)\b/i.test(text);
 return work&&target&&(sustained||command||goal);
}
