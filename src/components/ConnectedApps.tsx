import {useEffect,useMemo,useState} from 'react';
import {ArrowRight,Plug,RefreshCw,Search} from 'lucide-react';
import type {CloudClient} from '../firebase';
import {sharingRequest} from './BotSharing';
import './connected-apps.css';

type CatalogApp={slug:string;name?:string;provider:string;category:string};
type CatalogPage={apps:CatalogApp[];configured:boolean;nextCursor:string|null;warning?:string};
type ConnectedApp={slug:string;name:string;connected:boolean;connectedAccountId:string|null};
const labels:Record<string,string>={telegram:'Telegram',github:'GitHub',googledrive:'Google Drive',googlesheets:'Google Sheets',gmail:'Gmail',notion:'Notion',discord:'Discord'};
const descriptions:Record<string,string>={telegram:'Market alerts and bot notifications',github:'Store strategy code in your account',googledrive:'Your authorized documents',googlesheets:'Export trading reports',gmail:'Approved email actions',notion:'Strategy notes and lessons',discord:'Community notifications'};
export function ConnectedApps({client,active}:{client:CloudClient|null;active:boolean}){
 const [apps,setApps]=useState<CatalogApp[]>([]),[connections,setConnections]=useState<ConnectedApp[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [configured,setConfigured]=useState(false),[loading,setLoading]=useState(false);
 const [busy,setBusy]=useState(''),[search,setSearch]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(!active||!client){setConnections([]);return;}
  let cancelled=false;setLoading(true);setError('');
  void (async()=>{
    const catalog=await sharingRequest<CatalogPage>(client,'/api/apps/catalog');
    if(cancelled)return;
    setApps(catalog.apps);setCursor(catalog.nextCursor);setConfigured(catalog.configured);if(catalog.warning)setError(catalog.warning);
    if(catalog.configured){
      const data=await sharingRequest<{apps:ConnectedApp[]}>(client,'/api/apps/connections');
      if(!cancelled){
       setConnections(data.apps);
       setApps(previous=>[...new Map([...data.apps.map(app=>({slug:app.slug,provider:'composio',category:'connected-app'})),...previous].map(app=>[app.slug,app])).values()]);
      }
    }else setConnections([]);
  })().catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'App status unavailable');}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[client,active,revision]);
 const filtered=useMemo(()=>apps.filter(x=>(x.slug+' '+(labels[x.slug]||x.name||'')).toLowerCase().includes(search.trim().toLowerCase())),[apps,search]);
 const browse=async(lookup=false)=>{
  if(!client||!configured||busy)return;
  setBusy('catalogue');setError('');
  try{
   const path=lookup?'?search='+encodeURIComponent(search.trim()):'?cursor='+encodeURIComponent(cursor||'');
   const page=await sharingRequest<CatalogPage>(client,'/api/apps/catalog'+path);
   setApps(previous=>[...new Map([...previous,...page.apps].map(app=>[app.slug,app])).values()]);
   if(!lookup)setCursor(page.nextCursor);
   if(lookup&&!page.apps.length)setError('No matching app was found in the provider catalogue.');
  }catch(e){setError(e instanceof Error?e.message:'App catalogue unavailable');}
  finally{setBusy('')}
 };
 const start=async(slug:string)=>{
  if(!client||!configured||busy)return;
  setBusy(slug);setError('');
  try{
   const a=await sharingRequest<{redirectUrl:string}>(client,'/api/apps/connect','POST',{toolkit:slug});
   const target=new URL(a.redirectUrl);
   if(target.protocol!=='https:')throw Error('Invalid connection URL');
   window.location.assign(target.toString());
  }catch(e){setError(e instanceof Error?e.message:'Could not start authorization');setBusy('');}
 };
 return <section className="tv-connected-apps" aria-label="External connected apps">
  <header className="tv-connected-head"><div><h2>Connected Apps</h2><p>Connect your own external services. Trading brokers use separate native integrations.</p></div><button type="button" aria-label="Refresh connections" disabled={!client||loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/></button></header>
  <label className="tv-connected-search"><Search size={16}/><input aria-label="Search connected apps" placeholder="Search apps" value={search} onChange={e=>setSearch(e.target.value)}/></label>
  {!configured&&!loading&&<p className="tv-connected-notice">Composio is not configured; broker connections still work independently.</p>}
  {error&&<p role="alert" className="tv-connected-error">{error}</p>}
  <div className="tv-connected-grid">{filtered.map(app=>{const conn=connections.find(c=>c.slug===app.slug);
   return <article className="tv-connected-item" key={app.slug}><span className="tv-connected-icon"><Plug size={18}/></span><div className="tv-connected-copy"><h3>{labels[app.slug]||app.name||app.slug}</h3><p>{descriptions[app.slug]||'Connect an authorized app'}</p><small>{loading?'Checking…':conn?.connected?'Connected':configured?'Not connected':'Unavailable'}</small></div><button type="button" disabled={!configured||!client||loading||!!busy} onClick={()=>void start(app.slug)}>{busy===app.slug?'Connecting…':conn?.connected?'Connect another':'Connect'} <ArrowRight size={14}/></button></article>;
  })}</div>
  {configured&&search.trim()&&!filtered.length&&<button type="button" disabled={!!busy} onClick={()=>void browse(true)}>Find app in Composio</button>}
  {configured&&cursor&&<button type="button" disabled={!!busy} onClick={()=>void browse()}>Load more apps</button>}
 </section>;
}
