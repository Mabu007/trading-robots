import {useState} from 'react';
import {Dialog} from './Dialog';

export function PersonalityDialog({value,onSave,onClose}:{value:string;onSave:(value:string)=>Promise<void>;onClose:()=>void}){
 const [draft,setDraft]=useState(value),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const save=async()=>{setBusy(true);setError('');try{await onSave(draft);onClose()}catch(e){setError(e instanceof Error?e.message:'Could not save personality.')}finally{setBusy(false)}};
 return <Dialog title="AI personality" onClose={onClose} busy={busy}>
  <p>Tell your AI how you prefer it to communicate, teach and work with you.</p>
  <label className="tv-personality-label">Personality instructions<textarea autoFocus rows={9} maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="For example: Explain things simply, be direct, and ask before making changes."/></label>
  <small>{draft.length.toLocaleString()} / 4,000 characters · Leave empty to use the default personality.</small>
  {error&&<p className="tv-skills-error" role="alert">{error}</p>}
  <div className="market-buttons"><button type="button" className="primary" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save personality'}</button><button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button></div>
 </Dialog>;
}
