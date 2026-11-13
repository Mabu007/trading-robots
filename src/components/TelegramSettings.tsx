import {useCallback,useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,ExternalLink,RefreshCw,Send,ShieldCheck,Eye,EyeOff} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import './telegram-settings.css';
type Status={connected:boolean;configured:boolean;personalBot:string|null};
export function TelegramSettings({client,active}:{client:CloudClient|null;active:boolean}){
 const [status,setStatus]=useState<Status|null>(null);
 const [token,setToken]=useState(''),[confirm,setConfirm]=useState(false),[showToken,setShowToken]=useState(false),[link,setLink]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{if(client)setStatus(await sharingRequest<Status>(client,'/api/telegram/status'))},[client]);
 useEffect(()=>{if(!active||!client)return;void refresh().catch(()=>setError('Could not verify Telegram connection.'))},[active,client,refresh]);
 const act=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();await refresh()}catch(e){setError(e instanceof Error?e.message:'Telegram connection failed')}finally{setBusy(false)}};
 const saveBot=()=>void act(async()=>{if(!client||!confirm||!token.trim())throw Error('Paste a bot token and confirm webhook access first.');
  await sharingRequest(client,'/api/telegram/bot','POST',{token:token.trim(),confirm:true});
  setToken('');setConfirm(false);setLink('');setNotice('Bot connected. Now link your Telegram chat below.')});
 const createLink=()=>void act(async()=>{if(!client)throw Error('Sign in first');
  const data=await sharingRequest<{url:string}>(client,'/api/telegram/link','POST',{});
  if(!/^https:\/\/t\.me\//.test(data.url))throw Error('Invalid Telegram connection link');
  setLink(data.url);setNotice('Your link expires after 10 minutes. Open it, press Start, and refresh your status.')});
 return <section className="tv-telegram-settings" id="tv-telegram-settings" aria-label="Telegram connection">
  <header className="tv-telegram-header"><span className="tv-telegram-icon"><Send size={22}/></span><div><span className="tv-telegram-kicker">CONNECTED APP</span><h2>Telegram</h2><p>Receive a message whenever your market conditions match.</p></div><button className="tv-telegram-refresh" type="button" disabled={busy||!client} onClick={()=>void act(refresh)}><RefreshCw size={16}/> Refresh</button></header>
  {!client?<div className="tv-telegram-card">Sign in to connect Telegram.</div>:<>
  <div className={'tv-telegram-status'+(status?.connected?' is-connected':'')} role="status"><span><CheckCircle2 size={18}/></span><div><strong>{status?.connected?'Ready to receive signals':status?.personalBot?'Bot linked · chat not connected':'Not connected yet'}</strong><p>{status?.connected?'Your Telegram chat is connected to Trading Vibes.':status?.personalBot?'One more step: link your personal Telegram chat.':'Follow the steps below once. You will not need to enter your bot token again.'}</p></div></div>
  <div className="tv-telegram-steps">
   <section className="tv-telegram-card">
    <div className="tv-telegram-step-head"><span className="tv-telegram-step-number">1</span><div><h3>Create your Telegram bot</h3><p>Open BotFather in Telegram, use <strong>/newbot</strong>, then copy the token it gives you.</p></div></div>
    <a className="tv-telegram-link" href="https://t.me/BotFather" target="_blank" rel="noreferrer noopener">Open @BotFather <ExternalLink size={14}/></a>
   </section>
   <section className="tv-telegram-card">
    <div className="tv-telegram-step-head"><span className="tv-telegram-step-number">2</span><div><h3>Connect your bot</h3><p>Your token is stored encrypted and never shown again.</p></div></div>
    {status?.personalBot?<div className="tv-telegram-connected"><CheckCircle2 size={16}/><span>@{status.personalBot} connected</span></div>:
     <form className="tv-telegram-form" onSubmit={e=>{e.preventDefault();saveBot()}}><label htmlFor="tv-bot-token">Bot token</label><div className="tv-telegram-token"><input id="tv-bot-token" type={showToken?'text':'password'} autoComplete="off" placeholder="123456:ABC..." value={token} onChange={e=>setToken(e.target.value)} disabled={busy}/><button type="button" className="tv-telegram-icon-button" aria-label={showToken?'Hide token':'Show token'} onClick={()=>setShowToken(x=>!x)}>{showToken?<EyeOff size={16}/>:<Eye size={16}/>}</button></div>
      <label className="tv-telegram-checkbox"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> <span>Allow Trading Vibes to configure this bot's webhook for signal delivery.</span></label><button type="submit" className="tv-telegram-primary" disabled={busy||!token.trim()||!confirm}>{busy?'Connecting…':'Connect bot'} <ArrowRight size={16}/></button></form>}
   </section>
   <section className="tv-telegram-card">
    <div className="tv-telegram-step-head"><span className="tv-telegram-step-number">3</span><div><h3>Link your chat</h3><p>Open your personal invitation in Telegram and press <strong>Start</strong>.</p></div></div>
    {status?.connected?<div className="tv-telegram-connected"><CheckCircle2 size={16}/> Telegram chat linked successfully</div>:<div className="tv-telegram-connect-chat">
     {!link?<button type="button" className="tv-telegram-primary" disabled={busy||!status?.configured} onClick={createLink}>Generate chat link <ArrowRight size={16}/></button>:
     <a className="tv-telegram-primary" href={link} target="_blank" rel="noopener noreferrer">Open Telegram chat <ExternalLink size={15}/></a>}
     <button type="button" className="tv-telegram-secondary" disabled={busy} onClick={()=>void act(refresh)}><RefreshCw size={15}/> I've pressed Start — check connection</button>
    </div>}
   </section>
  </div>
  <div className="tv-telegram-footer"><ShieldCheck size={16}/><p>Alerts only. You control which signals are active from the Signals page.</p></div>
  {(status?.connected||status?.personalBot)&&<details className="tv-telegram-advanced"><summary>Connection management</summary><div>
   {status.connected&&<button type="button" className="tv-telegram-secondary" disabled={busy} onClick={()=>void act(async()=>{if(!client)throw Error('Sign in first');await sharingRequest(client,'/api/telegram/disconnect','POST',{});setLink('');setNotice('Telegram chat disconnected.')})}>Disconnect chat</button>}
   {status.personalBot&&<button type="button" className="tv-telegram-danger" disabled={busy} onClick={()=>void act(async()=>{if(!client||!window.confirm('Remove your Telegram bot and stop all further notifications?'))return;await sharingRequest(client,'/api/telegram/bot/disconnect','POST',{});setLink('');setNotice('Telegram bot removed.')})}>Remove bot</button>}
  </div></details>}
  {error&&<p className="tv-telegram-error" role="alert">{error}</p>}
  {notice&&<p className="tv-telegram-notice" role="status">{notice}</p>}
  </>}
 </section>;
}
