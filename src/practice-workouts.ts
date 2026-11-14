import type {ReplayBar} from './market-replay-engine';
export type WorkoutId='sweep'|'breakout'|'rejection'|'volatility'|'london';
export const WORKOUTS: {id:WorkoutId;title:string;category:string;level:string;description:string;rule:string}[]=[
 {id:'sweep',title:'Liquidity Sweep Fundamentals',category:'LIQUIDITY',level:'BEGINNER',description:'Recognise a move beyond a recent high or low that closes back inside the range.',rule:'A candle moves beyond the preceding 20 minutes’ high or low and closes inside that range.'},
 {id:'breakout',title:'Breakout Foundations',category:'PRICE ACTION',level:'BEGINNER',description:'Study what happens when price closes beyond a recent trading range.',rule:'A candle closes outside the preceding 20 minutes’ high or low after the prior close was inside it.'},
 {id:'rejection',title:'Rejection Candles',category:'CANDLESTICKS',level:'BEGINNER',description:'Practise reading candles with a pronounced wick near recent prices.',rule:'A completed candle has a wick at least twice its body and at least half its full range.'},
 {id:'volatility',title:'Volatility Expansion',category:'MARKET CONDITIONS',level:'INTERMEDIATE',description:'Explore how the market behaves when a candle expands beyond its recent range.',rule:'A candle’s range is at least 1.75 times the average range of the preceding 20 minutes.'},
 {id:'london',title:'London Open Practice',category:'TRADING SESSIONS',level:'INTERMEDIATE',description:'Study Gold around the London market open across historical sessions.',rule:'The first completed M1 candle starting at 08:00 in the Europe/London time zone.'},
];
const londonTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
/** M1 candles are timestamps at candle open. Events become known at candle close.
 * A full consecutive warm-up is mandatory. Later price values never influence matching. */
export function findWorkoutMoments(bars:ReplayBar[],id:WorkoutId):number[]{
 const result:number[]=[];
 for(let i=20;i<bars.length-1;i++){
  const window=bars.slice(i-20,i+1);
  if(window.some((bar,n)=>n>0&&bar.time-window[n-1].time!==60))continue;
  const prior=window.slice(0,20),current=bars[i];
  const high=Math.max(...prior.map(bar=>bar.high)),low=Math.min(...prior.map(bar=>bar.low));
  const range=current.high-current.low,body=Math.abs(current.close-current.open);
  const wick=Math.max(current.high-Math.max(current.open,current.close),Math.min(current.open,current.close)-current.low);
  const average=prior.reduce((sum,bar)=>sum+bar.high-bar.low,0)/20;
  const match=id==='sweep'?current.close>low&&current.close<high&&(current.high>high||current.low<low):
   id==='breakout'?bars[i-1].close<=high&&bars[i-1].close>=low&&(current.close>high||current.close<low):
   id==='rejection'?range>0&&wick>=range*.5&&wick>=2*body:
   id==='volatility'?average>0&&range>=1.75*average:
   londonTime.format(new Date(current.time*1000))==='08:00';
  if(match)result.push(i);
 }
 return result;
}
