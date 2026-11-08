import {Activity, ArrowRight, Bot, Clock3, ShieldAlert, Sparkles} from 'lucide-react';
import type {Venue} from '../../shared/venues';
import './trading-desk.css';

export type DeskTradeKind = 'position'|'pending'|'closed';
export type DeskTrade = {kind:DeskTradeKind;data:Record<string,unknown>};
type Props = {venue:Venue;name:string;asset:string;created:boolean;botId:string;propLive:any;liveAccount:any;liveCheck:string;paperStatus:any;onOpenStrategy:()=>void;onInspectTrade:(trade:DeskTrade)=>void};
const asNum=(v:unknown):number|null=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export const tradeNumber=(v:unknown,digits=2)=>{const n=asNum(v);return n===null?'—':new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n)};
export const tradeMoney=(v:unknown)=>{const n=asNum(v);return n===null?'—':(n>0?'+':'')+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)};
export const tradeDate=(v:unknown)=>{const n=asNum(v);if(n===null||n<=0)return '—';const date=new Date(n>1e11?n:n*1000);return Number.isNaN(date.getTime())?'—':date.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};
const side=(v:unknown)=>['BUY','LONG'].includes(String(v||'').toUpperCase())?'BUY':['SELL','SHORT'].includes(String(v||'').toUpperCase())?'SELL':'—';
const pnlClass=(v:unknown)=>{const n=asNum(v);return n===null?'':n<0?'loss':'gain'};
const rows=(v:unknown):any[]|null=>Array.isArray(v)?v:null;
function Inspect({kind,data,onInspectTrade}:{kind:DeskTradeKind;data:Record<string,unknown>;onInspectTrade:Props['onInspectTrade']}){
 return <button type="button" className="tv-desk-inspect" title="Inspect this trade with AI" aria-label={'Inspect '+kind+' '+String(data.symbol||'')+' '+String(data.id||'')+' with AI'} onClick={()=>onInspectTrade({kind,data})}><Sparkles size={15}/><span>Inspect</span></button>;
}
function SectionTitle({title,subtitle,total}:{title:string;subtitle:string;total:number|null}){
 return <header className="tv-desk-section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><span>{total===null?'Unavailable':String(total)+' '+(total===1?'record':'records')}</span></header>;
}
function Empty({value}:{value:string}){return <p className="tv-desk-table-empty">{value}</p>}
export function TradesHub(p:Props){
 const prop=p.venue==='propdao',verified=p.propLive?.brokerExposureVerified===true,open=verified?rows(p.propLive?.positions):null,pending=verified?rows(p.propLive?.pendingOrders):null,history=verified&&!p.propLive?.accountError?rows(p.propLive?.closedTrades)?.slice().sort((a,b)=>Number(b.closedAt||0)-Number(a.closedAt||0))??null:null;
 const valrState=p.liveAccount?.state?.bots?.[p.botId];
 const status=prop?(p.propLive?.uncertain?'Status unverified':p.propLive?.running?'Running':p.propLive?.paused?'Paused':p.propLive?.deployed?'Stopped':'Not deployed'):p.venue==='valr'?(p.liveCheck!=='ready'?'Status unavailable':valrState?.running?'Running':p.liveAccount?.state?.active?'Order in progress':p.liveAccount?.deployed?'Stopped':'Not deployed'):p.paperStatus?.state?.running?'Running · paper':'No verified live feed';
 const warning=prop?(p.propLive?.accountError||p.propLive?.error):p.venue==='valr'?p.liveAccount?.state?.active?.lastError:null;
 return <section className="tv-destination tv-trades-page tv-trading-desk" aria-labelledby="tv-trades-title">
  <header className="tv-destination-heading tv-desk-heading"><div><span className="tv-destination-kicker"><Activity size={15}/> ACCOUNT ACTIVITY</span><h1 id="tv-trades-title">Trades</h1><p>Open positions, pending orders, and verified trade history.</p></div>{p.created&&<button type="button" className="tv-hub-secondary" onClick={p.onOpenStrategy}>Open robot <ArrowRight size={14}/></button>}</header>
  {!p.created?<div className="tv-desk-empty-page"><Bot size={23}/><strong>Select a robot</strong><p>Open a saved robot to view its trading activity.</p></div>:<>
   <div className="tv-desk-account-strip"><div className="tv-desk-account-title"><span className="tv-desk-status-dot" data-state={status}/><div><strong>{p.name||'Current robot'}</strong><small>{p.asset||'No market'} · {p.venue.toUpperCase()} · {prop?String(p.propLive?.accountId||'Account not connected'):'Selected venue'}</small></div></div><span className="tv-desk-state">{status}</span>{prop&&<><div className="tv-desk-balance"><small>Account equity</small><strong>{tradeMoney(p.propLive?.risk?.equity)}</strong></div><div className="tv-desk-balance"><small>Risk room</small><strong>{tradeMoney(p.propLive?.risk?.roomUsd)}</strong></div></>}</div>
   {warning&&<p className="tv-desk-warning" role="alert"><ShieldAlert size={15}/>{String(warning)}</p>}
   {prop?<>
    <section className="tv-desk-section" aria-label="Open positions">
     <SectionTitle title="Open positions" subtitle="Provider-reported active exposure" total={open?.length??null}/>
     <div className="tv-desk-table-wrap"><table className="tv-desk-table"><thead><tr><th>Symbol</th><th>Side</th><th>Volume</th><th>Entry</th><th>Market</th><th>S/L</th><th>T/P</th><th>Floating P/L</th><th>AI</th></tr></thead><tbody>{open?.map((t:any,i:number)=><tr key={String(t.id||i)}><td className="tv-desk-symbol">{String(t.symbol||p.asset||'—')}</td><td><span className={'tv-desk-side '+side(t.side).toLowerCase()}>{side(t.side)}</span></td><td>{tradeNumber(t.qty,4)}</td><td>{tradeNumber(t.entry,5)}</td><td>{tradeNumber(t.mark,5)}</td><td>{tradeNumber(t.slPrice,5)}</td><td>{tradeNumber(t.tpPrice,5)}</td><td className={'tv-desk-pnl '+pnlClass(t.unrealizedPnl)}>{tradeMoney(t.unrealizedPnl)}</td><td><Inspect kind="position" data={t} onInspectTrade={p.onInspectTrade}/></td></tr>)}</tbody></table>{!open?.length&&<Empty value={open===null?'Position data has not been verified yet.':'No open positions reported by PropDAO.'}/>}</div>
    </section>
    <section className="tv-desk-section" aria-label="Pending orders">
     <SectionTitle title="Pending orders" subtitle="Resting orders reported by the broker" total={pending?.length??null}/>
     <div className="tv-desk-table-wrap"><table className="tv-desk-table"><thead><tr><th>Symbol</th><th>Side</th><th>Order type</th><th>Volume</th><th>Price</th><th>Status</th><th>AI</th></tr></thead><tbody>{pending?.map((t:any,i:number)=><tr key={String(t.id||i)}><td className="tv-desk-symbol">{String(t.symbol||p.asset||'—')}</td><td><span className={'tv-desk-side '+side(t.side).toLowerCase()}>{side(t.side)}</span></td><td>{String(t.type||'—')}</td><td>{tradeNumber(t.qty,4)}</td><td>{tradeNumber(t.price,5)}</td><td><span className="tv-desk-order-state">{String(t.status||'Unknown')}</span></td><td><Inspect kind="pending" data={t} onInspectTrade={p.onInspectTrade}/></td></tr>)}</tbody></table>{!pending?.length&&<Empty value={pending===null?'Pending-order data has not been verified yet.':'No pending provider orders reported.'}/>}</div>
     {p.propLive?.pendingIntent&&<p className="tv-desk-warning" role="alert"><ShieldAlert size={15}/>Unresolved order intent: {String(p.propLive.pendingIntent.intentId||'unknown')}. This is not a confirmed provider order. Reconcile it before redeploying.</p>}
    </section>
    <section className="tv-desk-section tv-desk-history" aria-label="Trade history">
     <SectionTitle title="Trade history" subtitle="Provider-reported closed trades · newest first" total={history?.length??null}/>
     <div className="tv-desk-table-wrap"><table className="tv-desk-table"><thead><tr><th>Close time</th><th>Symbol</th><th>Side</th><th>Volume</th><th>Entry</th><th>Exit</th><th>Fees</th><th>Realized P/L</th><th>Reason</th><th>AI</th></tr></thead><tbody>{history?.map((t:any,i:number)=><tr key={String(t.id||i)}><td className="tv-desk-date">{tradeDate(t.closedAt)}</td><td className="tv-desk-symbol">{String(t.symbol||p.asset||'—')}</td><td><span className={'tv-desk-side '+side(t.side).toLowerCase()}>{side(t.side)}</span></td><td>{tradeNumber(t.qty,4)}</td><td>{tradeNumber(t.entry,5)}</td><td>{tradeNumber(t.exit,5)}</td><td>{tradeMoney(t.fee)}</td><td className={'tv-desk-pnl '+pnlClass(t.pnl)}>{tradeMoney(t.pnl)}</td><td>{String(t.reason||'—')}</td><td><Inspect kind="closed" data={t} onInspectTrade={p.onInspectTrade}/></td></tr>)}</tbody></table>{!history?.length&&<Empty value={history===null?'Trade history has not been verified yet.':'No completed trades reported for this account.'}/>}</div>
    </section>
   </>:<section className="tv-desk-section" aria-label="Execution status"><SectionTitle title="Live execution" subtitle="The selected venue does not supply a complete verified trade ledger to this screen." total={null}/><div className="tv-desk-empty-page"><Clock3 size={20}/><p>{p.venue==='valr'&&p.liveCheck==='ready'?'VALR status is connected, but verified account positions, pending orders and trade history are not yet exposed here.':'No verified account trade tables are available for '+p.venue.toUpperCase()+'.'}</p>{p.liveAccount?.state?.active&&<p>Execution phase: {String(p.liveAccount.state.active.phase||'unknown')} · Order ID: {String(p.liveAccount.state.active.orderId||'not reported')}</p>}</div></section>}
  </>}
 </section>;
}
