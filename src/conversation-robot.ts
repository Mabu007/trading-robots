import {resolveCodeReference} from './code-catalog';
import type {CloudBot} from './firebase';
type Turn={role:string;content:string};
/** The last robot the USER explicitly named is the conversation subject.
 * Never infer the target from the currently open editor or from AI-generated text.
 */
export function conversationRobot(message:string,turns:Turn[],bots:CloudBot[]):CloudBot|null{
 const clean=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const phrase=' '+clean(message)+' ';
 const explicit=bots.filter(bot=>bot.name&&(' '+phrase).includes(' '+clean(bot.name)+' '));
 if(explicit.length>1)return null; // never select one of two named robots for an edit
 const direct=resolveCodeReference(message,bots);
 if(direct)return direct.bot;
 if(!/\b(robot|bot|strategy|code|script|it|that|this|improv|better|change|edit|modify|fix|backtest|explain|analy[sz]e|source|signals?|trades?|positions?|orders?|fills?|yet|now|currently|market|volatility|threshold|conditions?)\b/i.test(message))return null;
 for(const turn of turns.slice(-28).reverse()){
  if(turn.role!=='user')continue;
  const matched=resolveCodeReference(turn.content,bots);
  if(matched)return matched.bot;
 }
 return null;
}
export function semanticChatTitle(turns:Turn[],bots:CloudBot[]):string{
 const text=turns.filter(t=>t.role==='user').map(t=>t.content);
 const subject=[...text].reverse().map(t=>resolveCodeReference(t,bots)?.bot).find(Boolean);
 if(subject){
  const full=text.join(' ').toLowerCase();
  const kind=/\b(backtest|retest|results|performance)\b/.test(full)?'Backtest research':
    /\b(edit|improve|better|change|modify|strategy)\b/.test(full)?'Strategy improvements':'Robot research';
  return (subject.name+' · '+kind).slice(0,80);
 }
 const first=text.find(t=>t.trim().length>4&&!/^(hello|hi|hey|morning|thanks|papi|how are you)[!?\s.]*$/i.test(t.trim()));
 if(!first)return 'New conversation';
 const cleaned=first.replace(/\s+/g,' ').replace(/[\r\n]/g,' ').replace(/^(?:please |can you |could you |i want to |tell me |explain )/i,'').trim();
 const name=cleaned.split(/[.!?]/)[0].slice(0,65);
 return name.length>4?name.charAt(0).toUpperCase()+name.slice(1):'New conversation';
}
