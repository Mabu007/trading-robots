# VALR migration: initial market-data foundation

This branch is a partial implementation. The workspace selects VALR markets
and requests paginated VALR history for backtests. New cTrader starts,
deployments and subscriptions are parked by default; stop and pause paths
remain available. The old provider code and data remain in place. Do not
enable real-money trading on this basis. Existing running deployments are not
automatically stopped or modified by this code.

The branch also contains account primitives for signed VALR
account inspection and AES-256-GCM encrypted credential storage with
user-bound authentication. They reject keys with permissions beyond View and
Trade. An authenticated account API and connection dialog are implemented on
this branch, but have mock tests only and are not deployed or connected to a
trading runtime. A production deployment
would need a dedicated, securely provisioned 32-byte base64
`VALR_CREDENTIAL_ENCRYPTION_KEY` and an operational key-rotation plan.

## Public endpoints

`GET /api/valr/markets` returns active pairs and the exchange's pair fields,
including minimums and precision where VALR supplies them. It requires no
VALR key. `POST /api/valr/candles` takes `asset`, `timeframe`, `from`, and
`to`. Dates are ISO UTC candle boundaries and `to` is exclusive. It returns
at most 100 source candles per page; callers must request successive pages.
Four-hour candles are built from four complete UTC-aligned hourly candles.
Incomplete aggregates are omitted. The response reports expected and missing
candles, but an empty bucket from VALR is not proof of executed trades.

The backtest client requests at most 5,000 VALR source candles per timeframe;
the date picker allows the previous year but coverage is checked on request.
The adapter caches completed responses in process and deduplicates identical
in-flight requests. This is not a distributed cache or a cross-instance rate
limiter. VALR's public rate limits, historical depth, and pagination behavior
must be validated in the target deployment. Unit tests use mocked VALR responses;
ETHZAR H1, H4 and two successive 100-row M1 pages were also queried successfully
against VALR on 31 October 2026. This does not establish full historical depth.
The backtest client waits one minute and retries rate-limited pages twice; a
failure after those retries stops the run rather than returning partial data.

The branch contains a spot-only paper Durable Object and workspace controls.
Its customer-and-bot identity is derived server-side; it stores paper state,
replays the pinned strategy in the sandbox, and receives no exchange keys. A
paper-only Workers are deployed for preview and production; an ETHZAR WAIT
strategy processed a real completed candle and was stopped on each. The production
website has not been switched to this branch. Local
mock tests cover restarts, duplicate candles, stop, minimums and retries. This
is not live execution. SELL short signals are rejected in spot paper mode;
fees and slippage are not modelled by this initial paper simulator. Its daily
loss budget is capped to the approved allocation. It starts
with 200 closed candles per timeframe, reports missing candles and refuses to
process beyond 5,000 replay candles in total; the scheduler retries errors.
A stopped paper instance can be reset from its deployment dialog. Reset
archives its simulated state and candle history and starts a fresh simulation;
an open simulated position requires explicit acknowledgement. It does not
touch a VALR account or a real position. Operators must review these limits
before use.
Paper account configuration is pinned for the instance's lifetime.

Personal OpenRouter keys and selected models are encrypted separately with a
user-bound AES-256-GCM key. Set an independent 32-byte base64
`AI_CREDENTIAL_ENCRYPTION_KEY`; the provider model list is fetched dynamically.
This connection has mock tests only and has not been validated with a real key.
The old shared AI key is disabled by default; administrators can explicitly
set `ALLOW_SHARED_OPENROUTER_KEY=true` if they intend to pay for shared usage.

A mock-tested, unconnected per-account coordinator serializes bots, persists
intent before submission, reconciles fills and verifies protective orders. It
locks the account when a submission is ambiguous and uses its own durable
daily-loss ledger for sizing. It cannot yet reconcile a completed protective
exit or populate that ledger from verified exchange fills. Live accounting
currently restricts each account to one quote currency. A local
Durable Object test verifies dropped acknowledgements and restart recovery with
a mock exchange; it sends no orders. It is not
exposed to users or connected to real-money execution. A separate unconnected
order-journal primitive records an intent before
submission and refuses to resend ambiguous orders until exchange status is
resolved. An unconnected VALR adapter can construct price-capped FOK limit and OCO conditional
requests; neither is exposed in an API or places orders in the application.
They are tested with mocks only. Production execution still needs risk
validation, fill and fee reconciliation, protection verification, explicit
user consent, and durable account-level coordination.

The account's Workers Free plan rejects Cloudflare Dynamic Workers. This branch
uses an isolated QuickJS WebAssembly VM instead, with no host APIs, a memory
ceiling and a count-based interruption limit. A temporary Worker deployed to
the actual Free account successfully ran a 1,000-candle synthetic replay,
reported `fetch` and `process` as unavailable, and interrupted an infinite
loop; it was deleted afterward. Local tests also compare the sandbox against
the canonical evaluator. This is an initial probe, not a complete security,
performance or strategy-compatibility review. Keep the production isolation
gate disabled pending the complete runtime and end-to-end verification.

## Still required before switching the product

- The user supplied the current shared Firestore rules: they already allow an
  owner to save VALR symbols. The repository rules mirror those supplied rules;
  do not replace the shared project’s rules with the previous restrictive file.
  Marketplace API features still require server-side Firebase credentials.
  Paper deployment can read an owned bot using the signed-in user’s token.
- Verify the workspace and coverage UI in an actual signed-in deployment.
- Verify the per-user VALR connection and disconnect flows against the real
  provider, and test the personal OpenRouter key and model selection with a real account.
- Implement isolated strategy evaluation and one shared risk-validation path
  for the backtest, paper, and VALR adapters.
- Verify the paper Durable Object and its account isolation end to end, and
  implement real-account order monitoring and execution reconciliation before
  exposing explicitly authorized real trading. Verify exchange order types,
  stop/target handling, precision, and idempotency against VALR's API.
- Verify that legacy provider pause/stop controls work for any previously
  running instances without deleting their code, credentials, data, or R2
  marketplace-image support.
- Test the complete flow in a safe environment and document infrastructure,
  secrets, exchange permissions, supported markets, and known limitations.

The workspace subscribes directly to public VALR market-summary WebSocket updates,
sends a 25-second keepalive, reconnects, and marks delayed quotes. This ticker
is informational and is never used to authorize or size orders. Protocol and
reconnection behavior have unit tests; an unauthenticated ETH/ZAR subscription
was also verified against VALR on 31 October 2026.

VALR describes spot OTOCO orders in its help center, but its REST order
reference describes the documented `conditionalOrderData` field as futures-only.
Confirm the supported spot API request and its order linkage before relying on
that behavior. Conditional orders can fail or partially fill after triggering.

VALR references: https://docs.valr.com/ and
https://support.valr.com/hc/en-us/articles/360018792019-What-order-types-are-available-on-VALR.
