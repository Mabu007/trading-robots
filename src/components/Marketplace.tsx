import {Dialog} from './Dialog';
import {useEffect,useState,type ReactNode} from 'react';
import {ArrowLeft} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import './marketplace.css';
const message=(e:unknown)=>e instanceof Error?e.message:'Request failed. Please retry.';
const Modal=({title,children,close}:{title:string;children:ReactNode;close:()=>void})=><Dialog title={title} onClose={close}>{children}</Dialog>;
function ValrBrokerDialog({client,onClose,onPropDAO}:{client:CloudClient;onClose:()=>void;onPropDAO:()=>void}){
 const [status,setStatus]=useState<any>(null),[apiKey,setApiKey]=useState(''),[apiSecret,setApiSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[activity,setActivity]=useState<{orders:any[];trades:any[]}|null>(null);
 const load=async()=>{setBusy(true);setError('');try{setStatus(await sharingRequest(client,'/api/valr/account'))}catch(e){setError(message(e))}finally{setBusy(false)}};
 useEffect(()=>{void load()},[client]);
 const connect=async()=>{setBusy(true);setError('');setNotice('');try{const result=await sharingRequest<any>(client,'/api/valr/account/connect','POST',{apiKey:apiKey.trim(),apiSecret:apiSecret.trim()});setStatus(result);setApiKey('');setApiSecret('');setNotice('VALR account verified. Return to Deploy and choose Demo or Live; live orders require your separate authorization.')}catch(e){setError(message(e))}finally{setBusy(false)}};
 const loadActivity=async()=>{setBusy(true);setError('');try{setActivity(await sharingRequest(client,'/api/valr/account/activity'))}catch(e){setError(message(e))}finally{setBusy(false)}};
 const disconnect=async()=>{setBusy(true);setError('');try{await sharingRequest(client,'/api/valr/account/disconnect','POST',{});setStatus({connected:false});setActivity(null);setNotice('Disconnected from Trading Vibes. Revoke the API key in VALR if you no longer need it. Existing positions remain open.')}catch(e){setError(message(e))}finally{setBusy(false)}};
 return <Modal title="Connect VALR" close={onClose}><div className="market-buttons"><button className="ghost" type="button" onClick={onPropDAO}>Manage PropDAO account</button></div><p>Connect your own VALR account. Create an API key with <strong>View access</strong> and <strong>Trade</strong> only; leave withdrawals, transfers and other permissions disabled.</p><p><a href="https://docs.valr.com/" target="_blank" rel="noreferrer">VALR API key guidance ↗</a> · VALR requires two-factor authentication to create keys.</p>{error&&<p className="share-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {status?.connected?<><div className="market-status"><strong>Account connected{status.label?` · ${status.label}`:''}</strong><span>Verified View access and Trade permissions</span></div><h3>Balances</h3>{status.balances?.length?status.balances.map((balance:any)=><div className="market-row" key={balance.currency}><strong>{balance.currency}</strong><span>{balance.available} available</span></div>):<p>No non-zero balances returned.</p>}<div className="market-buttons"><button className="ghost" disabled={busy} onClick={()=>void load()}>Refresh balances</button><button className="ghost" disabled={busy} onClick={()=>void loadActivity()}>Show orders & fills</button><button className="text-button" disabled={busy} onClick={()=>void disconnect()}>Disconnect</button></div>{activity&&<><h3>Open VALR orders</h3>{activity.orders.length?activity.orders.map((o:any,i:number)=><div className="market-row" key={o.orderId||i}><strong>{o.currencyPair} · {o.side||o.orderSide}</strong><span>{o.remainingQuantity} remaining · {o.price} · {o.status||o.orderStatusType}</span></div>):<p>No open orders.</p>}<h3>Recent VALR fills</h3>{activity.trades.length?activity.trades.map((t:any,i:number)=><div className="market-row" key={t.id||i}><strong>{t.currencyPair} · {t.side}</strong><span>{t.quantity} at {t.price}</span></div>):<p>No recent fills.</p>}<small>These are account-wide VALR records, including activity outside Trading Vibes.</small></>}</>:<><label>VALR API key<input disabled={busy} type="password" spellCheck={false} autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} /></label><label>VALR API secret<input disabled={busy} type="password" autoComplete="new-password" value={apiSecret} onChange={e=>setApiSecret(e.target.value)} /></label><div className="market-buttons"><button className="primary" disabled={busy||!/^[A-Za-z0-9]{64}$/.test(apiKey.trim())||!/^[A-Za-z0-9]{64}$/.test(apiSecret.trim())} onClick={()=>void connect()}>{busy?'Checking…':'Test and connect'}</button><button className="ghost" disabled={busy} onClick={()=>void load()}>Refresh</button></div><small>Keys are sent to the secure server and stored encrypted. Connecting does not place orders or enable trading.</small></>}
 </Modal>;
}
export function BrokerDialog({client,onClose,initialVenue='valr'}:{client:CloudClient;initialVenue?:'valr'|'propdao';shareId?:string;onClose:()=>void}) {
 const [venue,setVenue]=useState<'valr'|'propdao'>(initialVenue);
 return venue==='valr'?<ValrBrokerDialog client={client} onClose={onClose} onPropDAO={()=>setVenue('propdao')}/>:<PropDAOAccount client={client} onClose={onClose}/>;
}
function PropDAOAccount({client,onClose}:{client:CloudClient;onClose:()=>void}){
 const [key,setKey]=useState(''),[connected,setConnected]=useState(false),[accounts,setAccounts]=useState<{accountId:string;status:string}[]>([]),[selected,setSelected]=useState(''),[snapshot,setSnapshot]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const storageKey='trading-vibes:propdao:selected-account';
 const load=async()=>{setBusy(true);setError('');try{const result=await sharingRequest<any>(client,'/api/venues/propdao/accounts');const list=result.accounts||[];setConnected(result.connected);setAccounts(list);let saved='';try{saved=localStorage.getItem(storageKey)||''}catch{}setSelected(current=>list.some((a:any)=>a.accountId===current)?current:list.some((a:any)=>a.accountId===saved)?saved:'');}catch(e){setError(message(e))}finally{setBusy(false)}};
 useEffect(()=>{void load()},[client]);
 const connect=async()=>{setBusy(true);setError('');try{const result=await sharingRequest<any>(client,'/api/venues/propdao/connect','POST',{apiKey:key.trim()});setKey('');setConnected(true);setAccounts(result.accounts||[]);setNotice('Connected securely. Select your evaluation account, then save the selection.')}catch(e){setError(message(e))}finally{setBusy(false)}};
 const inspect=async(id:string)=>{setSelected(id);setSnapshot(null);if(!id)return;setBusy(true);setError('');try{setSnapshot(await sharingRequest(client,`/api/venues/propdao/accounts/${encodeURIComponent(id)}`))}catch(e){setError(message(e))}finally{setBusy(false)}};
 const disconnect=async()=>{setBusy(true);setError('');try{await sharingRequest(client,'/api/venues/propdao/disconnect','POST',{});try{localStorage.removeItem(storageKey)}catch{}setConnected(false);setAccounts([]);setSnapshot(null);setSelected('');setNotice('Disconnected. Any running robot must be stopped before reconnecting a key.')}catch(e){setError(message(e))}finally{setBusy(false)}};
 const save=()=>{if(!selected){setError('Select an account before saving.');return}try{localStorage.setItem(storageKey,selected)}catch{setError('Could not save this account selection on your device.');return}onClose()};
 return <Modal title="PropDAO account" close={onClose}>
  <p>Connect your PropDAO developer key to select an evaluation or funded account. Connecting alone never authorizes orders.</p>
  <p><a href="https://www.propdao.finance/docs" target="_blank" rel="noreferrer">Developer key instructions ↗</a></p>
  {error&&<p className="share-error" role="alert">{error}</p>}{notice&&<p className="market-status" role="status">{notice}</p>}
  {!connected?<><label>PropDAO developer key<input type="password" autoComplete="new-password" spellCheck={false} disabled={busy} value={key} placeholder="pd_live_…" onChange={e=>setKey(e.target.value)}/></label><div className="market-buttons"><button className="primary" disabled={busy||!key.trim()} onClick={()=>void connect()}>{busy?'Connecting…':'Connect account'}</button><button className="ghost" disabled={busy} onClick={onClose}>Cancel</button></div></>:
  <><div className="market-status"><strong>Connected · simulated-capital accounts</strong><span>Connection verified. No robot orders are authorized.</span></div>
   {accounts.length?<label>Account<select value={selected} disabled={busy} onChange={e=>void inspect(e.target.value)}><option value="">Choose account</option>{accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.accountId} · {a.status}</option>)}</select></label>:<p>No accounts found.</p>}
   {snapshot&&<div className="market-status"><strong>{snapshot.risk.breached?'Account breached':'Live evaluation snapshot'}</strong><span>Equity: ${Number(snapshot.risk.equity).toFixed(2)}</span><span>Risk room: ${Number(snapshot.risk.roomUsd).toFixed(2)}</span><span>Drawdown floor: ${Number(snapshot.risk.floor).toFixed(2)}</span><span>{snapshot.positions.length} open positions · {snapshot.orders.length} resting orders</span></div>}
   <div className="market-buttons"><button type="button" className="primary" disabled={busy||!selected} onClick={save}>Save account</button><button type="button" className="ghost" disabled={busy} onClick={()=>void load()}>Refresh</button><button type="button" className="text-button" disabled={busy} onClick={()=>void disconnect()}>Disconnect</button></div>
  </>}
 </Modal>;
}
export function PropDAODeployDialog({client,botId,onClose,onLog}:{client:CloudClient;botId:string;onClose:()=>void;onLog:(line:string)=>void}){
 const [accounts,setAccounts]=useState<{accountId:string;status:string}[]>([]);
 const [accountId,setAccountId]=useState(''),[riskUsd,setRiskUsd]=useState('2'),[leverage,setLeverage]=useState('1'),[confirmed,setConfirmed]=useState(false),[reconcileConfirmed,setReconcileConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState<any>(null);
 const load=async(accountOverride?:string)=>{setBusy(true);setError('');try{
  const accountsResult=await sharingRequest<any>(client,'/api/venues/propdao/accounts');
  const list=accountsResult.accounts||[];setAccounts(list);
  let saved='';try{saved=localStorage.getItem('trading-vibes:propdao:selected-account')||''}catch{}
  const preferred=list.some((a:any)=>a.accountId===accountOverride)?accountOverride!:list.some((a:any)=>a.accountId===accountId)?accountId:list.some((a:any)=>a.accountId===saved)?saved:'';
  const endpoint=`/api/venues/propdao/bots/${encodeURIComponent(botId)}/live${preferred?`?accountId=${encodeURIComponent(preferred)}`:''}`;
  const liveResult=await sharingRequest<any>(client,endpoint).then(data=>({data})).catch(reason=>({error:message(reason)}));
  const live='data'in liveResult?liveResult.data:{configured:false,error:liveResult.error,statusUnavailable:true};
  setStatus(live);
  setAccountId(preferred||live.accountId||'');
 }catch(e){setError(message(e))}finally{setBusy(false)}};
 useEffect(()=>{void load()},[client,botId]);
 const deploy=async()=>{
  if(!confirmed||!accountId)return;setBusy(true);setError('');
  try{
   const next=await sharingRequest<any>(client,`/api/venues/propdao/bots/${encodeURIComponent(botId)}/live`,'POST',{action:'deploy',accountId,riskUsd:Number(riskUsd),leverage:Number(leverage),confirm:'I AUTHORIZE PROPDAO SIMULATED LIVE TRADING'});
   onLog(`PropDAO live · deployment accepted · ${accountId}`);setStatus(next);onClose();
  }catch(e){setError(message(e))}finally{setBusy(false)}
 };
 const reconcile=async()=>{
  if(!reconcileConfirmed||!status?.pendingIntent)return;
  setBusy(true);setError('');
  try{
   await sharingRequest<any>(client,`/api/venues/propdao/bots/${encodeURIComponent(botId)}/live`,'POST',{action:'reconcile',accountId,confirm:'I VERIFIED PROPDAO HAS NO OPEN ORDERS OR POSITIONS'});
   setReconcileConfirmed(false);
   onLog('PropDAO · pending order reconciled against account positions and order history; authorization remains stopped.');
   await load();
  }catch(e){await load().catch(()=>undefined);setError(message(e))}
  finally{setBusy(false)}
 };
 const control=async(action:'pause'|'resume'|'stop')=>{
  setBusy(true);setError('');try{
   await sharingRequest(client,`/api/venues/propdao/bots/${encodeURIComponent(botId)}/live`,'POST',{action});
   onLog(action==='pause'?'PropDAO live · paused; existing positions remain open at PropDAO.':action==='resume'?'PropDAO live · resumed with authorized strategy and refreshed account checks.':'PropDAO live · permanently stopped and authorization revoked.');
   onClose();
  }catch(e){setError(message(e))}finally{setBusy(false)}
 };
 const selected=accounts.find(a=>a.accountId===accountId);
 return <Modal title="Deploy · PropDAO" close={onClose}>
  <p>Run your strategy against a PropDAO simulated-capital account using live market prices. This can fail your evaluation. Your developer key stays on the server.</p>
  {error&&<p className="share-error" role="alert">{error}</p>}
  <div className="market-status"><strong>{status?.pendingIntent?'Unresolved order · deployment locked':status?.running?'Running · LIVE':status?.paused?'Paused · authorized':status?.deployed?'Stopped · authorize to restart':status?.configured?'Runtime connected · ready to authorize':'Runtime not configured'}</strong><span>{status?.error||'Strategy scheduling uses a Cloudflare Durable Object. Stop disables new entries, not existing positions.'}</span></div>
  {status?.pendingIntent&&<div className="market-status" role="alert"><strong>Reconciliation required</strong><span>Intent: {status.pendingIntent.intentId||'Unknown'} · {status.pendingIntent.symbol||'Unknown symbol'}</span><span>Open your PropDAO terminal first and verify that no positions or resting orders remain. Reconciliation checks account history and two fresh snapshots; it never submits a new order or cancels an existing one.</span><label className="warning-remember"><input type="checkbox" checked={reconcileConfirmed} disabled={busy} onChange={e=>setReconcileConfirmed(e.target.checked)}/>I have checked the selected PropDAO account and it has no open positions or orders.</label><div className="market-buttons"><button type="button" className="ghost" disabled={busy||!reconcileConfirmed} onClick={()=>void reconcile()}>{busy?'Verifying…':'Reconcile pending order'}</button></div></div>}
  {status?.blockingBotId&&<p className="output-disclaimer">This account was previously deployed from bot {status.blockingBotId}. Its stored order intent is account-scoped.</p>}
  {accounts.length?<label>PropDAO account<select disabled={busy||Boolean(status?.running||status?.paused)} value={accountId} onChange={e=>{setAccountId(e.target.value);void load(e.target.value)}}><option value="">Choose account</option>{accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.accountId} · {a.status}</option>)}</select></label>:<p>Connect your PropDAO API key in Account settings before deploying.</p>}
  <div className="field-row"><label>Risk per trade (USDC)<select disabled={busy||Boolean(status?.running||status?.paused)} value={riskUsd} onChange={e=>setRiskUsd(e.target.value)}>{['0.5','1','2','3','5'].map(x=><option key={x} value={x}>${x}</option>)}</select></label><label>Leverage<select disabled={busy||Boolean(status?.running||status?.paused)} value={leverage} onChange={e=>setLeverage(e.target.value)}><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label></div>
  <p className="output-disclaimer">The runtime rejects a new order if account risk, existing exposure, market lot rules or protective stop/target checks fail. A stop-loss cannot guarantee a specific fill price.</p>
  {!status?.running&&!status?.paused&&<label className="warning-remember"><input type="checkbox" disabled={busy||!status?.configured} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I authorize automated orders on my selected simulated-capital PropDAO evaluation or funded account.</label>}
  <div className="market-buttons">{status?.running?<><button className="primary" disabled={busy} onClick={()=>void control('pause')}>{busy?'Pausing…':'Pause robot'}</button><button className="ghost" disabled={busy} onClick={()=>void control('stop')}>Stop permanently</button></>:status?.paused?<><button className="primary" disabled={busy||!status?.canResume} onClick={()=>void control('resume')}>{busy?'Resuming…':'Play · Resume robot'}</button><button className="ghost" disabled={busy} onClick={()=>void control('stop')}>Stop permanently</button></>:<button className="primary" disabled={busy||!status?.configured||Boolean(status?.pendingIntent)||Boolean(status?.statusUnavailable)||!selected||!['active','funded'].includes(selected.status)||!confirmed} onClick={()=>void deploy()}>{busy?'Authorizing…':'Deploy live robot'}</button>}<button className="ghost" disabled={busy} onClick={()=>void load()}>Refresh status</button><button className="ghost" disabled={busy} onClick={onClose}>Close</button></div>
 </Modal>;
}
export function DeploymentDialog({onClose}:{client:CloudClient;botId:string;onClose:()=>void;onBroker?:(privateBotId:string)=>void;onFollow?:()=>void;onLog?:(line:string)=>void;timeframe?:string}){
 return <Modal title="Deploy with VALR" close={onClose}><p>Open the robot in your workspace and choose Deploy to choose Demo or Live with VALR market data.</p><p>Choose Demo or Live from Deploy in your robot’s workspace. Live requires a verified VALR connection and runtime.</p><button className="primary" onClick={onClose}>Close</button></Modal>;
}
export function SubscriptionDialog({onClose}:{client:CloudClient;botId:string;onClose:()=>void}){
 return <Modal title="Use a robot" close={onClose}><p>Open a copy in your workspace to backtest or run it in paper mode using VALR market data.</p><p>Choose Demo or Live from Deploy in your robot’s workspace. Live requires a verified VALR connection and runtime.</p><button className="primary" onClick={onClose}>Close</button></Modal>;
}
export function MarketplaceDashboard({client,onBack,onBroker}:{client:CloudClient;mode:'creator'|'customer';onBack:()=>void;onBroker:()=>void;onDeploy:(id:string)=>void;onFollow:(id:string)=>void}){
 const [account,setAccount]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{setBusy(true);setError('');try{setAccount(await sharingRequest(client,'/api/valr/account'))}catch(e){setError(message(e))}finally{setBusy(false)}};
 useEffect(()=>{void load()},[client]);
 return <main className="profile-shell market-dashboard"><header className="profile-top"><button className="icon-button" aria-label="Back to profile" onClick={onBack}><ArrowLeft size={18}/></button><img className="brand-logo small" src="/logo.png" alt=""/><strong>My VALR account</strong></header><section className="market-dashboard-body"><h1>Your VALR account</h1><p>Connect your VALR API key, then choose Demo or Live from a robot’s workspace.</p>{error&&<p className="share-error" role="alert">{error}</p>}<div className="market-status"><strong>{account?.connected?'VALR connected':'VALR not connected'}</strong><span>Connecting does not enable live orders.</span></div><div className="market-buttons"><button className="primary" onClick={onBroker}>Manage VALR connection</button><button className="ghost" disabled={busy} onClick={()=>void load()}>Refresh</button></div></section></main>;
}
