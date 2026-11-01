# Trading Vibes

Build and edit JavaScript strategies, backtest them using VALR market history, and deploy spot BUY strategies to the isolated VALR paper runtime. Connect a personal VALR account to inspect balances and account activity. Live execution code is implemented behind disabled operator gates and explicit per-strategy authorization. Production live orders remain disabled until the live Worker, shared internal secret, dedicated-account connection allowlist and real exchange verification are configured.

## Development

Use Node 24, run `npm ci`, then `npm run dev`. `npm test`, `npm run build`, `npm run check:runtime`, and `npm run test:valr-paper` validate the app and paper worker. The Vercel production project runs the Vite build and the API in `api/index.ts`.

Configure Firebase web and server credentials, private R2 storage, VALR and AI credential encryption keys, and the paper worker URL and internal secret. See `.env.example`. R2 stores user robot files, images and encrypted provider credentials; it is not a market-data source.

VALR history is paginated with a limit of 5,000 source candles per timeframe. Paper simulation uses VALR candles but does not model fees or slippage. It is a simulation and does not place orders. The live coordinator verifies an exit summary by the exact protective customer order ID, charges actual quote totals and fees to its durable daily-loss ledger, and keeps ambiguous or partial exits locked. Exchange preservation of that customer ID must be verified on the target account. Exit losses are recorded on the terminal exchange-summary UTC day; unsellable entry dust is charged conservatively to that exit. Real-account end-to-end testing remains required before operator enablement.

Removing runtime source code does not stop already-deployed Workers or erase saved robots; production resources must be managed separately.

Deploy the live Worker with `npx wrangler deploy --config workers/wrangler.valr-live.jsonc` using an authorized Cloudflare deployment identity. Set `VALR_CONTROL_URL` and the same independent, random `VALR_LIVE_INTERNAL_SECRET` on API and Worker. Configure `VALR_LIVE_RUNTIME_URL` on Vercel. Keep all three Worker verification gates and API live gates off until account, strategy isolation and protective client-ID linkage are verified. The API's `VALR_LIVE_ALLOWED_KEY_IDS` restricts live entries to verified dedicated account connections; multiple API keys for the same exchange account must not run separate coordinators.

Stop or authorization expiry prevents entries; an unresolved position continues to reconcile and receive protective orders. Reconnect/disconnect is blocked while a live authorization has a running bot or unresolved order. Trading is currently spot BUY only, one unresolved trade per connection, with a 24-hour user grant pinned to source hash, market and risk limits.
