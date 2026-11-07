/* One global DO per Hyperliquid network: cross-instance cache, pacing and fanout.
   This Worker is intentionally PUBLIC MARKET DATA ONLY: no user data, accounts or orders. */
type Env={MARKET_HUB:DurableObjectNamespace};
type Item={expires:number;body:string};
type Subscription={type:string;coin?:string;interval?:string;dex?:string};
type WsClient=WebSocket & {serializeAttachment(value:unknown):void;deserializeAttachment():unknown};
const upstream='https://api.hyperliquid.xyz/info', wsUrl='wss://api.hyperliquid.xyz/ws';
const identifier=/^[A-Za-z0-9@._:/-]{1,64}$/, dex=/^[A-Za-z0-9_-]{0,24}$/;
const intervals=new Set(['1m','3m','5m','15m','30m','1h','2h','4h','8h','12h','1d','3d','1w','1M']);
const types=new Set(['perpDexs','meta','metaAndAssetCtxs','spotMeta','spotMetaAndAssetCtxs','allMids','l2Book','recentTrades','candleSnapshot','fundingHistory']);
function valid(body:any):boolean{
 if(!body||typeof body!=='object'||Array.isArray(body)||!types.has(body.type))return false;
 if(body.dex!==undefined&&(typeof body.dex!=='string'||!dex.test(body.dex)))return false;
 if(body.coin!==undefined&&(typeof body.coin!=='string'||!identifier.test(body.coin)||body.coin.includes('..')))return false;
 if(['l2Book','recentTrades','fundingHistory'].includes(body.type)&&!body.coin)return false;
 if(body.type==='candleSnapshot'){
  const r=body.req;
  if(!r||typeof r.coin!=='string'||!identifier.test(r.coin)||!intervals.has(r.interval)||!Number.isSafeInteger(r.startTime)||!Number.isSafeInte¶»§q«^