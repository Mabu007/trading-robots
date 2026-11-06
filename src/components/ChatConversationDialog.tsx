import {useEffect,useState} from 'react';
import {Trash2,X} from 'lucide-react';
import './chat-conversation-dialog.css';

export type ConversationAction={type:'rename'|'delete';id:string;title:string};
export function ChatConversationDialog({action,onClose,onSubmit}:{action:ConversationAction|null;onClose:()=>void;onSubmit:(action:ConversationAction,title:string)=>Promise<void>}){
 const [name,setName]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setName(action?.title||'');setError('')},[action]);
 useEffect(()=>{if(!action||working)return;const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn)},[action,working,onClose]);
 if(!action)return null;
 const submit=async()=>{if(working)return;setWorking(true);setError('');try{await onSubmit(action,name);onClose()}catch(e){setError(e instanceof Error?e.message:'Could not update this chat.')}finally{setWorking(false)}};
 return <div className="tv-chat-dialog-overlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!working)onClose()}}><section className="tv-chat-dialog" role={action.type==='delete'?'alertdialog':'dialog'} aria-modal="true" aria-labelledby="tv-chat-dialog-title"><header><h2 id="tv-chat-dialog-title">{action.type==='rename'?'Rename chat':'Delete chat?'}</h2><button type="button" aria-label="Close" onClick={onClose} disabled={working}><X size={18}/></button></header>{action.type==='rename'?<label>Conversation name<input autoFocus maxLength={80} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void submit()}}/></label>:<p>Delete <strong>{action.title}</strong>? This removes its saved messages and settings. The action cannot be undone. Saved Code and Skills are not deleted.</p>}{error&&<p className="tv-chat-dialog-error" role="alert">{error}</p>}<footer><button type="button" onClick={onClose} disabled={working}>Cancel</button><button type="button" className={action.type==='delete'?'danger':'primary'} disabled={working||(action.type==='rename'&&!name.trim())} onClick={()=>void submit()}>{action.type==='delete'&&<Trash2 size={14}/>} {working?'Working…':action.type==='delete'?'Delete chat':'Save name'}</button></footer></section></div>;
}
