# VALR migration: initial market-data foundation

This branch is a partial implementation. The workspace selects VALR markets
and requests paginated VALR history for backtests; the existing cTrader
deployment flow has not yet been replaced. Do not enable real-money trading on
this basis. Existing running deployments are not stopped or modified by this code.

The branch also contains unconnected account primitives for signed VALR
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
A 429 is surfaced
as an error and is not retried automatically.

The branch contains a standalone spot-only paper simulation and serialized
durable-state runtime with mock tests for restarts, duplicate candles, stop,
minimums and retries. They are not yet bound to a deployed Durable Object or
the strategy evaluator. SELL short signals are rejected in spot paper mode;
fees and slippage are not modelled by this initial paper simulator.

## Still required before switching the product

- Add live WebSocket updates and verify the workspace and coverage UI in an
  actual deployment.
- Verify the per-user VALR connection and disconnect flows against the real
  provider, and add a separate OpenRouter key and model selection.
- Implement isolated strategy evaluation and one shared risk-validation path
  for the backtest, paper, and VALR adapters.
- Implement customer-isolated Durable Objects, paper mode, start/stop,
  recovery, account/order monitoring, and execution reconciliation before
  exposing explicitly authorized real trading. Verify exchange order types,
  stop/target handling, precision, and idempotency against VALR's API.
- Disable legacy provider flows only when the replacement is ready, without
  deleting their code, credentials, data, or R2 marketplace-image support.
- Test the complete flow in a safe environment and document infrastructure,
  secrets, exchange permissions, supported markets, and known limitations.

VALR reference: https://docs.valr.com/ (currency pairs and price buckets).
