/* Routes public Hyperliquid info through a single Durable Object when configured.
   No fallback to an unshared fetch after the hub fails: source and rate semantics matter. */
const infoUrl='https://api.hyperliquid.xyz/info';
export function marketHubConfigured(env:NodeJS.ProcessEnv=process.env){
 return Boolean(env.MARKET_DATA_HUB_URL&&env.MARKET_DATA_HUB_SECRET&&env.MARKET_DATA_HUB_SECRET.length>=32);
}
export function marketHubScope(env:NodeJS.ProcessEnv=process.env){return marketHubConfigured(env)?'cross-instance-durable-object':'process-local-direct';}
export function hyperliquidFetch(request:typeof fetch=fetch,env:NodeJS.ProcessEnv=process.env):typeof fetch{
 return (async(url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  if(String(url)!==infoUrl||!marketHubConfigured(env))return request(url,init);
  const root=new URL(env.MARKET_DATA_HUB_URL!);
  if(root.protocol!=='https:')throw Error('Market data hub requires HTTPS');
  const destination=new URL('/v1/info',root);
  const headers=new Headers(init?.headers);
  headers.set('authorization','Bearer '+env.MARKET_DATA_HUB_SECRET);
  headers.set('content-type','application/json');
  return request(destination,{...init,method:'POST',headers,body:init?.body,signal:init?.signal??AbortSignal.timeout(11000)});
 }) as typeof fetch;
}

