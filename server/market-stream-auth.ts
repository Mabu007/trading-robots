import {createHash,createHmac} from 'node:crypto';
/* A Firebase-authenticated caller receives a one-minute public-feed-only WS token.
   Worker verifies this independently; the internal service secret is never returned. */
export function mintMarketStreamProtocol(uid:string,secret:string,now:number=Date.now()):string{
 if(!uid||uid.length>150||secret.length<32)throw Error('Market stream authorization not configured');
 const payload=Buffer.from(JSON.stringify({
  version:1,scope:'public-market-only',
  sub:createHash('sha256').update(uid).digest('base64url'),
  expiresAt:now+60000
 })).toString('base64url');
 const signature=createHmac('sha256',secret).update(payload).digest('base64url');
 return 'tv-market-auth.'+payload+'.'+signature;
}

