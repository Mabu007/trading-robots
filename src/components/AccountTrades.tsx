import {displayTime} from '../display-time';
import {useEffect,useState} from 'react';
import {Activity,ArrowRight,Link2,RefreshCw,Sparkles} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import './trading-desk.css';
import {PropDAOExecutionTimeline} from './PropDAOExecutionTimeline';
import type {ExecutionEvent} from '../../shared/propdao-execution-journal';

type Broker='propdao'|'valr'|'ctrader';
type Account={accountId:string;status:string};
type CTraderAccount={ctidTraderAccountId:string;isLive:boolean;brokerTitleShort?:string;traderLogin?:string};
type Row=Record<string,unknown>;
type PropActivity={account:{accountId:string};risk:Row;positions:Row[];orders:Row[];trades:Row[]|null;historyAvailable:boolean;historyLimit?:number;tradeHistoryError?:string|null;checkedAt:string};
type RobotActivity={accountId:string;events:ExecutionEvent[]|null;available:boolean;partial?:boolean;error?:string};
type ValrActivity={orders:Row[];trades:Row[]};
type CTraderActivity={positions:Row[];orders:Row[];trades:Row[]|null;balance:number|null;depositCurrency:string|null;checkedAt:string;historyHasMore:boolean|null};
type Col={label:string;keys:string[]};
const display=(row:Row,keys:string[])=>{
 const value=keys.map(k=>row[k]).find(v=>v!==undefined&&v!==null&&v!=='');
 if(value===undefined||value===null||typeof value==='object')return '—';
 if(['openedAt','closedAt','createdAt'].some(k=>keys.includes(k))&&typeof value==='number'&&value>0)
  return displayTime(value<1e11?value*1000:value);
 return typeof value==='number'&&Number.isFinite(value)?
  new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value):String(value);
};
const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?
 new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v):'—';
function Table({title,rows,columns,kind,onInspect}:{title:string;rows:Row[]|null;columns:Col[];kind:'position'|'pending'|'closed';onInspect:(kind:'position'|'pending'|'closed',data:Row)=>void}){
 return <section className="tv-desk-section" aria-label={title}><header className="tv-desk-section-heading"><div><h2>{title}</h2></div><span>{rows===null?'Unavailable':rows.length+' records'}</span></header><div className="tv-desk-table-wrap"><table className="tv-desk-table"><thead><tr>{columns.map(c=><th key={c.label}>{c.label}</th>)}<th>AI</th></tr></thead><tbody>{rows?.map((row,i)=><tr key={String(row.id||row.orderId||i)}>{columns.map(col=><td key={col.label}>{display(row,col.keys)}</td>)}<td><button type="button" className="tv-desk-inspect" onClick={()=>onInspect(kind,row)} aria-label={'Inspect '+title+' record '+(i+1)}><Sparkles size={14}/> Inspect</button></td></tr>)}</tbody></table>{rows===null?<p className="tv-desk-table-empty">This data could not be verified. Refresh to try again.</p>:rows.length===0?<p className="tv-desk-table-empty">No records reported.</p>:null}</div></section>;
}
const propPositions:Col[]=[{label:'Symbol',keys:['symbol']},{label:'Side',keys:['side']},{label:'Volume',keys:['qty']},{label:'Entry',keys:['entry']},{label:'Market',keys:['mark']},{label:'Stop',keys:['slPrice']},{label:'Target',keys:['tpPrice']},{label:'P/L',keys:['unrealizedPnl']}];
const propOrders:Col[]=[{label:'Symbol',keys:['symbol']},{label:'Side',keys:['side']},{label:'Volume',keys:['qty','quantity']},{label:'Price',keys:['price','limitPrice']},{label:'Type',keys:['type','orderType']},{label:'Status',keys:['status']}];
const propTrades:Col[]=[{label:'Symbol',keys:['symbol']},{label:'Side',keys:['side']},{label:'Volume',keys:['qty']},{label:'Entry',keys:['entry']},{label:'Exit',keys:['exit']},{label:'Fee',keys:['fee']},{label:'P/L',keys:['pnl']},{label:'Opened',keys:['openedAt']},{label:'Closed',keys:['closedAt']},{label:'Reason',keys:['reason']}];
const valrOrders:Col[]=[{label:'Market',keys:['currencyPair']},{label:'Side',keys:['side','orderSide']},{label:'Remaining',keys:['remainingQuantity']},{label:'Price',keys:['price']},{label:'Status',keys:['status','orderStatusType']}];
const valrTrades:Col[]=[{label:'Market',keys:['currencyPair']},{label:'Side',keys:['side']},{label:'Quantity',keys:['quantity']},{label:'Price',keys:['price']},{label:'Time',keys:['tradedAt']}];
const ctraderPositions:Col[]=[{label:'Symbol ID',keys:['symbolId']},{label:'Side',keys:['side']},{label:'Units',keys:['volume']},{label:'Entry',keys:['entry']},{label:'Stop',keys:['stop']},{label:'Target',keys:['target']}];
const ctraderOrders:Col[]=[{label:'Symbol ID',keys:['symbolId']},{label:'Side',keys:['side']},{label:'Units',keys:['volume']},{label:'Price',keys:['price']},{label:'Status',keys:['status']}];
const ctraderTrades:Col[]=[{label:'Symbol ID',keys:['symbolId']},{label:'Side',keys:['side']},{label:'Units',keys:['volume']},{label:'Price',keys:['price']},{label:'Time',keys:['time']}];
export function AccountTrades({client,active,revision,preferredPropAccountId,onPropAccountChanged,onConnect,onInspect}:{client:CloudClient|null;active:boolean;revision:number;preferredPropAccountId?:string;onPropAccountChanged?:()=>void;onConnect:()=>void;onInspect:(venue:Broker,kind:'position'|'pending'|'closed',record:Row)=>void}){
 const [journal,setJournal]=useState<RobotActivity|null>(null),[poll,setPoll]=useState(0);
 const [accounts,setAccounts]=useState<Account[]>([]),[valr,setValr]=useState(false),[ctraderAccounts,setCTraderAccounts]=useState<CTraderAccount[]>([]),[ctraderId,setCTraderId]=useState(''),[ctraderData,setCTraderData]=useState<CTraderActivity|null>(null),[venue,setVenue]=useState<Broker|'none'>('none'),[accountId,setAccountId]=useState(''),[propData,setPropData]=useState<PropActivity|null>(null),[valrData,setValrData]=useState<ValrActivity|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{if(!active||!client)return;let current=true;setLoading(true);setError('');setPropData(null);setJournal(null);setValrData(null);setCTraderData(null);
  void Promise.allSettled([sharingRequest<{connected:boolean;accounts:Account[]}>(client,'/api/venues/propdao/accounts'),sharingRequest<{connected:boolean}>(client,'/api/valr/account'),sharingRequest<{connected:boolean;accounts:CTraderAccount[]}>(client,'/api/venues/ctrader/accounts')]).then(([p,v,c])=>{
   if(!current)return;
   const list=p.status==='fulfilled'&&p.value.connected&&Array.isArray(p.value.accounts)?p.value.accounts:[],hasValr=v.status==='fulfilled'&&v.value.connected;
   const cList=c.status==='fulfilled'&&c.value.connected&&Array.isArray(c.value.accounts)?c.value.accounts:[];
   setAccounts(list);setValr(hasValr);setCTraderAccounts(cList);
   let savedC='';try{savedC=localStorage.getItem('trading-vibes:ctrader:selected-account')||''}catch{}
   setCTraderId(id=>cList.some(a=>a.ctidTraderAccountId===id)?id:cList.some(a=>a.ctidTraderAccountId===savedC)?savedC:cList[0]?.ctidTraderAccountId||'');
   let saved='';try{saved=localStorage.getItem('trading-vibes:propdao:selected-account')||''}catch{}
    if(preferredPropAccountId&&list.some(a=>a.accountId===preferredPropAccountId))saved=preferredPropAccountId;
   setAccountId(id=>preferredPropAccountId&&list.some(a=>a.accountId===preferredPropAccountId)?
     preferredPropAccountId:list.some(a=>a.accountId===id)?id:
     list.some(a=>a.accountId===saved)?saved:list[0]?.accountId||'');
   setVenue(existing=>existing==='propdao'&&list.length||existing==='valr'&&hasValr||existing==='ctrader'&&cList.length?existing:list.length?'propdao':hasValr?'valr':cList.length?'ctrader':'none');
   if(p.status==='rejected'&&v.status==='rejected'&&c.status==='rejected')setError('Broker connections could not be checked. Refresh to try again.');
  }).finally(()=>{if(current)setLoading(false)});
  return()=>{current=false};
 },[client,active,revision,refresh,preferredPropAccountId]);
 useEffect(()=>{if(!active)return;
   const timer=window.setInterval(()=>{if(!document.hidden)setPoll(x=>x+1)},30000);
   return()=>window.clearInterval(timer);
  },[active]);
 useEffect(()=>{if(!active||!client||venue==='none')return;let current=true;setError('');setPropData(null);setValrData(null);setCTraderData(null);
  if(venue==='propdao'&&accountId){
   void sharingRequest<PropActivity>(client,'/api/venues/propdao/accounts/'+encodeURIComponent(accountId)+'/activity')
    .then(value=>{if(current&&value.account?.accountId===accountId)setPropData(value)})
    .catch(e=>{if(current)setError(e instanceof Error?e.message:'Could not load PropDAO activity.')});
   void sharingRequest<RobotActivity>(client,'/api/venues/propdao/accounts/'+encodeURIComponent(accountId)+'/robot-activity')
    .then(value=>{if(current&&value.accountId===accountId)setJournal(value)})
    .catch(e=>{if(current)setJournal({accountId,available:false,events:null,
     error:e instanceof Error?e.message:'Could not verify Worker history'})});
  }
  if(venue==='valr')void sharingRequest<ValrActivity>(client,'/api/valr/account/activity').then(value=>{if(current)setValrData(value)}).catch(e=>{if(current)setError(e instanceof Error?e.message:'Could not load VALR activity.')});
  if(venue==='ctrader'&&ctraderId)void sharingRequest<CTraderActivity>(client,'/api/venues/ctrader/activity?accountId='+encodeURIComponent(ctraderId)).then(value=>{if(current)setCTraderData(value)}).catch(e=>{if(current)setError(e instanceof Error?e.message:'Could not load cTrader activity.')});
  return()=>{current=false};
 },[active,client,venue,accountId,ctraderId,revision,refresh,poll]);
 const checked=propData?.account?.accountId===accountId?propData:null;
 const history=journal?.accountId===accountId?journal:null;
 return <section className="tv-destination tv-trades-page tv-trading-desk" aria-labelledby="account-trades-title">
  <header className="tv-destination-heading tv-desk-heading"><div><span className="tv-destination-kicker"><Activity size={15}/> ACCOUNT ACTIVITY</span><h1 id="account-trades-title">Trades</h1><p>View activity reported by your connected broker.</p></div>{venue!=='none'&&<button type="button" className="tv-hub-secondary" onClick={onConnect}><Link2 size={15}/> Connect broker</button>}</header>
  {error&&<p className="tv-desk-warning" role="alert">{error}</p>}
  {loading?<p role="status">Checking broker connections…</p>:venue==='none'?<div className="tv-desk-connect"><Link2 size={23}/><h2>Connect your broker</h2><p>See your account activity and ask your AI about a trade.</p><button className="tv-hub-primary" onClick={onConnect}>Choose a broker <ArrowRight size={15}/></button></div>:<>
   <div className="tv-desk-account-strip"><label>Broker<select aria-label="Broker" value={venue} onChange={e=>setVenue(e.target.value as Broker)}>{accounts.length>0&&<option value="propdao">PropDAO</option>}{valr&&<option value="valr">VALR</option>}{ctraderAccounts.length>0&&<option value="ctrader">cTrader</option>}</select></label>{venue==='propdao'&&<label>Account<select aria-label="PropDAO account" value={accountId} onChange={e=>{setAccountId(e.target.value);onPropAccountChanged?.();try{localStorage.setItem('trading-vibes:propdao:selected-account',e.target.value)}catch{}}}>{accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.accountId} · {a.status}</option>)}</select></label>}{venue==='ctrader'&&<label>Account<select aria-label="cTrader account" value={ctraderId} onChange={e=>{setCTraderId(e.target.value);try{localStorage.setItem('trading-vibes:ctrader:selected-account',e.target.value)}catch{}}}>{ctraderAccounts.map(a=><option key={a.ctidTraderAccountId} value={a.ctidTraderAccountId}>{a.brokerTitleShort||'cTrader'} · {a.isLive?'Real':'Demo'} · {a.traderLogin||a.ctidTraderAccountId}</option>)}</select></label>}<button type="button" className="tv-hub-secondary" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={14}/> Refresh</button></div>
   {venue==='propdao'?<>{checked&&<p className="tv-desk-summary">Equity: {money(checked?.risk.equity)} · Risk room: {money(checked?.risk.roomUsd)} · As of {displayTime(checked.checkedAt)}</p>}<Table title="Open positions" rows={checked&&Array.isArray(checked.positions)?checked.positions:null} columns={propPositions} kind="position" onInspect={(kind,row)=>onInspect('propdao',kind,row)}/><Table title="Pending orders" rows={checked&&Array.isArray(checked.orders)?checked.orders:null} columns={propOrders} kind="pending" onInspect={(kind,row)=>onInspect('propdao',kind,row)}/>{checked?.tradeHistoryError&&<p role="alert" className="tv-desk-warning">Broker trade history unavailable: {checked.tradeHistoryError}. A failed history read does not mean no trades occurred.</p>}
  {history?.error&&<p className="tv-desk-warning" role="alert">Robot execution history: {history.error}</p>}
  <PropDAOExecutionTimeline events={history?.events??null} accountId={accountId}/>
  <p className="tv-desk-summary">Closed trades from PropDAO account {accountId} · latest {checked?.historyLimit||50} records. A position can open and close between refreshes.</p>
  <Table title="Trade history" rows={checked&&Array.isArray(checked.trades)?checked.trades.slice().sort((a,b)=>Number(b.closedAt||0)-Number(a.closedAt||0)):null} columns={propTrades} kind="closed" onInspect={(kind,row)=>onInspect('propdao',kind,row)}/></>:venue==='ctrader'?<>{ctraderData&&<p className="tv-desk-summary">Balance: {ctraderData.balance??'Unavailable'} {ctraderData.depositCurrency||''} · As of {new Date(ctraderData.checkedAt).toLocaleString()}</p>}<Table title="Open positions" rows={ctraderData&&Array.isArray(ctraderData.positions)?ctraderData.positions:null} columns={ctraderPositions} kind="position" onInspect={(kind,row)=>onInspect('ctrader',kind,row)}/><Table title="Pending orders" rows={ctraderData&&Array.isArray(ctraderData.orders)?ctraderData.orders:null} columns={ctraderOrders} kind="pending" onInspect={(kind,row)=>onInspect('ctrader',kind,row)}/><Table title="Recent deals · last 30 days" rows={ctraderData&&Array.isArray(ctraderData.trades)?ctraderData.trades:null} columns={ctraderTrades} kind="closed" onInspect={(kind,row)=>onInspect('ctrader',kind,row)}/>{ctraderData?.historyHasMore&&<p className="tv-desk-summary">More deals exist than shown.</p>}</>:<><p className="tv-desk-summary">VALR activity is account-wide, including activity outside Trading Vibes.</p><Table title="Open orders" rows={valrData&&Array.isArray(valrData.orders)?valrData.orders:null} columns={valrOrders} kind="pending" onInspect={(kind,row)=>onInspect('valr',kind,row)}/><Table title="Recent fills" rows={valrData&&Array.isArray(valrData.trades)?valrData.trades:null} columns={valrTrades} kind="closed" onInspect={(kind,row)=>onInspect('valr',kind,row)}/></>}
  </>}
 </section>;
}
