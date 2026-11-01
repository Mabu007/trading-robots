# VALR operation and verification

Deploy offers Demo (paper) and Live. Public history and quotes require no exchange key. A user can connect their own 64-character VALR API key and secret with View access and Trade only. Credentials remain AES-GCM encrypted in private server storage and are never sent to strategy code. Demo uses simulated funds; it is not a VALR exchange demo account.

Demo deploys and starts in one action. Live needs separately approved limits for the saved strategy, plus all platform and connection checks. The UI reports missing connection, operator verification, runtime configuration and Worker readiness. Stop live is visible in the workspace. The source, market, allocation and authorization expiry remain pinned in the deployed grant.

## Bugs closed in this release

- Concurrent credential/deployment mutations are guarded by an atomic Firestore account lock, shared across server instances. Immutable per-grant records preserve provider access for an already deployed grant if a later deployment fails or replaces its current marker.
- A late deployment request is rejected after one minute. Pending deployments block credential changes during that window; a running bot or unresolved trade always blocks changes.
- Worker status reports its actual verification gates. A configured URL alone cannot make the UI claim live readiness.
- The first live alarm runs promptly, with a fallback alarm persisted before reconciliation, rather than relying only on a final scheduling write.
- Open paper positions continue receiving exit candles without evaluating user code or depending on an ever-growing strategy replay history.
- Both trading modes have direct controls; demo starts after deployment, and changing live risk values clears the previous consent.

## Interrupted account changes

The lock document is `valrAccountLocks/{environment}_{base64url(uid)}`. It has no automatic expiry: allowing a delayed credential write to outlive a lease could race an order. A normal operation removes its own token in `finally`. If a server process dies, reconcile the account, check that the original invocation has ended, inspect its R2 authorization records and runtime state, then remove only that user's stale lock through an administrator. Do not clear a lock to bypass an unresolved trade.

## Production enablement

Deploy `workers/wrangler.valr-live.jsonc` with an authorized Cloudflare identity. Set `VALR_CONTROL_URL` to the canonical HTTPS API origin, and set the same independent random `VALR_LIVE_INTERNAL_SECRET` on API and Worker. Set `VALR_LIVE_RUNTIME_URL` on Vercel. Configure the dedicated connection fingerprint allowlist. Leave live entry and exchange verification gates false until real exchange testing is complete. Local loopback fixtures are accepted only by explicit local configuration and never appear in production Wrangler variables.

`npm run test:valr-live-runtime` exercises the actual Worker, Durable Object, QuickJS strategy evaluation and alarms against a loopback fixture. It covers default-off authorization, entry, protection, stop, restart, linked exit settlement and owner isolation without exchange credentials or real orders. Unit tests cover the account lock, immutable grants, ledger deduplication, fee accounting and risk rejection.

Still required before real enablement: deploy the live Worker and secrets; verify deployed strategy isolation; verify dedicated real-account ownership and API permissions; observe VALR's actual protective conditional-to-exit customer ID behavior, fees, timestamps, partial-fill and cancellation behavior; complete the real-account entry/protect/exit/stop/restart lifecycle. Missing or ambiguous exchange evidence stays locked. Base-currency dust, unsupported short strategies and changing ledger quote currency can require operator reconciliation. These conditions must not be represented as passing checks.
