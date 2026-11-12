import {useCallback,useEffect,useState} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
type Status={connected:boolean;configured:boolean;personalBot:string|null};
export function TelegramSettings({client,active}:{client:CloudClient|null;active:boolean}){
 const [status,setStatus]=useState<Status|null>(null);
 const [token,setToken]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{if(client)setStatus(await sharingRequest<Status>(client,'/api/telegram/status'))},[client]);
 useEffect(()=>{if(!active||!client)return;void refresh().catch(()=>setError('Telegram status unavailable.'))},[active,client,refresh]);
 const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();await refresh()}catch(e){setError(e instanceof Error?e.message:'Telegram connection failed')}finally{setBusy(false)}};
 return <section className="tv-telegram-settings" id="tv-telegram-settings" aria-label="Telegram connection" style={{margin:'20px 0',padding:'22px',border:'1px solid var(--border, #383940)',borderRadius:16}}>
 <h2>Telegram signals</h2><p>Get BUY, SELL and setup-detected notifications when a tracker finds your conditions. Trading Vibes does not place broker orders.</p>
 {!client?<p>Sign in to connect Telegram.</p>:<>
 <p role="status">{status?.connected?'Telegram chat connected':status?.personalBot?'Your bot is ready. Connect your chat next.':'Connect a dedicated Telegram bot to receive signals.'}{status?.personalBot?' · @'+status.personalBot:''}</p>
 {!status?.personalBot&&<form onSubmit={e=>{e.preventDefault();void act(async()=>{await sharingRequest(client,'/api/telegram/bot','POST',{token,confirm:true});setToken('');setConfirm(false);setNotice('Telegram bot saved. Connect your chat below.')})}}>
  <label>BotFather token<input type="password" autoComplete="off" placeholder="Paste the token from @BotFather" value={token} onChange={e=>setToken(e.target.value)} disabled={busy}/></label>
  <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> I allow Trading Vibes to configure the webhook for my dedicated bot.</label>
  <button type="submit" disabled={busy||!token||!confirm}>Save bot securely</button>
 </form>}
 <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:14}}>
  {!status?.connected&&status?.configured&&<button disabled={busy} onClick={()=>void act(async()=>{const r=await sharingRequest<{url:string}>(client,'/api/telegram/link','POST',{});window.open(r.url,'_blank','noopener,noreferrer');setNotice('Open Telegram, tap Start, then refresh this status.')})}>Connect Telegram chat <ArrowRight size={14}/></button>}
  {status?.connected&&<button disabled={busy} onClick={()=>void act(async()=>{await sharingRequest(client,'/api/telegram/disconnect','POST',{});setNotice('Telegram chat disconnected.')})}>Disconnect chat</button>}
  {status?.personalBot&&<button disabled={busy} onClick={()=>void act(async()=>{if(!window.confirm('Disconnect your bot and stop further Telegram delivery?'))return;await sharingRequest(client,'/api/telegram/bot/disconnect','POST',{});setNotice('Telegram bot disconnected.')})}>Remove bot</button>}
  <button onClick={()=>void act(refresh)} disabled={busy}><RefreshCw size={14}/> Refresh status</button>
 </div>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </>}
 </section>;
}
