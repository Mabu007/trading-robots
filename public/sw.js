// Network-only: never cache authenticated pages, API responses or credentials.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Push transport is staged; subscription UI remains disabled until a sender is verified.
// Notifications carry no account balances, orders, keys or approval actions.
self.addEventListener('push',event=>{
 event.waitUntil(self.registration.showNotification('Trading Vibes',{body:'An agent update is available. Open Trading Vibes to verify its current status.',icon:'/logo.png',tag:'agent-update',data:{url:'/'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
  const existing=windows.find(w=>new URL(w.url).origin===self.location.origin);
  return existing?existing.focus():self.clients.openWindow('/');
 }));
});
