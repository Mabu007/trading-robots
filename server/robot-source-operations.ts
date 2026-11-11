import {createHash} from 'node:crypto';
import {parseStrategyConfig,validateStrategySyntax} from '../src/strategy.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function uniqueCodeReplacement(code:string,find:string,replace:string,expectedHash:string){
 if(typeof code!=='string'||code.length>180000||typeof find!=='string'||
    typeof replace!=='string'||!find.length||find.length>3000||
    replace.length>6000||!/^([a-f0-9]{64})$/.test(expectedHash))
  throw Error('Invalid targeted source change');
 if(hash(code)!==expectedHash)throw Error('Strategy source changed; re-read exact code hash');
 const at=code.indexOf(find);
 if(at<0)throw Error('Exact source snippet was not found; inspect the saved strategy');
 if(code.indexOf(find,at+1)>=0)throw Error('Source snippet is not unique; choose a larger exact block');
 if(find===replace)throw Error('No source change was proposed');
 const proposed=code.slice(0,at)+replace+code.slice(at+find.length);
 if(proposed.length>180000)throw Error('Proposed strategy exceeds source limit');
 parseStrategyConfig(proposed);
 validateStrategySyntax(proposed);
 return {proposed,previousHash:expectedHash,proposedHash:hash(proposed),
  oldSnippet:find,newSnippet:replace,changedAtLine:code.slice(0,at).split('\n').length};
}
export function sourceLines(code:string,startLine=1,lineCount=100){
 if(typeof code!=='string'||code.length>180000||!Number.isInteger(startLine)||
   !Number.isInteger(lineCount)||startLine<1||lineCount<1||lineCount>140)
  throw Error('Invalid strategy source window');
 const lines=code.split('\n'),snippet=lines.slice(startLine-1,startLine-1+lineCount).join('\n');
 return {startLine,lineCount:Math.min(lineCount,Math.max(0,lines.length-startLine+1)),
  totalLines:lines.length,code:snippet,codeHash:hash(code),
  complete:startLine===1&&lineCount>=lines.length,nextLine:startLine-1+lineCount<lines.length?startLine+lineCount:null};
}
export function requestedStrategyMutation(input:unknown){
 if(typeof input!=='string'||input.length>16000)return {create:false,edit:false,delete:false};
 const text=input.toLowerCase();
 return {
  create:/\b(?:create|make|build|write|generate|new)\b[\s\S]{0,90}\b(?:bot|robot|strategy|strategy\.js)\b|\b(?:bot|robot|strategy)\b[\s\S]{0,90}\b(?:create|new|generate|build)\b/i.test(text),
  edit:/\b(?:edit|modify|update|change|fix|adjust|rewrite|improve|widen|tighten|replace)\b/i.test(text)&&
   /\b(?:strategy|bot|robot|code|source|script|stop|sl|filter|entry|exit|it|its|that)\b/i.test(text),
  delete:/\b(?:delete|remove|erase|discard)\b[\s\S]{0,90}\b(?:bot|robot|strategy|code)\b|\b(?:bot|robot|strategy|code)\b[\s\S]{0,90}\b(?:delete|remove|erase)\b/i.test(text)
 };
}

/** A user-supplied venue must never change the stored venue to bypass
 * production-runtime source guards. This is a pure validation boundary; the
 * caller must still take per-bot locks and independently verify deployment.
 */
export function validateSavedSourceOverwrite(
  uid:string,botId:string,requestedVenue:string,raw:string|null
):{existing:boolean;venue:string}{
 if(typeof uid!=='string'||!uid||uid.length>128||uid.includes('/')||
   !/^[A-Za-z0-9_-]{1,100}$/.test(botId)||
   !['propdao','valr','hyperliquid','ctrader'].includes(requestedVenue))
   throw Error('Invalid saved source identity or venue');
 if(!raw)return {existing:false,venue:requestedVenue};
 let stored:Record<string,unknown>;
 try{stored=JSON.parse(raw)}
 catch{throw Error('Stored strategy source is invalid; overwrite is blocked')}
 if(!stored||typeof stored!=='object'||stored.userId!==uid||stored.botId!==botId||
    typeof stored.code!=='string'||stored.venue!==requestedVenue)
  throw Error('Saved source ownership or venue mismatch; overwrite is blocked');
 if(stored.venue==='ctrader')throw Error('cTrader source requires separately verified stopped gateway authorization');
 return {existing:true,venue:requestedVenue};
}
