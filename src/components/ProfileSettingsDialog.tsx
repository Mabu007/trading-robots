import {useState} from 'react';
import {LogOut,UserRound} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {readableFirebaseError} from '../firebase';
import {Dialog} from './Dialog';

export function ProfileSettingsDialog({client,cloudStatus,onClose,onChanged,onSignOut}:{client:CloudClient;cloudStatus:string;onClose:()=>void;onChanged:()=>void;onSignOut:()=>Promise<void>}){
 const profile=client.getProfile(),[displayName,setDisplayName]=useState(profile?.displayName||''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const save=async()=>{setBusy(true);setError('');setNotice('');try{await client.updateDisplayName(displayName.trim());setNotice('Profile saved.');onChanged()}catch(e){setError(readableFirebaseError(e))}finally{setBusy(false)}};
 const logout=async()=>{setBusy(true);setError('');try{await onSignOut()}catch(e){setError(readableFirebaseError(e));setBusy(false)}};
 return <Dialog title="Profile settings" onClose={onClose} busy={busy}>
  <div className="tv-profile-summary"><span><UserRound size={20}/></span><div><strong>{profile?.displayName||'Your profile'}</strong><small>{profile?.email||'Signed in'}</small></div></div>
  <p>Cloud sync: {cloudStatus==='connected'?'Connected':cloudStatus==='connecting'?'Connecting':cloudStatus==='error'?'Needs attention':'Unavailable'}</p>
  <label className="tv-profile-name">Display name<input maxLength={60} value={displayName} onChange={e=>setDisplayName(e.target.value)} autoComplete="name"/></label>
  {error&&<p role="alert" className="tv-skills-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="market-buttons"><button type="button" className="primary" disabled={busy||!displayName.trim()} onClick={()=>void save()}>{busy?'Saving…':'Save profile'}</button><button type="button" className="ghost" disabled={busy} onClick={()=>void logout()}><LogOut size={14}/> Sign out</button></div>
 </Dialog>;
}
