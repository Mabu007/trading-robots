# PropDAO live execution: activation checklist

Status: **disabled by default**. This integration uses a Durable Object per user/account, live Hyperliquid candles, a QuickJS isolated strategy sandbox and PropDAO's own simulated-capital order API.

## Required configuration

1. Verify each user supplies their **own** `pd_live_…` key in the app. It is encrypted in R2 using `PROPDAO_CREDENTIAL_ENCRYPTION_KEY` and is never sent to the browser or Cloudflare Worker.
2. Add the following **Vercel Production** environment variables:
   - `PROPDAO_LIVE_RUNTIME_URL` = HTTPS URL of the deployed `trading-vibes-propdao-live` Worker
   - `PROPDAO_LIVE_INTERNAL_SECRET` = a new strong random secret of at least 32 characters
   - `PROPDAO_LIVE_ENABLED` = `true` **only after** the Worker and live account tests pass
3. Configure the Worker:
   - Run `npx wrangler secret put PROPDAO_LIVE_INTERNAL_SECRET --config workers/wrangler.propdao-live.jsonc` with **the same secret** as Vercel
   - Set `PROPDAO_CONTROL_URL=https://trading-robots.vercel.app` in `workers/wrangler.propdao-live.jsonc`
   - Keep Worker `PROPDAO_LIVE_ENABLED=false` during validation
4. Build and deploy with a Cloudflare account authorized to manage Workers and Durable Objects:
   ```sh
   npm run check:runtime
   npm run worker:propdao:live:build
   npx wrangler deploy --config workers/wrangler.propdao-live.jsonc
   ```
5. Confirm authenticated `GET /api/venues/propdao/bots/:botId/live` reports the runtime reachable; audit operator logs. A server key **cannot** prove a Worker is deployed.
6. Enable `PROPDAO_LIVE_ENABLED=true` in the Worker vars and redeploy, **then** set it in Vercel Production and redeploy Vercel.
7. With a disposable evaluation account and low risk, explicitly authorize one bot, inspect `Live Trading` events, confirm the entry intent ID and real PropDAO position's stop/target, and exercise Stop. Review manual positions in PropDAO after stopping.

## Execution behavior

- Only one active robot per PropDAO account at a time, enforced by the account-scoped Durable Object.
- Server validates the authenticated owner's saved PropDAO bot, account eligibility, market, quantity step, leverage and risk room.
- The Worker reads finished market candles and runs user code in QuickJS. Its alarms check at the selected execution timeframe; alarms do not promise millisecond-exact scheduling.
- A new signal uses a deterministic `intentId`, attached stop and take profit, and a server-side risk preflight. Orders are verified against returned PropDAO positions; missing brackets trigger a repair attempt.
- The Worker refuses entries while PropDAO reports open positions/resting orders. Stop disables **new** orders but does **not** close existing positions.
- After network errors, execution may be ambiguous; do not retry with a different intent ID. Inspect the provider's positions and orders.

## Known boundaries

This is simulated-capital live trading on PropDAO, not live-money brokerage custody. Account challenges can still be lost. Trading costs, funding, provider downtime, price gaps, missed alarms and protective-order race conditions remain risks. Before treating this as production-ready, add a provider-connected dry run that verifies fill ↔ protective bracket linkage and durable order reconciliation under API timeouts. Do not enable with an unsupported instrument or missing Cloudflare credentials.
