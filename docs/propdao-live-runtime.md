# PropDAO live execution: activation checklist

Status: **disabled by default**. This integration uses a Durable Object per user/account/bot (legacy account-scoped instances remain reachable for safe stop/reconciliation), live Hyperliquid candles, a QuickJS isolated strategy sandbox and PropDAO's own simulated-capital order API.

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
- A new deployment uses a **bot-scoped** Durable Object. Multiple robots can be deployed to the same account and run their own schedule, without overwriting each other's code, alarm or authorization. An older account-scoped deployment is still reachable for Stop/reconciliation.
- A separate account-scoped Durable Object serializes order submission across bots. If another bot already holds a position or resting order, this bot skips entry while retaining its own live schedule. This protects account-level risk and avoids concurrent ambiguous order submissions. **Simultaneous independent open positions on one PropDAO account are not enabled by this change.**
- Stop revokes authorization **before** contacting Cloudflare. On confirmed stop with no unresolved intent, the backend removes the old grant. Edit and save strategy.js after stopping, then Deploy again to load the new saved code and create a new authorization. Running strategy code is immutable; hot swapping without a stop is deliberately prohibited.
- The Worker refuses new entries while PropDAO reports open positions/resting orders. Stop disables **new** orders but does **not** close existing positions.
- After network errors, execution may be ambiguous; do not retry with a different intent ID. Inspect the provider's positions and orders.

## Known boundaries

This is simulated-capital live trading on PropDAO, not live-money brokerage custody. Account challenges can still be lost. Trading costs, funding, provider downtime, price gaps, missed alarms and protective-order race conditions remain risks. Before treating this as production-ready, add a provider-connected dry run that verifies fill ↔ protective bracket linkage and durable order reconciliation under API timeouts. Do not enable with an unsupported instrument or missing Cloudflare credentials.


## Deployment from Vercel-held credentials

Run `node scripts/deploy-propdao-from-vercel.mjs` explicitly in a production build with
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the shared
`PROPDAO_LIVE_INTERNAL_SECRET`. `PROPDAO_LIVE_ENABLED` must be `false`.
The command verifies Workers API access, deploys the SQLite Durable Object,
installs the secret, and probes authentication and the disabled BOTS binding.
It never runs in the ordinary frontend build and never exports credentials.

The Live Trading status distinguishes connectivity from execution permission.
Stop revokes the server-side grant before contacting the Worker. Already accepted
provider requests and existing/resting positions are not cancelled by Stop.
A persistent pending intent is recorded before submission; ambiguous responses
halt entries and block redeployment until operator reconciliation. Runtime errors
also halt the bot. Recovery/clearance of unresolved intents is deliberately **not automatic**.
The Deploy dialog now offers **Reconcile pending order** after the operator
checks the PropDAO account and confirms there are no remaining positions or
resting orders. Reconciliation never retries or cancels the ambiguous order.
The backend reads the complete account trade history and validates two
independent, flat provider snapshots at least two minutes after the pending
intent was created. Any active order, open position, incomplete history, stale
intent, or provider error blocks clearance. The Durable Object permanently
records the intent ID and verification evidence before removing the lock.
A cleared lock does **not** mean the old order never filled; it means the
operator has confirmed and the provider currently verifies no outstanding
exposure. Deployment still requires a fresh explicit authorization.

An account-scoped worker may contain an older bot's pending intent even when
the current bot's grant was removed after a failed deployment. The Deploy
dialog can query the selected account, discover that intent, and offer the same
verified recovery. A rejected deploy must never overwrite the prior grant;
only definitive rejections allow rollback of the newly staged grant.

PropDAO documents IOC as market-only. The adapter uses a price-bounded GTC limit,
checks actual positions and brackets, and halts on resting remainders. It must not
be enabled until this lifecycle and failure recovery are verified with an explicitly
designated disposable account. A passing build or mocked test is not that evidence.
