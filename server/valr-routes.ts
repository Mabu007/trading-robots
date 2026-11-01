import type { Express, Request, Response } from 'express';
import { ValrAccounts } from './valr-account.ts';

type Dependencies = {
  uid: (req: Request, res: Response) => Promise<string | null>;
  read: (key: string) => Promise<string | null>;
  write: (key: string, body: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  request?: typeof fetch;
  key?: () => string | undefined;
  beforeChange?:(uid:string)=>Promise<void>;
  mutate?:<T>(uid:string,task:()=>Promise<T>)=>Promise<T>;
};

export function valrAccountRoutes(app: Express, dependencies: Dependencies) {
  const accounts = new ValrAccounts(dependencies, { request: dependencies.request, key: dependencies.key });
  const handle = (run: (uid: string, req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = await dependencies.uid(req, res); if (!uid) return;
    try { return res.json(await run(uid, req)); }
    catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const known = /^(Stop and reconcile live trading before changing VALR credentials|Live deployment outcome is pending\. Wait one minute and reconcile before changing credentials|Another VALR account change is pending\. Retry after it completes; an interrupted change requires operator reconciliation\.|VALR account change requires operator reconciliation\.|Live runtime is not configured|Enter a valid VALR API key and secret\.|Use a VALR key with View access and Trade only\. Disable all other permissions\.|VALR credential encryption is not configured\.|Could not reach VALR\. Retry the connection\.|VALR rate limit reached\. Wait and retry\.|VALR could not verify this account\. Check the key, permissions and IP restrictions\.|VALR returned an invalid account response\.|VALR did not return verifiable API permissions\.|VALR returned invalid balances\.|VALR returned invalid account activity\.|Unable to decrypt VALR credentials\. Reconnect your account\.)$/;
      const message = known.test(raw) ? raw : 'VALR account request failed. Retry later.';
      const clientError = /valid VALR API key|View access and Trade only/.test(message);
      return res.status(clientError ? 400 : 503).json({ error: message });
    }
  };
  const mutate=<T>(uid:string,task:()=>Promise<T>)=>dependencies.mutate?dependencies.mutate(uid,task):task();
  app.post('/api/valr/account/connect', handle(async (uid, req) => mutate(uid,async()=>{
    const { apiKey, apiSecret } = req.body ?? {};
    // A live authorization must be stopped and reconciled before key changes.
    await dependencies.beforeChange?.(uid);
    const account = await accounts.connect(uid, { apiKey, apiSecret });
    return { connected: true, ...account };
  })));
  app.get('/api/valr/account', handle(async uid => {
    const credentials = await accounts.load(uid);
    if (!credentials) return { connected: false };
    return { connected: true, ...await accounts.inspect(credentials) };
  }));
  app.get('/api/valr/account/activity', handle(async uid => {
    const credentials=await accounts.load(uid);if(!credentials)throw new Error('VALR account request failed. Retry later.');
    return accounts.activity(credentials);
  }));
  app.post('/api/valr/account/disconnect', handle(async uid => mutate(uid,async()=>{
    await dependencies.beforeChange?.(uid);
    await accounts.disconnect(uid);
    return { connected: false, positionsClosed: false, revokeAtValr: true };
  })));
}
