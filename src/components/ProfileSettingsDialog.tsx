import {useEffect,useState} from 'react';
import {defaultTradingPreferences,type TradingPreferences} from '../conversation-workflow';
import {LogOut,UserRound} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {readableFirebaseError} from '../firebase';
import {Dialog} from './Dialog';

export function ProfileSettingsDialog({client,cloudStatus,onClose,onChanged,onSignOut,onPreferencesSaved}:{client:CloudClient;cloudStatus:string;onClose:()=>void;onChanged:()=>void;onSignOut:()=>Promise<void>;onPreferencesSaved?:(prefs:TradingPreferences)=>void}){
 const profile=client.getProfile(),[displayName,setDisplayName]=useState(profile?.displayName||''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const save=async()=>{setBusy(true);setError('');setNotice('');try{await client.updateDisplayName(displayName.trim());setNotice('Profile saved.');onChanged()}catch(e){setError(readableFirebaseError(e))}finally{setBusy(false)}};
 const [prefs,setPrefs]=useState<TradingPreferences>(defaultTradingPreferences),[prefsBusy,setPrefsBusy]=useState(false),[prefsNote,setPrefsNote]=useState('');
 useEffect(()=>{let active=true;client.loadTradingPreferences().then(saved=>{if(active)setPrefs(saved)}).catch(()=>{if(active)setPrefsNote('Could not read your trading preferences.')});return()=>{active=false}},[client]);
 const savePrefs=async()=>{
  setPrefsBusy(true);setPrefsNote('');
  try{await client.saveTradingPreferences(prefs);setPrefsNote('Trading preferences saved for future chats.');onPreferencesSaved?.(prefs)}
  catch(error){setPrefsNote('Could not save preferences: '+(error instanceof Error?error.message:'Unknown error'))}
  finally{setPrefsBusy(false)}
 };
 const logout=async()=>{setBusy(true);setError('');try{await onSignOut()}catch(e){setError(readableFirebaseError(e));setBusy(false)}};
 return <Dialog title="Profile settings" onClose={onClose} busy={busy}>
  <div className="tv-profile-summary"><span><UserRound size={20}/></span><div><strong>{profile?.displayName||'Your profile'}</strong><small>{profile?.email||'Signed in'}</small></div></div>
  <p>Cloud sync: {cloudStatus==='connected'?'Connected':cloudStatus==='connecting'?'Connecting':cloudStatus==='error'?'Needs attention':'Unavailable'}</p>
  <section className="tv-profile-preferences" aria-label="VIBES trading preferences">
   <h3>VIBES memory · Trading defaults</h3>
   <p>These are your preferred starting options for new robots and backtests—not permission to trade. You can override them in any conversation.</p>
   <label>Default market<input value={prefs.preferredAsset} maxLength={64} onChange={e=>setPrefs(p=>({...p,preferredAsset:e.target.value.toUpperCase().replace(/[^A-Z0-9_:.@-]/g,'')}))}/></label>
   <label>Preferred venue<select value={prefs.preferredVenue} onChange={e=>setPrefs(p=>({...p,preferredVenue:e.target.value as TradingPreferences['preferredVenue']}))}><option value="propdao">PropDAO</option><option value="hyperliquid">Hyperliquid</option><option value="valr">VALR</option><option value="ctrader">cTrader</option></select></label>
   <label>Execution timeframe<select value={prefs.preferredTimeframe} onChange={e=>setPrefs(p=>({...p,preferredTimeframe:e.target.value as TradingPreferences['preferredTimeframe']}))}><option value="m1">M1</option><option value="m5">M5</option><option value="m15">M15</option><option value="h1">H1</option></select></label>
   <label>Backtest default<select value={prefs.defaultBacktestDays} onChange={e=>setPrefs(p=>({...p,defaultBacktestDays:Number(e.target.value) as 7|30}))}><option value="7">Last 7 completed UTC days</option><option value="30">Last 30 completed UTC days</option></select></label>
   <label className="tv-preferences-opt"><input type="checkbox" checked={prefs.useDefaults} onChange={e=>setPrefs(p=>({...p,useDefaults:e.target.checked}))}/>Use these defaults to avoid repeated setup questions</label>
   {prefsNote&&<p role="status">{prefsNote}</p>}
   <button type="button" className="primary" disabled={prefsBusy||!prefs.preferredAsset} onClick={()=>void savePrefs()}>{prefsBusy?'Saving…':'Save trading preferences'}</button>
  </section>
  <label className="tv-profile-name">Display name<input maxLength={60} value={displayName} onChange={e=>setDisplayName(e.target.value)} autoComplete="name"/></label>
  {error&&<p role="alert" className="tv-skills-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="market-buttons"><button type="button" className="primary" disabled={busy||!displayName.trim()} onClick={()=>void save()}>{busy?'Saving…':'Save profile'}</button><button type="button" className="ghost" disabled={busy} onClick={()=>void logout()}><LogOut size={14}/> Sign out</button></div>
 </Dialog>;
}
