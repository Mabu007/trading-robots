/** PWA prompt capture runs at page startup, before Firebase sign-in.
 * Browsers fire beforeinstallprompt only once per page; the signed-in UI
 * must not miss it while displaying the public landing/sign-in screens. */
export type AppInstallPrompt=Event&{
 prompt:()=>Promise<void>;
 userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
};
let pending:AppInstallPrompt|null=null;
const subscribers=new Set<(available:boolean)=>void>();
const notify=()=>subscribers.forEach(callback=>callback(Boolean(pending)));
if(typeof window!=='undefined'){
 window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();pending=event as AppInstallPrompt;notify();
 });
 window.addEventListener('appinstalled',()=>{pending=null;notify()});
}
export function subscribeInstallPrompt(callback:(available:boolean)=>void){
 subscribers.add(callback);
 callback(Boolean(pending));
 return()=>{subscribers.delete(callback)};
}
export async function requestAppInstall():Promise<'accepted'|'dismissed'|'unavailable'>{
 const event=pending;
 if(!event)return 'unavailable';
 pending=null;notify();
 try{await event.prompt();const choice=await event.userChoice;return choice.outcome==='accepted'?'accepted':'dismissed'}
 catch{return 'unavailable'}
}
export function isAppStandalone(){
 if(typeof window==='undefined')return false;
 return Boolean(window.matchMedia?.('(display-mode: standalone)').matches||
  (navigator as Navigator&{standalone?:boolean}).standalone===true);
}
export function installPlatform(userAgent:string):'ios'|'android'|'desktop'{
 return /iPad|iPhone|iPod/.test(userAgent)||(/Macintosh/.test(userAgent)&&/Mobile/.test(userAgent))?'ios':/Android/.test(userAgent)?'android':'desktop';
}
