// The caller must verify this bearer token and uid first. Firestore applies the
// user's own security rules; this is a read-only fallback when admin IAM is not
// configured, and never grants access to marketplace or other users' records.
export async function readOwnedBotAsset(uid:string,id:string,authorization:string|undefined,request:typeof fetch=fetch,project=process.env.FIREBASE_PROJECT_ID||process.env.VITE_FIREBASE_PROJECT_ID||''){
 if(!/^[a-z0-9][a-z0-9-]{4,61}[a-z0-9]$/.test(project)||!uid||uid.length>128||! /^[A-Za-z0-9_-]{1,100}$/.test(id)||!/^Bearer\s+[^\s]+$/i.test(authorization||''))throw Error('Could not verify saved robot.');
 const url=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/users/${encodeURIComponent(uid)}/bots/${encodeURIComponent(id)}`;
 let response:Response;try{response=await request(url,{headers:{Authorization:authorization!},signal:AbortSignal.timeout(10000)})}catch{throw Error('Could not verify saved robot.')}
 if(response.status===404)return null;if(!response.ok)throw Error('Could not verify saved robot.');
 const data=await response.json() as {fields?:{asset?:{stringValue?:unknown}}};const asset=data.fields?.asset?.stringValue;if(typeof asset!=='string'||! /^[A-Z0-9]{3,30}$/.test(asset))throw Error('Saved robot market is invalid.');return {asset};
}
