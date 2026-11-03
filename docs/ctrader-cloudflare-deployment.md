# cTrader Cloudflare gateway deployment

This Worker is separate from the existing PropDAO Durable Object and must not replace its Wrangler configuration, URLs, secrets or migrations.

## Before deployment

Use a cTrader Open API application approved for OAuth and make sure `CTRADER_REDIRECT_URI` exactly matches the cTrader application callback and the application route `https://trading-robots.vercel.app/api/brokers/ctrader/callback`. The app's existing production variables `CTRADER_CLIENT_ID`, `CTRADER_SECRET_KEY` and `AI_CREDENTIAL_ENCRYPTION_KEY` are consumed by the Vercel backend; they do not automatically exist in the Cloudflare Worker.

The gateway uses `CTRADER_GATEWAY_SECRET`, a **new**, independent random bearer secret shared by Vercel and Cloudflare. Do **not** reuse `PROPDAO_LIVE_INTERNAL_SECRET`, any account credential, or the Cloudflare API token for this purpose. The existing app-wide encryption key is domain-separated with HKDF for cTrader OAuth storage.

## Deploy commands (project root, after Cloudflare login)

```sh
npm ci
npm run check:ctrader
npm run worker:ctrader:build
npx wrangler login

# Supply the real application credentials through the secure terminal prompts.
npx wrangler secret put CTRADER_CLIENT_ID --config workers/wrangler.ctrader-gateway.jsonc
npx wrangler secret put CTRADER_SECRET_KEY --config workers/wrangler.ctrader-gateway.jsonc

# Generate one new random secret once, and add the same value on both platforms.
# Never print it in logs or paste it into chat.
npx wrangler secret put CTRADER_GATEWAY_SECRET --config workers/wrangler.ctrader-gateway.jsonc

npm run worker:ctrader:deploy
```

Verify the Worker `/health` endpoint with an authenticated request and check its `runtime`, `ready` and `demoTradingEnabled` response.

In Vercel project `trading-robots`, add production and preview variables `CTRADER_GATEWAY_URL` (the deployed `https://<worker>.<account>.workers.dev` URL) and `CTRADER_GATEWAY_SECRET` (the same random secret). Keep `CTRADER_DEMO_TRADING_ENABLED=false` and `CTRADER_LIVE_TRADING_ENABLED=false` on both platforms until the relevant test gates pass. The Worker `CTRADER_CONTROL_URL` should point to the authorized Vercel backend origin, not a public development URL.

Do not enable demo trading until cTrader OAuth, broker history and bid/ask quotes have been exercised on a connected **demo** account and the runtime has passed a clean build and dry-run.

## Minimum acceptance checks

1. Validate `npm run check:ctrader` and `npm run worker:ctrader:build` without TypeScript errors.
2. Connect cTrader ID and confirm demo account discovery and market specification; verify grant scope and account ownership.
3. Download a single historical M1 trading day and verify its first/last closed candle and broker timestamp normalization. Run the 90-day backfill to R2 without inventing missing broker sessions; compare to actual cTrader charts.
4. Compare tick replay pricing against historical bid and ask ticks; note that actual slippage/latency cannot be replayed perfectly.
5. Run broker demo BUY/SELL entry tests; verify broker-confirmed volume, fills, stop loss, take profit and no outstanding partial remainder.
6. Simulate network disconnects/timeouts, duplicate signals and unprotected fills; ensure only one order intent per account and emergency protection / close is reconciled before trading resumes.
7. Test a second bot sharing one account to verify risk/exposure limits and no duplicate entry.
8. Only after the demo runtime has passed a soak test should demo operator flags be enabled; real-account operator enablement requires a separate deliberate production review.

## Access boundary

The cTrader source can be updated through GitHub and Vercel through its connected project; deployment of the Cloudflare Worker requires authenticated Cloudflare access (Wrangler or a connected Cloudflare deployment tool). Vercel environment variables do not themselves deploy Cloudflare code. Do not claim the gateway is live until its health and integration tests actually succeed.
