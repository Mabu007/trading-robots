# Marketplace implementation and verification

27 October 2026. Trading execution remains disabled by default. This is an implemented, locally verified release candidate, **not a verified production trading service**.

## What changed

- Preserved the Vite/React application, Firebase sign-in, existing routes, bot builder/chat, R2 snapshots/history, editable free copies, browser backtesting, sharing, rename/delete, chart interactions and version controls.
- Added server-owned marketplace records, immutable strategy-version metadata, free entitlements, independent customer subscriptions and risk settings. Paid pages show a ZAR price; checkout and payouts remain Coming Soon. Browser state cannot grant paid access.
- Added creator/customer dashboards under Profile. Metrics come from persisted records, and earnings count successful, provider-verified integer-minor-unit ledger entries only. New paid sales/earnings are zero. Creators receive aggregate subscriber analytics, never customer accounts, credentials or fills.
- Bot pages retain Backtest / Start / Connect broker. Matching saved backtests may be published with explicit **creator-reported, unverified backtest** labels; they are never presented as verified live performance.
- Extended OAuth to trading consent, authenticated account selection, account-specific symbols/specifications and mappings, refresh and encrypted R2 token storage. Existing `CTRADER_SECRET_KEY` is accepted alongside `CTRADER_CLIENT_SECRET`.
- Added a small persistent Node 24 cTrader JSON-WebSocket gateway, with one shared connection per environment, heartbeats, throttling, reconnect-on-demand, account reauthentication/resubscription, broker rule/risk/margin checks, order acknowledgements/reconciliation and durable execution-event audits. Live accounts can be monitored; every order/position mutation is demo-only and operator-gated.
- Added one bot Durable Object per public/draft bot ID, and a separate serialized execution object per customer. Customers cannot stop the shared bot by pausing their following. A broker account claim prevents it being traded concurrently through different app identities.
- Added pinned R2 strategy code/history, completed-candle alarms, evaluation deduplication, a persisted fanout outbox, Queue consumers, per-account durable intents and unknown-acknowledgement reconciliation. No uncertain order is blindly resubmitted.
- Shared the canonical JavaScript decision evaluator between browser and isolated Dynamic Workers. Browser execution uses an opaque frame plus a terminable dedicated Web Worker. Server strategy isolates receive no bindings or network and request CPU/subrequest limits.
- Added fulfilled-history caching and reproducible `backtestSpread`, `backtestSlippage`, `backtestCommissionR` configuration. Assumptions are logged; zero costs are explicit defaults, not claimed broker prices.

## Architecture and ownership

| Component | Responsibility |
|---|---|
| Existing Vercel Express API | Firebase JWT verification, creator authorization, marketplace/entitlement/risk records, OAuth, private R2 access |
| Persistent Node gateway | Application/account authentication and shared cTrader demo/live WSS connections; never executes strategy code |
| Bot Durable Object (`ROBOTS.idFromName(botId)`) | One evaluation per completed candle for every follower; pinned strategy, alarm and outbox state |
| Account Durable Object (`ACCOUNTS.idFromName(uid)`) | Serialized checks, durable intent journal, reconciliation and explicit position management |
| Cloudflare Queue | Independent subscriber jobs, bounded retries, dead-letter handling |
| R2 | Existing history/covers/private snapshots; immutable deployed code, replay candles, fanout targets, broker intent/event audit |
| Firestore | Ownership, versions, publication registry, entitlements, broker selection/claims, subscriptions, signals, execution mirrors, analytics and accounting |

A queue job rechecks publication, entitlement, following, account, mapping, risk, current deployment version, generation-specific last signal, market/session, fresh quote, positions/exposure/loss and margin. Broker constraints are checked again immediately before submission. An unknown acknowledgement blocks subsequent orders until reconciled; the customer can request reconciliation explicitly. Reconciliation never creates an order.

Stopping/unpublishing disables future signals and/or following; it does not close existing positions. Updates require stopping first and pin a new deployment generation. Old queued signals cannot become eligible after redeployment of identical code with different settings. Account selection, mapping, authorization changes and disconnects pause following. Broker-account claims require an operator-reviewed transfer between app identities.

## Actual verification

| Requested scenario | Evidence/status |
|---|---|
| 1. Creator creates a bot | Existing builder retained; registration/ownership covered by tests. Authenticated production creator flow not exercised |
| 2. Creator deploys | Unit tests and actual local Worker/DO/R2 deployment fixture passed |
| 3. DO alarm schedules/executes | Actual local workerd alarm passed; no production namespace deployed |
| 4. Valid signal | Actual local isolate generated and persisted one fixture signal |
| 5–6. Two customers / independent demo orders | Mocked broker tests passed, with independent balance-based sizes. **No actual cTrader demo orders placed** |
| 7. One customer pauses | Mocked persisted subscriptions passed; the other remains enabled |
| 8. Creator stop/resume | State/alarm unit tests passed; actual local stop/restart persistence passed |
| 9. Duplicate signal | Durable intent restart/deduplication test passed; one mock submission |
| 10. Subscriber broker failure isolation | Mocked broker test passed |
| 11. OAuth refresh | Encrypted-storage/rotation/concurrent-refresh tests passed against mock token endpoint; actual provider refresh pending |
| 12. R2 historical data | Actual local R2 replay-code/candle reads passed; existing market-data parser/config tests passed. Production historical rights/provider checks pending |
| 13. Backtest/live decision parity | Stateful, seeded-random, Date and completed-timeframe fixture parity passed; browser basic backtest passed |
| 14. Free access | Persisted entitlement/acquisition/deduplication tests passed |
| 15. Paid checkout disabled | Server-side paid-acquisition refusal and no-entitlement tests passed |
| 16. Verified earnings only | Ledger tests passed, including unverified/pending exclusion, deduplication and integer amounts |
| 17. Customer/creator isolation | Ownership and customer filtering tests passed; Firestore rules prepared but not deployed/emulator-verified |
| 18. Scheduler restart | Actual local process restart recovered stopped DO state, evaluation count and no pending alarm |
| 19. Update isolation | Running-update refusal, immutable code digest and generation-specific queue checks implemented/tested locally |
| 20. Build/regressions | `npm test`: 75 passing tests; `npm run build`, native Node 24 API import, and `npm run check:runtime` passed |

Additional actual browser checks: 390px bot page retains exactly three primary buttons, no horizontal overflow; risk dialog requires explicit demo consent and preserves entered risk; an infinite strategy terminates after eight seconds while the UI continues ticking. Browser fixtures did not acquire real bots or place orders.

`npm run test:cloudflare` runs real local workerd/DO alarms/R2, verifies empty strategy bindings and that a handler's outbound fetch cannot reach a reachable local probe, then restarts the process and checks recovery. All broker/control data are clearly marked local fixtures. No cTrader network access occurs.

`npm run test:cloudflare -- --cpu` is a separate CPU stress probe. It timed out locally: **CPU interruption is not verified**. `STRATEGY_ISOLATION_VERIFIED=false` therefore blocks new strategy deployment by default. Production Cloudflare CPU-limit validation is mandatory before enabling this gate; do not treat local success on other isolation checks as that proof.

## Configuration required

No secret belongs in a `VITE_` variable. Vercel inventory was inspected without decrypting values.

| Variable/resource | Where | Status / purpose |
|---|---|---|
| `CTRADER_CLIENT_ID` | Vercel + gateway | Present in Vercel production; value/approval not independently verified |
| `CTRADER_CLIENT_SECRET` or `CTRADER_SECRET_KEY` | Vercel + gateway | Existing Vercel `CTRADER_SECRET_KEY` accepted; value never displayed |
| `CTRADER_REDIRECT_URI` | Vercel | Missing. Register the exact application callback, normally `https://trading-robots.vercel.app/api/brokers/ctrader/callback`, with cTrader |
| `BROKER_TOKEN_ENCRYPTION_KEY` | Vercel + gateway | Missing; independent base64-encoded 32-byte AES key, same on both services |
| `BROKER_TOKEN_PREVIOUS_KEY` | Vercel + gateway | Optional previous AES key during rewrapping; retain until all stored credentials rotate |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Vercel | Missing server service-account credentials; least-privilege Firestore IAM |
| `FIREBASE_PROJECT_ID` or existing `VITE_FIREBASE_PROJECT_ID` | Vercel | Existing public project configuration retained |
| Existing `R2_*` storage configuration | Vercel + gateway | Vercel variables already present; reuse the existing private application bucket |
| `TRADING_INTERNAL_SECRET` | API + Worker + gateway | Missing; shared random backend bearer secret, at least 32 characters |
| `ROBOT_RUNTIME_URL` | Vercel | Missing; authenticated production Worker endpoint |
| `CTRADER_GATEWAY_URL` | Vercel + Worker | Missing; HTTPS persistent gateway endpoint |
| `CONTROL_API_URL` | Worker + gateway | Canonical HTTPS app origin for internal authenticated callbacks |
| `DEMO_TRADING_ENABLED` | Worker + gateway | Defaults false. Requires actual demo verification before enabling for customer use |
| `STRATEGY_ISOLATION_VERIFIED` | Worker | Defaults false. Requires production CPU/network/binding isolation verification |
| Cloudflare API access/account | Infrastructure | Not available in session; account inventory/deployment blocked |
| Persistent gateway host | Infrastructure | Dockerfile supplied; host/access not provided. Run exactly one replica to respect the shared-connection design |
| cTrader authorized hedged demo accounts | Provider testing | Required for real integration tests; none authorized in this implementation session |

The cTrader credentials currently have production scope only. Previews intentionally do not inherit them. Do not copy production secrets into a preview merely to make a readiness indicator green.

## Source and web deployment

Published on `marketplace-demo-runtime` in [draft PR #2](https://github.com/Mabu007/trading-robots/pull/2). Vercel preview deployment is being verified; production main remains unchanged. Backend packaging explicitly includes the shared strategy/types modules and server classes use Node 24 strip-compatible syntax; the native API import has a regression test.

GitHub Actions created the workflow but its hosted job failed before any runner steps started; no job log was available through GitHub. Local checks above passed. CI is not claimed as passing, and the runner/account cause remains unverified.

## Cloudflare resources and deployment

**Resources actually created/updated in production: none.** No duplicate namespace, bucket, Worker or cron has been created. There is no cron; Durable Object alarms schedule robots.

Prepared: `workers/wrangler.local.jsonc`, SQLite DO migration for Robot/Account, existing-bucket R2 binding, one signal queue and one dead-letter queue, Dynamic Worker loader binding, observability and CPU configuration. Local resources are fixtures, not production infrastructure.

`scripts/configure-cloudflare.mjs` inventories the chosen account before writing a new production config, verifies the existing bucket and queues, refuses to overwrite an existing Worker/migrations, and never creates resources or deploys. Select reviewed resource names; create only missing queues after inventory. If a Worker already exists, preserve its actual namespace bindings and migration history manually. The generated config keeps both execution/isolation gates false.

Suggested sequence once access is supplied:

1. Inventory actual Cloudflare resources and reuse the application bucket. Review queue/DO resource names and migration history.
2. Provision the single persistent gateway with TLS and narrowly scoped backend/R2 credentials; start with demo execution disabled.
3. Install Vercel server credentials and the exact registered OAuth callback; configure internal URLs/shared secret on all services. Redeploy for environment changes to take effect.
4. Apply Firestore rules/index configuration to the correct existing project. Preserve current private user paths.
5. Deploy the Worker with production gates false. Verify actual Cloudflare CPU/network/secret isolation, then the stopped deployment/alarm/restart path on trusted demo fixtures.
6. Authorize real cTrader demo accounts; verify symbols/units/permissions/history/refresh and reconcile actual acknowledgements. Record two independent demo executions, pause/failure/update scenarios and broker constraints.
7. Enable demo execution only after those checks. Live execution remains hard-disabled in code; adding a future real-money gate requires separate explicit production authorization and user risk consent.

## Database model and migrations

Existing `users/{uid}/bots`, chats and versions remain unchanged. New server-owned roots: `marketplaceBots`, `botVersions`, `deployments`, `botSubscribers`, `brokerConnections`, `brokerAccountClaims`, `signals`, `customerExecutions`, `executionEvents`, `creatorProfiles`, `entitlements`, `marketplaceEvents`, `marketplaceTransactions`, `auditLogs`. `creatorEarnings` and `payoutRecords` are reserved future accounting roots; no earnings or payout rows are fabricated.

Existing publications migrate lazily into the registry when viewed/acquired after admin credentials are configured. Free historical copies are preserved. There is no destructive bulk migration. Revoked entitlements cannot silently reactivate.

`firestore.rules` denies direct browser access to marketplace roots; existing private bot/chat/version permissions remain. All current queries use one equality filter plus document-name ordering and paginated reads, so automatic single-field indexes suffice. `firestore.indexes.json` disables indexing large observed/result/order maps. Neither rules nor index changes have been applied to production.

Ledger rows use ID, bot/creator/customer IDs, `grossMinor`, `feeMinor`, `creatorMinor`, currency, provider, payment/payout status and timestamps, with `verifiedAt`/`providerEventId` required for revenue. Refund/dispute/failure/pending rows are excluded. Currency totals are separate. No Yoco webhook, checkout, paid-entitlement grant or payout implementation exists yet.

## Remaining limitations and operational requirements

- No actual cTrader OAuth, token refresh, order, fill or two-customer demo test has been completed with provider accounts. Protocol transport tests use mocks and official protobuf field/enum definitions; they do not replace provider testing.
- Production CPU interruption is unverified; strategy deployment remains gated. Dynamic Worker availability/plan entitlement also needs validation in the actual Cloudflare account.
- Generic JavaScript closures cannot be safely serialized. Recovery replays from a pinned warmup origin (1,000 bars/timeframe), with at most 50,000 total candles and bounded CPU. Reaching the limit stops evaluation with an error; indefinite strategies need an explicit checkpoint/state contract or a validated strategy representation before this limit can be removed.
- Only hedged demo accounts are eligible for automated trading in this release. Netted, spread-betting and guaranteed-stop-only accounts fail closed pending allocation/sizing verification. Broker fees are exposed through symbol specifications; automatic exact commission-inclusive risk budgeting remains pending provider verification.
- Market/limit/stop primitives exist; strategy output currently distributes MARKET intents only. Customer close/cancel controls require explicit confirmation. Protection amendments exist in the backend, with no dedicated dashboard editing UI yet.
- The gateway reconnects on demand and restores authorized subscriptions. Exactly one replica is required; active-active gateway failover/leader election is not implemented.
- Queue retries are bounded and dead-lettered. Unknown acknowledgements block new orders until definitive reconciliation; absence of an order in history never authorizes resubmission. An unresolved/dead-lettered job requires customer/operator reconciliation and audit review.
- Broker events persist in private R2 before Firestore mirroring. A failed mirror is logged by event ID and needs replay from R2 if retries fail; an automated durable replay daemon is not yet implemented.
- Dashboard broker state is observed on refresh, not a claim of continuous browser streaming. History displays a bounded recent page with an explicit incomplete indicator. Creator analytics currently aggregate paginated persisted events; high-volume preaggregation is future work. Queries fail clearly at the operational cap rather than presenting partial totals.
- Gateway throughput is bounded by cTrader application rate limits; large subscriber counts and M1 schedules require load testing/admission control before launch. Stale queued jobs fail closed rather than trading late.
- Application request limits are per instance; configure production edge limits too. cTrader gateway normal/history request throttles are centralized per environment.
- R2 market-data redistribution/licensing rights were not supplied and have **not** been verified. Existing private datasets/backtesting were preserved. Confirm source licenses/redistribution permissions before making performance/data available to customers; do not assume a broker authorization grants redistribution rights.
- Installed production dependencies report zero known npm audit advisories after patching the pinned DOMPurify dependency to 3.4.17. This is a dependency inventory check, not a comprehensive security audit.
- Browser build passes with the existing >500KB main-chunk warning. No claim of a full authenticated production end-to-end journey is made.

## Changed files

- `server/marketplace.ts`, `server/firestore-store.ts`, `server/broker-tokens.ts`, `server/broker-routes.ts`, `server/request-limits.ts`, `server/ctrader.ts`, `server/index.ts`, `server/shared-bots.ts`.
- `gateway/{protocol,broker,app,local}.ts`, `gateway/Dockerfile`, `gateway/tsconfig.json`.
- `workers/{index,runtime-core}.ts`, `workers/tsconfig.json`, `workers/wrangler.local.jsonc`.
- `shared/trading.ts`, `src/strategy-runtime.ts`, `src/history-cache.ts`, `src/backtest.ts`, `src/engine.ts`, `src/strategy.ts`.
- `src/components/Marketplace.tsx`, `src/components/marketplace.css`, `src/components/BotSharing.tsx`, `src/App.tsx`.
- Marketplace/runtime/protocol/parity/OAuth/sharing tests; infrastructure/local-test scripts; `.env.example`, `.gitignore`, Firebase rules/config/indexes, npm scripts/lockfile and implementation documentation.

Official references used: [cTrader messages](https://help.ctrader.com/open-api/messages/), [models](https://help.ctrader.com/open-api/model-messages/), [official protobuf definitions](https://github.com/spotware/openapi-proto-messages), [Cloudflare Dynamic Workers API](https://developers.cloudflare.com/dynamic-workers/api-reference/), [limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/), [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
