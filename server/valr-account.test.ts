import { describe, expect, it, vi } from 'vitest';
import { valrSignature, ValrAccounts } from './valr-account';

describe('VALR account foundation', () => {
  it('matches the exchange signing test vector', () => {
    expect(valrSignature('4961b74efac86b25cce8fbe4c9811c4c7a787b7a5996660afcc2e287ad864363', '1558014486185', 'GET', '/v1/account/balances')).toBe('9d52c181ed69460b49307b7891f04658e938b21181173844b5018b2fe783a6d4c62b8e67a03de4d099e7437ebfabe12c56233b73c6a0cc0f7ae87e05f6289928');
  });

  it('encrypts credentials with user-bound authentication and removes them on disconnect', async () => {
    const data = new Map<string, string>();
    const store = { read: async (key: string) => data.get(key) ?? null, write: async (key: string, value: string) => { data.set(key, value); }, remove: async (key: string) => { data.delete(key); } };
    const request = vi.fn(async (url: string | URL | Request) => String(url).endsWith('/current') ? Response.json({ label: 'My key', permissions: ['View access', 'Trade'] }) : Response.json([{ currency: 'ZAR', available: '10' }]));
    const accounts = new ValrAccounts(store, { request: request as typeof fetch, key: () => Buffer.alloc(32, 1).toString('base64') });
    const credentials = { apiKey: 'a'.repeat(64), apiSecret: 'b'.repeat(64) };
    const result = await accounts.connect('alice', credentials);
    expect(result.balances).toHaveLength(1);
    const encrypted = [...data.values()][0];
    expect(encrypted).not.toContain(credentials.apiKey);
    expect(encrypted).not.toContain(credentials.apiSecret);
    expect(await accounts.load('alice')).toEqual(credentials);
    data.set(`valr-credentials/v1/${Buffer.from('bob').toString('base64url')}.json`, encrypted);
    await expect(accounts.load('bob')).rejects.toThrow('Unable to decrypt');
    await accounts.disconnect('alice');
    expect(await accounts.load('alice')).toBeNull();
  });

  it('rejects keys with withdrawal access before storage or balance retrieval', async () => {
    const write = vi.fn();
    const request = vi.fn(async () => Response.json({ permissions: ['View access', 'Trade', 'Withdraw'] }));
    const accounts = new ValrAccounts({ read: async () => null, write, remove: async () => {} }, { request: request as typeof fetch, key: () => Buffer.alloc(32, 1).toString('base64') });
    await expect(accounts.connect('alice', { apiKey: 'a'.repeat(64), apiSecret: 'b'.repeat(64) })).rejects.toThrow('View access and Trade only');
    expect(write).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
