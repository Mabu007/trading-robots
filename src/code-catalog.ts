import type {CloudBot} from './firebase';

export type CodeMatch={bot:CloudBot;confidence:'exact'|'unique'};
const simplified=(s:string)=>s.toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g,' ').trim();
const quotedNames=(text:string)=>[...text.matchAll(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/g)].map(m=>simplified(m[1])).filter(Boolean);
/** Resolve only a unique, user-owned code asset. Ambiguous names require selection. */
export function resolveCodeReference(message:string,bots:CloudBot[]):CodeMatch|null {
 const text=simplified(message);
 if(!text)return null;
 const quotes=quotedNames(message);
 const matches=bots.filter(bot=>{
  const key=simplified(bot.name||'');
  if(key.length<3)return false;
  if(quotes.includes(key))return true;
  return (' '+text+' ').includes(' '+key+' ');
 });
 if(matches.length!==1)return null;
 return {bot:matches[0],confidence:quotes.includes(simplified(matches[0].name))?'exact':'unique'};
}
export function codeSuggestions(message:string,bots:CloudBot[]):CloudBot[]{
 const tokens=new Set(simplified(message).split(/\s+/).filter(w=>w.length>3&&!['robot','code','strategy','running','backtest','trade','from','last','week','that','this'].includes(w)));
 return bots.filter(bot=>[...tokens].some(t=>simplified(bot.name).split(' ').includes(t)||simplified(bot.asset).split(' ').includes(t))).slice(0,8);
}
export function catalogContext(bots:CloudBot[],limit=35):string {
 return bots.slice(0,limit).map(bot=>{
  const history=bot.lastBacktest?'last saved backtest '+bot.lastBacktest.from+' to '+bot.lastBacktest.to+', '+bot.lastBacktest.candleCount+' candles':'not backtested';
  return bot.id+' | '+bot.name.slice(0,64)+' | '+bot.asset.slice(0,32)+' | '+(bot.venue||'valr')+' | '+history;
 }).join('\n').slice(0,4500);
}
