/* Worker-side public feed token validation, with constant-time HMAC comparison. */
export async function verifyStreamProtocol(header:string,secret:string,now:number=Date.now()):Promise<boolean>{
 if(!secret||secret.length<32||header.length>2048)return false;
 const value=header.split(',').map(x=>x.trim()).find(x=>x.startsWith('tv-market-auth.'));
 if(!value)return false;
 const parts=value.split('.');
 if(parts.length!==3||!/^[A-Za-z0-9_-]{1,512}$/.test(parts[1])||!/^[A-Za-z0-9_-]{20,90}$/.test(parts[2]))return false;
 let payload:any;
 try {payload=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return false;}
 if(payload?.version!==1||payload.scope!=='public-market-only'||typeof payload.sub!=='string'||!Number.isSafeInteger(payload.expiresAt)
   ||payload.expiresAt<=now||payload.expiresAt>now+60000)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const actual=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(parts[1])));
 // base64url from a fixed SHA-256 output
 const expected=btoa(String.fromCharCode(...actual)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 if(expected.length!==parts[2].length)return false;
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^parts[2].charCodeAt(i);
 return diff===0;
}

