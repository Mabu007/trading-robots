import {starterCode} from '../src/strategy';
// UI-only fixture. Loaded solely by the explicit local smoke Vite configuration.
const profile={uid:'ui-fixture',email:'fixture@example.invalid',displayName:'UI Fixture',isAnonymous:false,emailVerified:true};
const conversations=new Map<string,any[]>();
export const firebaseConfigured=true;
export const readableFirebaseError=(e:any)=>e?.message||String(e);
export async function connectFirebase(){return {
 getProfile:()=>profile,getIdToken:async()=> 'ui-fixture-not-an-auth-token',listBots:async()=>new URLSearchParams(location.search).has('fixtureAgent')?[{id:'fixture-agent',name:'Gold research · UI fixture',asset:'GOLDUSDC',venue:'propdao',prompt:'UI fixture, no trading',code:starterCode}]:[],listVersions:async()=>[],
 loadChats:async()=>[],saveChats:async()=>{},loadConversation:async(id:string)=>conversations.get(id)||null,
 saveConversation:async(id:string,m:any[])=>{conversations.set(id,m)},listConversations:async()=>[...conversations].map(([id,m])=>({id,title:m[0]?.content||'Fixture'})),
};}
