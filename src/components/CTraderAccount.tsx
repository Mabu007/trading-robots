import {useEffect,useState} from 'react';
import {Dialog} from './Dialog';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';

const SELECTED='trading-vibes:ctrader:selected-account';
type Account={ctidTraderAccountId:string;isLive:boolean;brokerTitleShort?:string;traderLogin?:string};
export function CTraderAccount({client,onClose,initialError=''}:{client:CloudClient;onClose:()=>void;initialError?:string}){
 const [data,setData]=useState<{connected:boolean;accounts:Account[];scope?:string;gatewayConfigured?:boolean}>({connected:false,accounts:[]});
 const [selected,setSelected]=useState(()=>{try{return localStorage.getItem(SELECTED)||''}catch{return ''}});
 const [busy,setBusy]=useState(false),[error,setError]=useState(initialError),[notice,setNotice]=useState(''),[warming,setWarming]=useState(false),[cursor,setCursor]=useState(0);
 const [symbol,setSymbol]=useState('XAUUSD'),[markets,setMarkets]=useState<string[]>([]);
 const [snapshot,setSnapshot]=useState<{balance:number|null;moneyDigits:number|null;balanceCurrencyAssetId:string;positions:any[];orders:any[];snapshotAt:string}|null>(null);
 const load=async(preserveError=false)=>{setBusy(true);if(!preserveError)setError('');try{const a=await sharingRequest<typeof data>(client,'/api/venues/ctrader/accounts');setData(a);if(a.accounts?.length&&!a.accounts.some(x=>x.ctidTraderAccountId===selected))setSelected(a.accounts[0].ctidTraderAccountId)}catch(e){setError(String(e instanceof Error?e.message:e))}finally{setBusy(false)}};
 useEffect(()=>{void load(Boolean(initialError))},[client]);
 useEffect(()=>{if(!selected||!data.connected)return;let active=true;sharingRequest<{markets:{symbol:string}[]}>(client,'/api/venues/ctrader/markets?accountId='+encodeURIComponent(selected)).then(r=>{if(active){const items=r.markets.map(m=>m.symbol);setMarkets(items);setSymbol(previous=>items.includes(previous)?previous:items[0]||previous)}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Cannot load cTrader symbols')});return()=>{active=false}},[client,selected,data.connected]);
 const inspect=async()=>{if(!selected)return;setBusy(true);setError('');try{setSnapshot(await sharingRequest(client,'/api/venues/ctrader/snapshot?accountId='+encodeURIComponent(selected)))}catch(e){setError(e instanceof Error?e.message:'Cannot load account status')}finally{setBusy(false)}};
 const connect=async()=>{setError('');setBusy(true);try{const response=await sharingRequest<{url:string}>(client,'/api/venues/ctrader/oauth/start?scope=accounts');const target=new URL(response.url);if(target.origin!=='https://id.ctrader.com')throw Error('Invalid cTrader authorization URL');window.location.assign(target.href)}catch(e){setBusy(false);setError(e instanceof Error?e.message:'Cannot start cTrader OAuth')}};
 const save=()=>{if(!selected)return;try{localStorage.setItem(SELECTED,selected)}catch{setError('Cannot save account on this device');return}onClose()};
 const disconnect=async()=>{setBusy(true);try{await sharingRequest(client,'/api/venues/ctrader/disconnect','POST',{});localStorage.removeItem(SELECTED);setData({connected:false,accounts:[]});setSelected('');setMarkets([]);setSnapshot(null)}catch(e){setError(e instanceof Error?e.message:'Disconnect failed')}finally{setBusy(false)}};
 const warm=async()=>{if(!selected||!markets.includes(symbol))return;setWarming(true);setError('');setCursor(0);let processed=0;try{
  // Explicit foreground backfill, resumable by restarting this operation: cached days are skipped.
  while(processed<90){
   const r=await sharingRequest<{cursor:number;done:boolean}>(client,'/api/venues/ctrader/cache/warm','POST',{accountId:selected,asset:symbol,cursor:processed,days:2});
   if(r.cursor<=processed)throw Error('Archive did not advance');
   processed=r.cursor;setCursor(processed);if(r.done)break;
  }
  setNotice('90-day M1 cache scan completed for '+symbol+'. Closed broker days were archived in Cloudflare R2.');
 }catch(e){setError('Cache operation paused after '+processed+' days: '+(e instanceof Error?e.message:String(e)))}finally{setWarming(false)}};
 return <Dialog title="Connect cTrader" onClose={onClose}>
  <p>Authorize Trading Vibes through cTrader ID. Your broker password is never entered here. This connection requests view-only account access; trading requires separate authorization.</p>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {notice&&<p className="market-status">{notice}</p>}
  {!data.connected?<button className="primary" disabled={busy} onClick={()=>void connect()}>{busy?'Connecting…':'Connect cTrader ID'}</button>:<>
   <div className="market-status"><strong>cTrader connected</strong><span>{data.scope==='trading'?'Trading access granted':'View-only permissions'} · {data.accounts.length} account(s)</span></div>
   <label>Broker account<select value={selected} disabled={busy||warming} onChange={e=>setSelected(e.target.value)}>
    {data.accounts.map(a=><option key={a.ctidTraderAccountId} value={a.ctidTraderAccountId}>{a.brokerTitleShort||'cTrader broker'} · {a.isLive?'REAL':'DEMO'} · {a.traderLogin||a.ctidTraderAccountId}</option>)}
   </select></label>
   <div className="market-buttons"><button className="ghost" onClick={()=>void inspect()} disabled={busy||warming}>Refresh positions</button><button className="primary" onClick={save} disabled={!selected||warming}>Save account</button><button className="ghost" onClick={()=>void connect()} disabled={busy||warming}>Reauthorize</button><button className="ghost" onClick={()=>void disconnect()} disabled={busy||warming}>Disconnect</button></div>
   {snapshot&&<div className="market-status"><strong>Broker account snapshot · {new Date(snapshot.snapshotAt).toLocaleTimeString()}</strong><span>Balance: {snapshot.balance===null?'Unavailable':snapshot.balance.toLocaleString(undefined,{maximumFractionDigits:2})} · currency asset ID {snapshot.balanceCurrencyAssetId}</span><span>{snapshot.positions.length} open position(s) · {snapshot.orders.length} pending order(s)</span>{snapshot.positions.slice(0,8).map((p:any)=><span key={String(p.positionId)}>Position {String(p.positionId)} · symbol {String(p.tradeData?.symbolId||'?')} · SL {String(p.stopLoss??'none')} · TP {String(p.takeProfit??'none')}</span>)}</div>}
   <h3>90-day broker price archive</h3>
   <p>Archive the latest 90 days of broker M1 history to R2. Completed days are cached per broker account and symbol. The first fill requires cTrader; later backtests reuse cached days.</p>
   <label>Symbol<select value={symbol} onChange={e=>setSymbol(e.target.value)} disabled={warming}>{markets.length?markets.map(m=><option key={m}>{m}</option>):<option value="XAUUSD">XAUUSD</option>}</select></label>
   <button className="ghost" disabled={warming||busy||!markets.includes(symbol)||!data.gatewayConfigured} onClick={()=>void warm()}>{warming?'Caching… '+cursor+'/90 days':'Cache 90 days of M1'}</button>
   {warming&&<progress value={cursor} max={90} aria-label="M1 cache progress"/>}
   {!data.gatewayConfigured&&<p className="output-disclaimer">Cloudflare cTrader gateway is not configured. Broker history is unavailable until it is deployed.</p>}
  </>}
 </Dialog>;
}
