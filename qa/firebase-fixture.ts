import {starterCode} from '../src/strategy';
// Isolated local UI fixture. No credentials or provider data are used.
const profile={uid:'ui-fixture',email:'fixture@example.invalid',displayName:'UI Fixture',isAnonymous:false,emailVerified:true};
const conversations=new Map<string,{messages:any[];model:string|null;title:string}>();
const skills=new Map<string,any>(),analyses=new Map<string,any>();
let personality='';
const fixtureBot={id:'fixture-agent',name:'Gold research · UI fixture',asset:'GOLDUSDC',venue:'propdao',prompt:'UI fixture, no trading',code:starterCode,storageKey:'fixture'};
const bots=new Map<string,any>(new URLSearchParams(location.search).has('fixtureAgent')?[[fixtureBot.id,fixtureBot]]:[]);
export const firebaseConfigured=true;
export const readableFirebaseError=(e:any)=>e?.message||String(e);
export async function connectFirebase(){return {
 getProfile:()=>profile,getIdToken:async()=> 'ui-fixture-not-an-auth-token',
 listBots:async()=>[...bots.values()],saveBot:async(bot:any)=>{bots.set(bot.id,bot)},deleteBot:async(id:string)=>{bots.delete(id)},
 listVersions:async()=>[],loadChats:async()=>[],saveChats:async()=>{},
 loadConversation:async(id:string)=>conversations.get(id)?.messages||null,
 loadConversationRecord:async(id:string)=>conversations.get(id)||null,
 saveConversation:async(id:string,messages:any[])=>{const old=conversations.get(id);conversations.set(id,{messages,model:old?.model||null,title:old?.title||messages.find(m=>m.role==='user')?.content||'New conversation'})},
 listConversations:async()=>[...conversations].map(([id,v])=>({id,title:v.title,model:v.model})),
 renameConversation:async(id:string,title:string)=>{const item=conversations.get(id);if(item)item.title=title},
 deleteConversation:async(id:string)=>{conversations.delete(id)},
 selectConversationModel:async(id:string,model:string|null)=>{const item=conversations.get(id)||{messages:[],model:null,title:'New conversation'};item.model=model;conversations.set(id,item)},
 listSkills:async()=>[...skills.values()],saveSkill:async(s:any)=>{skills.set(s.id,s)},deleteSkill:async(id:string)=>{skills.delete(id)},
 loadPersonality:async()=>personality,savePersonality:async(value:string)=>{personality=value},
 listCodeAnalyses:async()=>[...analyses.values()],saveCodeAnalysis:async(a:any)=>{analyses.set(a.id,a)},deleteCodeAnalysis:async(id:string)=>{analyses.delete(id)},
 updateDisplayName:async(name:string)=>{profile.displayName=name},signOut:async()=>{},
};}
