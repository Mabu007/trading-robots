# VALR migration: initial market-data foundation

This branch is a partial implementation. The workspace still uses R2 for
historical data and the existing cTrader deployment flow. Do not describe it
as a VALR trading integration, and do not enable real-money trading on this
basis. Existing running deployments are not stopped or modified by this code.

## Public endpoints

`GET /api/valr/markets` returns active pairs and the exchange's pair fields,
including minimums and precision where VALR supplies them. It requires no
VALR key. `POST /api/valr/candles` takes `asset`, `timeframe`, `from`, and
`to`. Dates are ISO UTC candle boundaries and `to` is exclusive. It returns
at most 100 source candles per page; callers must request successive pages.
Four-hour candles are built from four complete UTC-aligned hourly candles.
Incomplete aggregates are omitted. The response reports expected and missing
candles, but an empty bucket from VALR is not proof of executed trades.

The adapter caches completed responses in process and deduplicates identical
in-flight requests. This is not a distributed cache or a cross-instance rate
limiter. VALR's public rate limits, historical depth, and pagination behavior
must be validated in the target deployment. The current tests use mocked VALR
responses; the actual exchange has not been exercised here. A 429 is surfaced
as an error and is not retried automatically.

## Still required before switching the product

- Connect the workspace to market selection, date-range pagination, and the
  VALR candle adapter, including live WebSocket updates and honest coverage UI.
- Add per-user encrypted VALR credentials, permission verification, balance
  and disconnect flows, and a separate OpenRouter key and model selection.
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
