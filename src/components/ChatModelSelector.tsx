import {useEffect,useMemo,useRef,useState} from 'react';
import {Bot,Check,ChevronDown,Search,Settings2} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import './chat-model-selector.css';

type Model={id:string;name:string;pricing?:{prompt?:string;completion?:string}};
type Props={client:CloudClient|null;selected:string|null;onSelect:(model:string|null)=>Promise<void>;onSettings:()=>void;disabled:boolean};
const short=(id:string)=>id.split('/').at(-1)?.replace(/:free$/,'')||id;
const DEFAULT_MODEL='baidu/ernie-5.5-flash-preview:free';
export function ChatModelSelector({client,selected,onSelect,onSettings,disabled}:Props){
 const [open,setOpen]=useState(false),[models,setModels]=useState<Model[]>([]),[defaultModel,setDefaultModel]=useState<string|null>(null),[search,setSearch]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const wrapper=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{if(!open)return;const onDown=(e:PointerEvent)=>{if(wrapper.current&&!wrapper.current.contains(e.target as Node))setOpen(false)};const onEscape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};document.addEventListener('pointerdown',onDown);document.addEventListener('keydown',onEscape);return()=>{document.removeEventListener('pointerdown',onDown);document.removeEventListener('keydown',onEscape)}},[open]);
 useEffect(()=>{if(!open||!client)return;let live=true;setLoading(true);setError('');Promise.all([sharingRequest<{models:Model[]}>(client,'/api/openrouter/models'),sharingRequest<{connected:boolean;model?:string}>(client,'/api/openrouter/account')]).then(([list,account])=>{if(!live)return;setModels(list.models||[]);setDefaultModel(account.model||DEFAULT_MODEL);if(!account.connected)setError('Connect your OpenRouter account to use a model.')}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Models are unavailable.')}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[open,client]);
 const matches=useMemo(()=>models.filter(m=>(m.name+' '+m.id).toLowerCase().includes(search.toLowerCase())).slice(0,90),[models,search]);
 const choose=async(id:string|null)=>{if(saving)return;setSaving(true);setError('');try{await onSelect(id);setOpen(false);setSearch('')}catch(e){setError(e instanceof Error?e.message:'Could not select model')}finally{setSaving(false)}};
 return <div className="tv-model-picker" ref={wrapper}><button type="button" className="tv-model-trigger" disabled={disabled} aria-expanded={open} aria-label={'AI model: '+(selected||'account default')} title="Choose a model for this chat" onClick={()=>setOpen(v=>!v)}><Bot size={16}/><span>{selected?short(selected):'AI model'}</span><ChevronDown size={13}/></button>
 {open&&<section className="tv-model-panel" role="dialog" aria-label="Select model for this chat"><div className="tv-model-panel-head"><strong>AI for this chat</strong><span>Only this conversation changes</span></div><label className="tv-model-search"><Search size={15}/><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search OpenRouter models" placeholder="Search models…"/></label><div className="tv-model-options"><button type="button" className="tv-model-option" disabled={saving} onClick={()=>void choose(null)}><div><strong>Account default</strong><small>{defaultModel||'Choose in Apps → OpenRouter AI'}</small></div>{selected===null&&<Check size={16}/>}</button>{loading?<p className="tv-model-info">Loading available models…</p>:matches.map(m=><button type="button" key={m.id} className="tv-model-option" disabled={saving} onClick={()=>void choose(m.id)}><div><strong>{m.name||short(m.id)}</strong><small>{m.id}{m.id.endsWith(':free')?' · Free-tier model':''}</small></div>{selected===m.id&&<Check size={16}/>}</button>)}{!loading&&!matches.length&&<p className="tv-model-info">No matching models available.</p>}</div>{error&&<p className="tv-model-error" role="alert">{error}</p>}<footer><button onClick={()=>{setOpen(false);onSettings()}}><Settings2 size={14}/> Manage OpenRouter</button></footer></section>}
 </div>;
}
