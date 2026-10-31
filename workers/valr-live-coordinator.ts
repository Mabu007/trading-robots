import {sizeValrSpotBuy,type Snapshot,type Specification,type Limits} from '../shared/valr-risk';
import {reconcileSpotBuy,verifySpotProtection} from './valr-fill-reconciliation';

type Config={pair:string;limits:Omit<Limits,'authorized'>};
type Signal={id:string;candleClose:number;stopLoss:string;takeProfit:string};
type Market={baseCurrency:string;quoteCurrency:string;spec:Specification;account:Snapshot;takerFeeBps:number;protectiveSlippageBps:number};
type Phase='entry_pending'|'entry_unknown'|'unprotected'|'protection_pending'|'protection_unknown'|'protected';
type Active={botId:string;signalId:string;pair:string;entryId:string;protectionId:string;entryOrderId?:string;protectionOrderId?:string;quantity:string;limitPrice:string;stopLoss:string;takeProfit:string;baseCurrency:string;quoteCurrency:string;baseDecimalPlaces:number;minBaseAmount:string;minQuoteAmount:string;slippageBps:number;phase:Phase;protectableQuantity?:string;lastError?:string};
type State={bots:Record<string,{running:boolean;config:Config}>;active:Active|null};
type Storage={get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>};
type Provider={snapshot:(pair:string)=>Promise<Market>;submitEntry:(order:Active)=>Promise<{orderId:string}>;entrySummary:(order:Active)=>Promise<Record<string,unknown>|null>;submitProtection:(order:Active)=>Promise<{orderId:string}>;protectionStatus:(order:Active)=>Promise<Record<string,unknown>|null>};
const safeId=(v:string)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
async function orderIds(bot:string,signal:string){const bytes=new TextEncoder().encode(`valr-live-v1\0${bot}\0${signal}`);const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));const hex=[...hash].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,44);return {entryId:`tv-${hex}`,protectionId:`tp-${hex}`}}
// This coordinator is a testable safety component, not yet exposed by any
// route. A separate Durable Object must own one instance per VALR customer;
// all provider methods must use server-side credentials and verified data.
export class ValrLiveCoordinator {
 private tail:Promise<unknown>=Promise.resolve();private storage:Storage;private provider:Provider;private now:()=>number;
 constructor(storage:Storage,provider:Provider,now=Date.now){this.storage=storage;this.provider=provider;this.now=now}
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const result=this.tail.then(fn,fn);this.tail=result.catch(()=>{});return result}
 private async load():Promise<State>{return await this.storage.get<State>('live-account')??{bots:{},active:null}}
 private save(state:State){return this.storage.put('live-account',state)}
 async status(){return this.serial(()=>this.load())}
 async start(botId:string,config:Config,approved:boolean){return this.serial(async()=>{
  if(!safeId(botId)||approved!==true||!config||!/^[A-Z0-9]{3,30}$/.test(config.pair))throw Error('Explicit live authorization and a valid market are required');
  const state=await this.load();if(state.active?.botId===botId&&JSON.stringify(state.bots[botId]?.config)!==JSON.stringify(config))throw Error('Cannot change risk settings with an unresolved order or position');
  state.bots[botId]={running:true,config};await this.save(state);return state;
 })}
 async stop(botId:string){return this.serial(async()=>{if(!safeId(botId))throw Error('Invalid robot');const state=await this.load();if(state.bots[botId])state.bots[botId].running=false;await this.save(state);return state})}
 async submit(botId:string,signal:Signal){return this.serial(async()=>{
  const state=await this.load(),bot=state.bots[botId],now=this.now();
  if(!safeId(botId)||!bot?.running)throw Error('Robot is stopped');
  if(!signal||!safeId(signal.id)||!Number.isSafeInteger(signal.candleClose)||signal.candleClose>now+1000||signal.candleClose<now-120000)throw Error('Signal is stale or invalid');
  const ids=await orderIds(botId,signal.id),seenKey=`live-signal:${ids.entryId}`;
  if(await this.storage.get(seenKey)){if(state.active?.entryId===ids.entryId)return state;throw Error('Signal was already processed')}
  if(state.active)throw Error('Account has an unresolved order or position');
  const market=await this.provider.snapshot(bot.config.pair);
  if(!Number.isInteger(market.takerFeeBps)||market.takerFeeBps<0||market.takerFeeBps>1000||!Number.isInteger(market.protectiveSlippageBps)||market.protectiveSlippageBps<0||market.protectiveSlippageBps>500)throw Error('Verified fee or protective slippage is unavailable');
  const stopSlippage=Math.max(bot.config.limits.slippageBps,bot.config.limits.stopSlippageBps??0,market.protectiveSlippageBps);
  const size=sizeValrSpotBuy(signal,market.account,market.spec,{...bot.config.limits,feeBps:Math.max(bot.config.limits.feeBps,market.takerFeeBps),stopSlippageBps:stopSlippage,authorized:true},now);
  if(!market.baseCurrency||!market.quoteCurrency)throw Error('Market currencies are unavailable');
  const active:Active={botId,signalId:signal.id,pair:bot.config.pair,...ids,quantity:size.baseAmount,limitPrice:size.entryEstimate,stopLoss:size.stopLoss,takeProfit:size.takeProfit,baseCurrency:market.baseCurrency,quoteCurrency:market.quoteCurrency,baseDecimalPlaces:market.spec.baseDecimalPlaces,minBaseAmount:market.spec.minBaseAmount,minQuoteAmount:market.spec.minQuoteAmount,slippageBps:stopSlippage,phase:'entry_pending'};
  // The permanent marker precedes both the reservation and network submission.
  // A crash at any point can lose a signal but can never resend its order.
  await this.storage.put(seenKey,{botId,signalId:signal.id});state.active=active;await this.save(state);
  try{const result=await this.provider.submitEntry(active);if(typeof result?.orderId!=='string'||!result.orderId)throw Error('Missing acknowledgement');active.entryOrderId=result.orderId;active.phase='entry_unknown'}catch{active.phase='entry_unknown';active.lastError='Entry outcome is unknown; reconciling without resubmission'}
  await this.save(state);return state;
 })}
 async reconcile(){return this.serial(async()=>{
  const state=await this.load(),active=state.active;if(!active)return state;
  try{
   if(active.phase==='entry_pending'||active.phase==='entry_unknown'){
    const summary=await this.provider.entrySummary(active);if(!summary){active.lastError='Entry outcome is unknown; retrying reconciliation';await this.save(state);return state}
    const result=reconcileSpotBuy(summary,{pair:active.pair,customerOrderId:active.entryId,baseCurrency:active.baseCurrency,quoteCurrency:active.quoteCurrency,baseDecimalPlaces:active.baseDecimalPlaces,minBaseAmount:active.minBaseAmount,minQuoteAmount:active.minQuoteAmount,maxBaseAmount:active.quantity,limitPrice:active.limitPrice,stopLoss:active.stopLoss,slippageBps:active.slippageBps});
    if(!result.filled){state.active=null;await this.save(state);return state}
    active.protectableQuantity=result.protectableQuantity;active.phase='unprotected';active.lastError='Fill verified; protection is not yet confirmed';await this.save(state);
   }
   if(active.phase==='unprotected'){
    if(!state.bots[active.botId]?.running){active.lastError='Robot stopped with an unprotected fill; take action in VALR';await this.save(state);return state}
    active.phase='protection_pending';await this.save(state);
    try{const result=await this.provider.submitProtection(active);if(typeof result?.orderId!=='string'||!result.orderId)throw Error('Missing acknowledgement');active.protectionOrderId=result.orderId;active.phase='protection_unknown'}catch{active.phase='protection_unknown';active.lastError='Protection outcome is unknown; reconciling without resubmission'}
    await this.save(state);
   }
   if(active.phase==='protection_pending'||active.phase==='protection_unknown'||active.phase==='protected'){
    // A formerly placed conditional may have triggered, failed or been
    // cancelled. Never continue to report it as active without verification.
    active.phase='protection_unknown';
    const protection=await this.provider.protectionStatus(active);
    if(!protection){active.phase='protection_unknown';active.lastError='Protection has not been confirmed; inspect VALR';await this.save(state);return state}
    verifySpotProtection(protection,{pair:active.pair,customerOrderId:active.protectionId,quantity:active.protectableQuantity!,stopLoss:active.stopLoss,takeProfit:active.takeProfit});
    active.phase='protected';delete active.lastError;await this.save(state);
   }
  }catch(error){active.lastError=error instanceof Error?error.message.slice(0,250):'Reconciliation failed';await this.save(state)}
  return state;
 })}
}
