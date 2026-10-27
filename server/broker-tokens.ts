import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export type BrokerTokens={accessToken:string;refreshToken:string;expiresAt:number;scope:'accounts'|'trading';connectedAt:string;selectedAccountId?:string;mappings?:Record<string,string>};
type Storage={read:(key:string)=>Promise<string|null>;write:(key:string,body:string)=>Promise<void>};
export const brokerTokenKey=(uid:string)=>`broker-connections/${Buffer.from(uid).toString('base64url')}/ctrader.json`;
function encryptionKey(encoded=process.env.BROKER_TOKEN_ENCRYPTION_KEY){const key=Buffer.from(encoded||'','base64');if(key.length!==32)throw Error('BROKER_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');return key;}
export class BrokerTokenStore {
  private refreshing=new Map<string,Promise<BrokerTokens>>();private rewrap=new Set<string>();
  private storage:Storage;private request:typeof fetch;
  constructor(storage:Storage,request:typeof fetch=fetch){this.storage=storage;this.request=request;}
  static configured(){try{encryptionKey();return true}catch{return false}}
  private async persist(uid:string,tokens:BrokerTokens){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(tokens)),cipher.final()]);await this.storage.write(brokerTokenKey(uid),JSON.stringify({version:2,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}));}
  async save(uid:string,tokens:BrokerTokens){const pending=this.refreshing.get(uid);if(pending)await pending.catch(()=>{});await this.persist(uid,tokens);}
  async load(uid:string):Promise<BrokerTokens|null>{
    const body=await this.storage.read(brokerTokenKey(uid));if(!body)return null;const saved=JSON.parse(body);
    if(saved.version!==2){if(typeof saved.accessToken!=='string'||typeof saved.refreshToken!=='string')throw Error('Invalid broker authorization. Reconnect cTrader.');encryptionKey();this.rewrap.add(uid);return saved;}
    for(const key of [process.env.BROKER_TOKEN_ENCRYPTION_KEY,process.env.BROKER_TOKEN_PREVIOUS_KEY].filter(Boolean)){
      try{const cipher=createDecipheriv('aes-256-gcm',encryptionKey(key),Buffer.from(saved.iv,'base64'));cipher.setAuthTag(Buffer.from(saved.tag,'base64'));const tokens=JSON.parse(Buffer.concat([cipher.update(Buffer.from(saved.ciphertext,'base64')),cipher.final()]).toString()) as BrokerTokens;if(key!==process.env.BROKER_TOKEN_ENCRYPTION_KEY)this.rewrap.add(uid);return tokens;}catch{}
    }
    throw Error('Broker credential decryption failed. Reconnect cTrader or restore the encryption key.');
  }
  async valid(uid:string):Promise<BrokerTokens>{
    const pending=this.refreshing.get(uid);if(pending)return pending;
    const refresh=(async()=>{
      const tokens=await this.load(uid);if(!tokens)throw Error('Connect cTrader before continuing.');if(tokens.expiresAt>Date.now()+60000){if(this.rewrap.delete(uid))await this.persist(uid,tokens);return tokens;}
      const url=new URL('https://openapi.ctrader.com/apps/token');url.search=new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refreshToken,client_id:process.env.CTRADER_CLIENT_ID||'',client_secret:process.env.CTRADER_CLIENT_SECRET||process.env.CTRADER_SECRET_KEY||''}).toString();
      const response=await this.request(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});const result=await response.json() as any;
      if(!response.ok||result.errorCode||typeof result.accessToken!=='string'||typeof result.refreshToken!=='string'||!Number.isFinite(Number(result.expiresIn))||Number(result.expiresIn)<=0)throw Error('cTrader authorization expired. Reconnect the broker.');
      const updated={...tokens,accessToken:result.accessToken,refreshToken:result.refreshToken,expiresAt:Date.now()+Number(result.expiresIn)*1000};await this.persist(uid,updated);this.rewrap.delete(uid);return updated;
    })();this.refreshing.set(uid,refresh);try{return await refresh}finally{this.refreshing.delete(uid)}
  }
}
