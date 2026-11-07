import {useMemo,useRef,useState} from 'react';
import {BookOpen,Check,FileText,Plus,Search,Sparkles,Trash2,Upload} from 'lucide-react';
import {MAX_SKILL_LENGTH,validateSkill,type UserSkill} from '../skills';
import {Dialog} from './Dialog';
import './skills-library.css';

type Props={skills:UserSkill[];busy:boolean;loading?:boolean;loadError?:string;onRetry?:()=>void;onSave:(s:UserSkill)=>Promise<void>;onDelete:(id:string)=>Promise<void>;onPersonality:()=>void};
const create=():UserSkill=>({id:'skill-'+crypto.randomUUID(),name:'',description:'',instructions:'',triggers:[],enabled:true,alwaysOn:false});
export function SkillsLibrary({skills,busy,loading=false,loadError,onRetry,onSave,onDelete,onPersonality}:Props){
 const [query,setQuery]=useState(''),[editing,setEditing]=useState<UserSkill|null>(null),[triggerInput,setTriggerInput]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false),[deleting,setDeleting]=useState<UserSkill|null>(null);
 const filtered=useMemo(()=>skills.filter(s=>(s.name+' '+s.description+' '+s.triggers.join(' ')).toLowerCase().includes(query.toLowerCase())),[skills,query]);
 const lock=useRef(false);
 const inputVersion=useRef(0);
 const unavailable=busy||working||loading||Boolean(loadError);
 const closeEditor=()=>{inputVersion.current++;setEditing(null);setError('')};
 const edit=(s:UserSkill)=>{inputVersion.current++;setEditing({...s});setTriggerInput(s.triggers.join(', '));setError('')};
 const save=async()=>{if(!editing||unavailable||lock.current)return;lock.current=true;setWorking(true);setError('');try{const skill=validateSkill({...editing,triggers:triggerInput.split(',').map(x=>x.trim()).filter(Boolean)});await onSave(skill);setEditing(null)}catch(e){setError(e instanceof Error?e.message:'Could not save skill')}finally{lock.current=false;setWorking(false)}};
 const remove=async()=>{if(!deleting||unavailable||lock.current)return;lock.current=true;setWorking(true);setError('');try{await onDelete(deleting.id);setDeleting(null)}catch(e){setError(e instanceof Error?e.message:'Could not delete skill')}finally{lock.current=false;setWorking(false)}};
 const toggle=async(skill:UserSkill)=>{
  if(unavailable||lock.current)return;
  lock.current=true;setWorking(true);setError('');
  try{await onSave({...skill,enabled:!skill.enabled})}
  catch(e){setError(e instanceof Error?e.message:'Could not update skill')}
  finally{lock.current=false;setWorking(false)}
 };
 return <section className="tv-skills-library" aria-labelledby="tv-skills-title"><header className="tv-skills-heading"><div><span className="tv-skills-eyebrow"><BookOpen size={14}/> PERSONAL AI SKILLS</span><h1 id="tv-skills-title">Your skills.</h1><p>Collect reusable guidance for the AI. Enabled skills apply automatically when their trigger phrases match your message.</p></div><button className="tv-skills-primary" onClick={()=>edit(create())} disabled={unavailable}><Plus size={16}/> New skill</button></header>
 <div className="tv-skills-toolbar"><label><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search skills…" aria-label="Search skills"/></label><span>{filtered.length} skills</span><button type="button" className="tv-personality-button" onClick={onPersonality} disabled={busy}><Sparkles size={15}/> Personality</button></div>
 <div className="tv-skills-grid">{filtered.map(s=><article className="tv-skill-card" key={s.id}><div className="tv-skill-card-top"><span className="tv-skill-icon"><FileText size={18}/></span><span className={'tv-skill-state '+(s.enabled?'enabled':'')}>{s.enabled?'Enabled':'Disabled'}</span></div><h2>{s.name}</h2><p>{s.description||'Reusable instructions for the AI.'}</p><div className="tv-skill-triggers">{s.alwaysOn?<span>Every message</span>:s.triggers.length?s.triggers.slice(0,3).map(t=><span key={t}>{t}</span>):<span>Only when named</span>}</div><footer><button type="button" onClick={()=>edit(s)} disabled={unavailable}>View / edit</button><label className="tv-skill-switch"><input type="checkbox" aria-label={'Enable '+s.name} checked={s.enabled} disabled={unavailable} onChange={()=>void toggle(s)}/><span>{s.enabled?'On':'Off'}</span></label><button type="button" className="tv-skill-delete" aria-label={'Delete '+s.name} title="Delete skill" onClick={()=>{setDeleting(s);setError('')}} disabled={unavailable}><Trash2 size={15}/></button></footer></article>)}
 {loading&&<p role="status">Loading your skills…</p>}
 {loadError&&<div className="tv-skills-load-error"><p role="alert" className="tv-skills-error">{loadError}</p><button type="button" onClick={onRetry} disabled={loading}>Retry loading skills</button></div>}
 {!filtered.length&&!loading&&!loadError&&<div className="tv-skills-empty"><Sparkles size={23}/><strong>{skills.length?'No matching skills':'Your skill library is empty'}</strong><p>Create a skill or import a .md/.txt instruction file. Skills are private to your account.</p><button type="button" disabled={unavailable} onClick={()=>edit(create())}>Create a skill</button></div>}</div>
 {error&&!editing&&!deleting&&<p role="alert" className="tv-skills-error">{error}</p>}
 {editing&&<Dialog title={skills.some(s=>s.id===editing.id)?'Edit skill':'New skill'} className="tv-skill-editor" busy={working} onClose={closeEditor}>
 <div className="tv-skill-form"><label>Name<input data-dialog-initial-focus maxLength={80} value={editing.name} placeholder="e.g. My trading research rules" onChange={e=>setEditing({...editing,name:e.target.value})}/></label><label>Description<input maxLength={240} value={editing.description} placeholder="What this skill helps with" onChange={e=>setEditing({...editing,description:e.target.value})}/></label><label>When to use (comma-separated phrases)<input value={triggerInput} onChange={e=>setTriggerInput(e.target.value)} placeholder="gold sentiment, market research, xauusd"/></label><label className="tv-skills-check"><input type="checkbox" checked={editing.alwaysOn} onChange={e=>setEditing({...editing,alwaysOn:e.target.checked})}/> Always include this skill (use sparingly)</label><label className="tv-skills-check"><input type="checkbox" checked={editing.enabled} onChange={e=>setEditing({...editing,enabled:e.target.checked})}/> Enabled</label><label>Instructions · Markdown or plain text<textarea rows={11} maxLength={MAX_SKILL_LENGTH} value={editing.instructions} placeholder="Explain how you want your AI to perform this task…" onChange={e=>setEditing({...editing,instructions:e.target.value})}/></label><div className="tv-skill-import"><label><Upload size={15}/> Import .md / .txt<input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={async e=>{
  const file=e.currentTarget.files?.[0];
  e.currentTarget.value='';
  if(!file)return;
  if(!/\.(?:md|txt)$/i.test(file.name)){setError('Choose a Markdown or plain-text file.');return}
  const version=++inputVersion.current;
  if(file.size>MAX_SKILL_LENGTH*4){setError('This file exceeds the skill character limit.');return}
  try{
   const instructions=(await file.text()).trim();
   if(inputVersion.current!==version)return;
   if(!instructions||instructions.length>MAX_SKILL_LENGTH){setError('Skill instructions must be 1–16,000 characters.');return}
   setEditing(prev=>prev?{...prev,name:prev.name||file.name.replace(/\.(md|txt)$/i,'').slice(0,80),instructions}:prev);
   setError('');
  }catch{if(inputVersion.current===version)setError('Could not read this file.')}
 }}/></label><small>{editing.instructions.length.toLocaleString()} / {MAX_SKILL_LENGTH.toLocaleString()} characters</small></div><p className="tv-skill-note">Skills guide replies and code proposals. VIBES shares its prompt space across up to three matching skills.</p>{error&&<p className="tv-skills-error" role="alert">{error}</p>}</div>
 <footer><button type="button" disabled={working} onClick={closeEditor}>Cancel</button><button type="button" className="tv-skills-primary" disabled={unavailable} onClick={()=>void save()}><Check size={15}/>{working?'Saving…':'Save skill'}</button></footer></Dialog>}
 {deleting&&<Dialog title={`Delete ${deleting.name}?`} role="alertdialog" className="tv-skill-delete-dialog" busy={working} onClose={()=>setDeleting(null)}><p>This removes the skill from your library and future AI prompts. Existing chat messages are not changed.</p>{error&&<p className="tv-skills-error" role="alert">{error}</p>}<footer><button onClick={()=>setDeleting(null)} disabled={working}>Cancel</button><button className="tv-skills-danger" onClick={()=>void remove()} disabled={unavailable}>{working?'Deleting…':'Delete skill'}</button></footer></Dialog>}
 </section>
}
