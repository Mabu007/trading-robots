import {useEffect,useState} from 'react';
import {Dialog} from './Dialog';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';

type Account={ctidTraderAccountId:string;isLive:boolean;brokerTitleShort?:string;traderLogin?:string};
const savedKey='trading-vibes:ctrader:selected-account';
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
export function CTraderDeployment({client,botId,onClose,onLog,onConnect}:{client:CloudClient;botId:string;onClose:()=>void;onLog:(line:string)=>void;onConnect:()=>void}){
 const [accounts,setAccounts]=useState<Account[]>([]),[accountId,setAccountId]=useState(()=>{try{return localStorage.getItem(savedKey)||''}catch{return ''}});
 const [status,setStatus]=useState<any>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [riskPercent,setRiskPercent]=useState('0.25'),[dailyLoss,setDailyLoss]=useState('2'),[drawdown,setDrawdown]=useState('5');
 const [spread,setSpread]=useState('0.15'),[slippage,setSlippage]=useState('0.1'),[commission,setCommission]=useState('0');
 const [confirmed,setConfirmed]=useState(false);
 const refresh=async()=>{
  setLoading(true);setError('');
  try{
   const [a,b]=await Promise.all([
    sharingRequest<{accounts:Account[];connected:boolean;scope:string}>(client,'/api/venues/ctrader/accounts'),
    sharingRequest<any>(client,'/api/venues/ctrader/bots/'+encodeURIComponent(botId)+'/live')
   ]);
   setAccounts(a.accounts||[]);setStatus(b);
   setAccountId(old=>(a.accounts||[]).some(x=>x.ctidTraderAccountId===old)?old:
    (a.accounts||[]).find(x=>x.ctidTraderAccountId===b.accountId)?.ctidTraderAccountId||
    (a.accounts||[])[0]?.ctidTraderAccountId||'');
  }catch(e){setError(message(e))}finally{setLoading(false)}
 };
 useEffect(()=>{void refresh()},[client,botId]);
 const action=async(value:'deploy'|'pause'|'resume'|'stop'|'reconcile')=>{
  setBusy(true);setError('');
  try{
   const input=value==='deploy'?{action:value,accountId,
    riskPercent:Number(riskPercent),maxDailyLossPercent:Number(dailyLoss),maxDrawdownPercent:Number(drawdown),
    maxSpreadPercent:Number(spread),maxSlippagePrice:Number(slippage),roundTripCommissionPerUnit:Number(commission),
    confirm:'I AUTHORIZE CTRADER AUTOMATED TRADING'}:{action:value};
   const result=await sharingRequest<any>(client,'/api/venues/ctrader/bots/'+encodeURIComponent(botId)+'/live','POST',input);
   onLog('cTrader · '+value+' · '+(value==='deploy'?'authorized for '+accountId:value==='reconcile'?'broker orders checked':'confirmed by the runtime'));
   if(value==='deploy'||value==='pause'||value==='resume'||value==='stop'){onClose();return}
   setStatus((prev:any)=>({...prev,...result}));await refresh();
  }catch(e){setError(message(e))}finally{setBusy(false)}
 };
 const account=accounts.find(a=>a.ctidTraderAccountId===accountId);
 const running=Boolean(status?.running),paused=Boolean(status?.paused);
 const riskDisabled=running||paused||busy||loading;
 const ready=Boolean(status?.connected&&status?.configured);
 return <Dialog title="Deploy · cTrader" onClose={onClose} busy={busy}>
  <p>Run an isolated JavaScript robot against your cTrader broker account. Every order is checked against broker bid/ask, margin, account-wide risk and protective-position reconciliation.</p>
  {error&&<div className="inline-error" role="alert">{error}</div>}
  <div className="market-status"><strong>{running?'Running · LIVE':paused?'Paused · protected positions monitored':status?.deployed?'Stopped · authorization required':ready?'Gateway connected':'Broker runtime not ready'}</strong>
   <span>{status?.error||'New entries require explicit account authorization.'}</span>
   {status?.lastEvaluation&&<span>Last signal: {status.lastEvaluation.action||'WAIT'} · {new Date(status.lastEvaluation.time).toLocaleTimeString()}</span>}
   {status?.pendingIntent&&<span>Order intent pending reconciliation; new trades are blocked</span>}
   {typeof status?.balance==='number'&&<span>Broker balance: {status.balance.toLocaleString(undefined,{maximumFractionDigits:2})} in deposit currency</span>}
   {Array.isArray(status?.positions)&&<span>{status.positions.length} open positions · {(status.orders||[]).length} pending broker orders</span>}
  </div>
  {!accounts.length?<div className="market-buttons"><button className="primary" disabled={busy} onClick={onConnect}>Connect cTrader ID</button><button className="ghost" onClick={()=>void refresh()}>Refresh</button></div>:<>
   <label>Broker account<select value={accountId} disabled={riskDisabled} onChange={e=>setAccountId(e.target.value)}>
    {accounts.map(a=><option value={a.ctidTraderAccountId} key={a.ctidTraderAccountId}>{a.brokerTitleShort||'cTrader'} · {a.isLive?'REAL':'DEMO'} · {a.traderLogin||a.ctidTraderAccountId}</option>)}
   </select></label>
   <div className="field-row">
    <label>Risk per trade<select value={riskPercent} onChange={e=>setRiskPercent(e.target.value)} disabled={riskDisabled}><option value="0.1">0.10%</option><option value="0.25">0.25%</option><option value="0.5">0.50%</option><option value="1">1.00%</option></select></label>
    <label>Max daily loss<select value={dailyLoss} onChange={e=>setDailyLoss(e.target.value)} disabled={riskDisabled}><option value="1">1%</option><option value="2">2%</option><option value="3">3%</option></select></label>
   </div>
   <div className="field-row">
    <label>Maximum drawdown<select disabled={riskDisabled} value={drawdown} onChange={e=>setDrawdown(e.target.value)}><option value="3">3%</option><option value="5">5%</option><option value="8">8%</option></select></label>
    <label>Max spread<select disabled={riskDisabled} value={spread} onChange={e=>setSpread(e.target.value)}><option value="0.05">0.05%</option><option value="0.1">0.10%</option><option value="0.15">0.15%</option><option value="0.25">0.25%</option></select></label>
   </div>
   <div className="field-row">
    <label>Slippage reserve (price units)<input type="number" disabled={riskDisabled} min="0.00001" step="0.01" value={slippage} onChange={e=>setSlippage(e.target.value)}/></label>
    <label>Additional round-trip commission per unit<input type="number" disabled={riskDisabled} min="0" step="0.01" value={commission} onChange={e=>setCommission(e.target.value)}/></label>
   </div>
   {!running&&!paused&&<label className="warning-remember"><input type="checkbox" disabled={!ready||busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I authorize automated {account?.isLive?'real-money':'demo'} cTrader trading, subject to stop-loss execution risk.</label>}
   {account?.isLive&&<p className="output-disclaimer">REAL BROKER ACCOUNT: Orders involve money and can slip beyond stops. Demo verification and explicit operator enablement are required before real trading is available.</p>}
   <div className="market-buttons">
    {running?<><button className="primary" disabled={busy} onClick={()=>void action('pause')}>Pause bot</button><button className="ghost" disabled={busy} onClick={()=>void action('stop')}>Stop bot</button></>:
     paused?<><button className="primary" disabled={busy||!ready} onClick={()=>void action('resume')}>Resume</button><button className="ghost" disabled={busy} onClick={()=>void action('stop')}>Stop</button></>:
     <button className="primary" disabled={busy||!ready||!confirmed||!accountId} onClick={()=>void action('deploy')}>{busy?'Deploying…':'Deploy '+(account?.isLive?'real-money':'demo')+' robot'}</button>}
    <button className="ghost" disabled={busy||!status?.deployed} onClick={()=>void action('reconcile')}>Reconcile trades</button>
    <button className="ghost" disabled={busy} onClick={()=>void refresh()}>Refresh status</button>
   </div>
  </>}
  {Array.isArray(status?.events)&&status.events.length>0&&<details><summary>Recent runtime events</summary><div className="market-status">{status.events.slice(-10).reverse().map((line:string,i:number)=><span key={i}>{line}</span>)}</div></details>}
 </Dialog>;
}
