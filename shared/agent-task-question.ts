/** User-visible decisions are research direction, never implicit broker authorization. */
export type TaskQuestion={id:string;prompt:string;options:[string,string];context:string;createdAt:number};
export const OTHER_ANSWER='Other — write my own answer';
const amount=(s:string)=>Number(s.replace(/[,\s]/g,''));
export function substantialReturnQuestion(objective:string,now:number):TaskQuestion|null{
 const source=objective.slice(0,1400).replace(/\s+/g,' ').trim();
 const mentionsMoney=/(?:R\s*[\d,]+|\bZAR\s*[\d,]+|\bUSD\s*[\d,]+|\$\s*[\d,]+)/ig;
 const values=[...source.matchAll(mentionsMoney)].slice(0,4).map(m=>amount(m[0].replace(/(?:R|ZAR|USD|\$)/ig,''))).filter(Number.isFinite);
 const quick=/\b(today|tonight|tomorrow|end of (?:the )?day|eod|by midnight|24 hours?|one day)\b/i.test(source);
 const trading=/\b(trad(?:e|ing)|account|capital|investment|profit|return|grow|make|turn|multiply|vibes)\b/i.test(source);
 const from=values[0],to=values[1];
 if(!quick||!trading||!(from>0&&to>from*1.5))return null;
 const percent=Math.round((to/from-1)*100);
 return {id:'goal-risk-'+now.toString(36),
  prompt:'Turning '+values[0]+' into '+values[1]+' in a day requires about '+percent+'% return. There is no reliable way to promise that result. Which constraint should VIBES prioritize?',
  options:[
   'Protect capital: research possibilities and preserve my limit; do not chase the target.',
   'Experimental DEMO only: explore high-risk hypotheses, but do not exceed my separately approved demo loss limits.'
  ],
  context:'The response sets research priorities only. It does not approve broker execution, new risk limits, or real-money trading.',
  createdAt:now};
}
export function validTaskAnswer(q:TaskQuestion,value:unknown):string{
 if(typeof value!=='string')throw Error('A written answer is required');
 const answer=value.trim();
 if(!answer||answer.length>600)throw Error('Answer must be 1–600 characters');
 if(answer!==q.options[0]&&answer!==q.options[1]&&!answer.startsWith('Other: '))
  throw Error('Choose one of the provided options or write an Other answer');
 if(answer.startsWith('Other: ')&&answer.slice('Other: '.length).trim().length<2)
  throw Error('Write the Other response before continuing');
 return answer;
}
