/** Pure alert rules shared by live monitoring and browser historical replay. */
export const ALERT_TF = {m1:60,m5:300,m15:900,m30:1800,h1:3600,h4:14400} as const;
export type AlertBar={time:number;open:number;high:number;low:number;close:number;volume?:number};
export type Condition={id:string;kind:'above'|'below'|'ema_above'|'ema_below'|'rsi_above'|'rsi_below'|'sweep_high'|'sweep_low'|'break_high'|'break_low';value?:number;period?:number;lookback?:number};
export type AlertRule={name:string;symbol:'XAUUSD';timeframe:keyof typeof ALERT_TF;mode:'any'|'all'|'stages';conditions:Condition[];notifyStages:boolean;cooldownSeconds:number;sequenceSeconds:number;expiresAt:number;repeat:boolean;session:null|{timezone:string;start:string;end:string};basis:'completed-candle';strategy:null|{id:string;sourceHash:string};};
export type RuleState={lastBar:number;stage:number;stageStarted:number;latched:string[];lastSent:number;finished:boolean};
export const emptyRuleState=():RuleState=>({lastBar:0,stage:0,stageStarted:0,latched:[],lastSent:0,finished:false});
export function validateAlertRule(v:any):asserts v is AlertRule{
 if(!v||typeof v.name!=='string'||!v.name.trim()||v.name.length>80||v.symbol!=='XAUUSD'||!Object.hasOwn(ALERT_TF,v.timeframe)||!['any','all','stages'].includes(v.mode)||v.basis!=='completed-candle'||!Array.isArray(v.conditions)||v.conditions.length<1||v.conditions.length>6||typeof v.repeat!=='boolean'||typeof v.notifyStages!=='boolean'||!Number.isSafeInteger(v.expiresAt)||!Number.isInteger(v.cooldownSeconds)||v.cooldownSeconds<60||v.cooldownSeconds>86400||!Number.isInteger(v.sequenceSeconds)||v.sequenceSeconds<60||v.sequenceSeconds>86400)throw Error('Choose XAUUSD, completed candles, 1–6 precise conditions and valid alert settings.');
 const ids=new Set<string>();for(const c of v.conditions){
  if(!c||typeof c.id!=='string'||!/^c[1-6]$/.test(c.id)||ids.has(c.id))throw Error('Conditions need unique IDs c1–c6.');ids.add(c.id);
  if(!['above','below','ema_above','ema_below','rsi_above','rsi_below','sweep_high','sweep_low','break_high','break_low'].includes(c.kind))throw Error('Unsupported condition. Define it with the supported price, EMA, RSI or previous-range rules.');
  if(['above','below'].includes(c.kind)&&!(Number.isFinite(c.value)&&c.value>0))throw Error('A positive price level is required.');
  if(c.kind.startsWith('rsi')&&!(Number.isFinite(c.value)&&c.value>=0&&c.value<=100))throw Error('RSI threshold must be 0–100.');
  if(/ema|rsi/.test(c.kind)&&!(Number.isInteger(c.period)&&c.period>=2&&c.period<=200))throw Error('Indicator period must be 2–200.');
  if(/sweep|break/.test(c.kind)&&!(Number.isInteger(c.lookback)&&c.lookback>=2&&c.lookback<=200))throw Error('Previous-range lookback must be 2–200.');
 }
 if(v.strategy!==null&&(!v.strategy||!/^[-\w]{1,128}$/.test(v.strategy.id)||!/^[a-f0-9]{64}$/.test(v.strategy.sourceHash)))throw Error('Invalid saved strategy reference.');
 if(v.session!==null){if(!v.session||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.session.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.session.end)||v.session.start===v.session.end)throw Error('Set valid session times.');new Intl.DateTimeFormat('en',{timeZone:v.session.timezone}).format(0);}
}
export function checkedBars(input:AlertBar[],seconds:number):AlertBar[]{
 let previous=0;return input.map(c=>{if(!Number.isSafeInteger(c.time)||c.time<=previous||c.time%seconds!==0||![c.open,c.high,c.low,c.close].every(n=>Number.isFinite(n)&&n>0)||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.high<c.low)throw Error('Invalid, duplicate or unordered candles.');previous=c.time;return c;});
}
export function conditionMet(c:Condition,bars:AlertBar[]):boolean{
 const last=bars.at(-1);if(!last)return false;
 if(c.kind==='above')return last.close>c.value!;if(c.kind==='below')return last.close<c.value!;
 if(c.kind.startsWith('ema')){if(bars.length<c.period!)return false;let ema=bars[0].close;const a=2/(c.period!+1);for(const b of bars.slice(1))ema=a*b.close+(1-a)*ema;return c.kind==='ema_above'?last.close>ema:last.close<ema;}
 if(c.kind.startsWith('rsi')){const p=c.period!;if(bars.length<p+1)return false;let gain=0,loss=0;for(let i=1;i<=p;i++){const d=bars[i].close-bars[i-1].close;gain+=Math.max(0,d)/p;loss+=Math.max(0,-d)/p;}for(let i=p+1;i<bars.length;i++){const d=bars[i].close-bars[i-1].close;gain=(gain*(p-1)+Math.max(0,d))/p;loss=(loss*(p-1)+Math.max(0,-d))/p;}const rsi=loss===0?(gain===0?50:100):100-100/(1+gain/loss);return c.kind==='rsi_above'?rsi>c.value!:rsi<c.value!;}
 if(bars.length<=c.lookback!)return false;const prev=bars.slice(-c.lookback!-1,-1),high=Math.max(...prev.map(b=>b.high)),low=Math.min(...prev.map(b=>b.low));
 if(c.kind==='sweep_high')return last.high>high&&last.close<high;if(c.kind==='sweep_low')return last.low<low&&last.close>low;
 return c.kind==='break_high'?last.close>high:last.close<low;
}
export function evaluateAlert(rule:AlertRule,old:RuleState,bars:AlertBar[],now:number){
 const state={...old,latched:[...old.latched]},last=bars.at(-1),events:{key:string;time:number;matched:string[];stage:number;complete:boolean;price:number}[]=[];
 if(!last||state.finished||last.time<=state.lastBar||last.time+ALERT_TF[rule.timeframe]>now||now>=rule.expiresAt)return {state,events,matched:[] as string[]};
 if(state.lastBar&&last.time-state.lastBar>ALERT_TF[rule.timeframe]){state.stage=0;state.stageStarted=0;state.latched=[];}
 state.lastBar=last.time;
 if(rule.session){const time=new Intl.DateTimeFormat('en-GB',{timeZone:rule.session.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date((last.time+ALERT_TF[rule.timeframe])*1000));const {start,end}=rule.session;const inside=start<end?time>=start&&time<end:time>=start||time<end;if(!inside){state.stage=0;state.stageStarted=0;state.latched=[];return {state,events,matched:[]};}}
 const matched=rule.conditions.filter(c=>conditionMet(c,bars)).map(c=>c.id);let emit:string[]=[],complete=false;
 if(rule.mode==='stages'){
  if(state.stage===0&&last.time-state.lastSent<rule.cooldownSeconds)return {state,events,matched};
  if(state.stage&&last.time-state.stageStarted>rule.sequenceSeconds){state.stage=0;state.stageStarted=0;}
  const next=rule.conditions[state.stage];if(next&&matched.includes(next.id)){if(!state.stage)state.stageStarted=last.time;state.stage++;complete=state.stage===rule.conditions.length;if(rule.notifyStages||complete)emit=[next.id];}
 }else{const active=rule.mode==='all'?(matched.length===rule.conditions.length?['all']:[]):matched;emit=active.filter(id=>!state.latched.includes(id));state.latched=active;complete=rule.mode==='all'||matched.length===rule.conditions.length;}
 if(emit.length&&(rule.mode==='stages'||last.time-state.lastSent>=rule.cooldownSeconds)){events.push({key:last.time+':'+emit.join('-')+':'+state.stage,time:last.time,matched:emit,stage:state.stage,complete,price:last.close});state.lastSent=last.time;if(!rule.repeat&&(rule.mode!=='stages'||complete))state.finished=true;}
 if(rule.mode==='stages'&&complete){state.stage=0;state.stageStarted=0;}
 return {state,events,matched};
}
export function describeCondition(c:Condition){return `${c.id}: ${c.kind.replaceAll('_',' ')}${c.value!==undefined?' '+c.value:''}${c.period?' (period '+c.period+')':''}${c.lookback?' (previous '+c.lookback+' candles)':''}`;}
