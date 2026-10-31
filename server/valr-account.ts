import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

type Credentials = { apiKey: string; apiSecret: string };
type Storage = { read: (key: string) => Promise<string | null>; write: (key: string, body: string) => Promise<void>; remove: (key: string) => Promise<void> };

export function valrSignature(secret: string, timestamp: string, method: string, path: string, body = ''): string {
  return createHmac('sha512', secret).update(timestamp + method.toUpperCase() + path + body).digest('hex');
}

function keyBytes(encoded: string | undefined): Buffer {
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('VALR credential encryption is not configured.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('VALR credential encryption is not configured.');
  return key;
}

function storageKey(uid: string): string {
  const environment = process.env.VERCEL_ENV === 'production' ? 'production' : process.env.VERCEL_ENV === 'preview' ? 'preview' : 'development';
  return `valr-credentials/v1/${environment}/${Buffer.from(uid).toString('base64url')}.json`;
}
function associatedData(uid: string): Buffer { return Buffer.from(`trading-vibes:valr:v1:${uid}`); }

// Only account inspection is implemented here. Order routes are deliberately
// absent until runtime isolation, reconciliation and risk checks are ready.
export class ValrAccounts {
  private storage: Storage;
  private request: typeof fetch;
  private clock: () => number;
  private key: () => string | undefined;
  constructor(storage: Storage, options: { request?: typeof fetch; clock?: () => number; key?: () => string | undefined } = {}) {
    this.storage = storage; this.request = options.request ?? fetch; this.clock = options.clock ?? Date.now; this.key = options.key ?? (() => process.env.VALR_CREDENTIAL_ENCRYPTION_KEY);
  }

  private async get(credentials: Credentials, path: '/v1/account/api-keys/current' | '/v1/account/balances' | '/v1/orders/open' | '/v1/account/tradehistory?skip=0&limit=20') {
    const timestamp = String(this.clock());
    let response: Response;
    try { response = await this.request(`https://api.valr.com${path}`, { headers: { 'Content-Type': 'application/json', 'X-VALR-API-KEY': credentials.apiKey, 'X-VALR-TIMESTAMP': timestamp, 'X-VALR-SIGNATURE': valrSignature(credentials.apiSecret, timestamp, 'GET', path) }, signal: AbortSignal.timeout(10000) }); }
    catch { throw new Error('Could not reach VALR. Retry the connection.'); }
    if (!response.ok) throw new Error(response.status === 429 ? 'VALR rate limit reached. Wait and retry.' : 'VALR could not verify this account. Check the key, permissions and IP restrictions.');
    try { return await response.json() as unknown; } catch { throw new Error('VALR returned an invalid account response.'); }
  }

  async inspect(credentials: Credentials) {
    if (!credentials || !/^[a-zA-Z0-9]{64}$/.test(credentials.apiKey) || !/^[a-zA-Z0-9]{64}$/.test(credentials.apiSecret)) throw new Error('Enter a valid VALR API key and secret.');
    const info = await this.get(credentials, '/v1/account/api-keys/current') as { permissions?: unknown; label?: unknown };
    if (!Array.isArray(info?.permissions) || !info.permissions.every((p: unknown) => typeof p === 'string')) throw new Error('VALR did not return verifiable API permissions.');
    const permissions = info.permissions.map((p: string) => p.toLowerCase().replace(/\s+/g, ' ').trim());
    if (!permissions.includes('view access') || !permissions.includes('trade') || permissions.some((p: string) => p !== 'view access' && p !== 'trade')) throw new Error('Use a VALR key with View access and Trade only. Disable all other permissions.');
    const balances = await this.get(credentials, '/v1/account/balances');
    if (!Array.isArray(balances)) throw new Error('VALR returned invalid balances.');
    return { label: typeof info.label === 'string' ? info.label.slice(0, 100) : '', permissions: ['View access', 'Trade'], balances };
  }

  async connect(uid: string, credentials: Credentials) {
    const encryptionKey = keyBytes(this.key());
    const account = await this.inspect(credentials);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(associatedData(uid));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
    await this.storage.write(storageKey(uid), JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
    return account;
  }

  async load(uid: string): Promise<Credentials | null> {
    const body = await this.storage.read(storageKey(uid));
    if (!body) return null;
    try {
      const saved = JSON.parse(body);
      if (saved.version !== 1) throw new Error('Unsupported version');
      const decipher = createDecipheriv('aes-256-gcm', keyBytes(this.key()), Buffer.from(saved.iv, 'base64'));
      decipher.setAAD(associatedData(uid)); decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
      const credentials = JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
      if (!/^[a-zA-Z0-9]{64}$/.test(credentials.apiKey) || !/^[a-zA-Z0-9]{64}$/.test(credentials.apiSecret)) throw new Error('Invalid credentials');
      return credentials;
    } catch { throw new Error('Unable to decrypt VALR credentials. Reconnect your account.'); }
  }

  async disconnect(uid: string) { await this.storage.remove(storageKey(uid)); }

  async activity(credentials:Credentials){
    const [orders,trades]=await Promise.all([this.get(credentials,'/v1/orders/open'),this.get(credentials,'/v1/account/tradehistory?skip=0&limit=20')]);
    if(!Array.isArray(orders)||!Array.isArray(trades))throw new Error('VALR returned invalid account activity.');
    // Expose only the fields needed for display. These are account-wide VALR
    // records, not necessarily orders placed by Trading Vibes.
    const fields=(item:any,names:string[])=>Object.fromEntries(names.filter(name=>typeof item?.[name]==='string').map(name=>[name,item[name].slice(0,200)]));
    return {orders:orders.slice(0,100).map(item=>fields(item,['orderId','customerOrderId','currencyPair','side','price','remainingQuantity','status','type','createdAt'])),trades:trades.slice(0,20).map(item=>fields(item,['id','currencyPair','side','price','quantity','tradedAt']))};
  }
}
