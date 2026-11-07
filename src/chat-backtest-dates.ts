export function chatBacktestDates(message:string):{from:string;to:string}|null{
 const dates=[...message.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(match=>match[0]);
 if(!dates.length)return null;
 if(dates.length>2)throw Error('Give me one date or a start and end date in YYYY-MM-DD format.');
 const [from,to=from]=dates;
 const valid=(day:string)=>{
  const value=new Date(day+'T00:00:00Z');
  return Number.isFinite(value.getTime())&&value.toISOString().slice(0,10)===day;
 };
 if(!valid(from)||!valid(to)||to<from)throw Error('Those dates do not form a valid UTC backtest range.');
 return {from,to};
}
