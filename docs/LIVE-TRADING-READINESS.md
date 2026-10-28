# Live trading readiness

28 October 2026. This repository contains a demo-first implementation and local runtime fixtures. **It is not an end-to-end verified production trading service.** Demo order submission and strategy deployment are gated by default; real-money execution is hard-disabled.

## How the strategy runs

Use one `strategy.js` with the existing `onCandle` contract. The historical run replays stored candles and models fills; a running instance pins a validated hash of the same strategy and evaluates completed cTrader candles in an isolated Worker. A Durable Object schedules the strategy, records the latest evaluation and maintains the signal fanout outbox. A separate account Durable Object serializes order intents and reconciliation. The execution timeframe must match the M1, M5 or M15 alarm interval. Delayed candles and transient errors are retried with bounded backoff; a signal that has become stale is not traded.

The workspace Start/Stop control acts on the pinned instance. Stop prevents future signals and leaves existing positions open; an order already being submitted may still complete. Starting can resume previously approved demo orders. If an action times out, check the observed status before retrying. Browser health polls are observations, not uninterrupted monitoring. The live chart displays recent completed broker candles, and the Trades tab displays recent order intents and acknowledgements, not confirmed realized P/L. Backtest fills, market data and transaction costs will differ from actual broker execution. Running bots are locked against editing and backtest saves; create an independent copy for further work. A deployment attempt is recorded before contacting the runtime so an interrupted response cannot silently unlock the project.

## Deploying safely

Cloudflare R2 S3 access keys are storage credentials, not a Cloudflare Workers deployment API token. Provide the account ID and a scoped `CLOUDFLARE_API_TOKEN` to the deployment environment; do not put that management token in browser variables or the application runtime. Check the account's Worker, queue and R2 permissions against the intended resources before creating or updating anything.

1. Inventory the intended Cloudflare account, existing R2 bucket, Worker and queues. Provision the Robot and Account Durable Objects, queue and dead-letter queue without overwriting existing migration history. Set `STRATEGY_ISOLATION_VERIFIED=false` and `DEMO_TRADING_ENABLED=false` initially.
2. Provision exactly one persistent, TLS-protected cTrader gateway, with its own narrowly scoped credentials. Configure the same `TRADING_INTERNAL_SECRET` and `BROKER_TOKEN_ENCRYPTION_KEY` across the required services, and configure `CONTROL_API_URL`, `CTRADER_GATEWAY_URL` and `ROBOT_RUNTIME_URL` as appropriate. Set and register the exact `CTRADER_REDIRECT_URI` for the approved cTrader app. Store secrets only in the hosting providers' secret managers.
3. Validate Cloudflare Dynamic Worker availability and enforce CPU, network and binding isolation in the actual production account. The local CPU stress probe has not established CPU interruption, so the isolation gate must stay closed until verified.
4. Authorize hedged cTrader **demo** accounts, select the account and matching symbol, and validate permissions, price history, fresh quotes, margin, protective orders, token refresh, alarms and recovery against the real provider. Exercise duplicate delivery, stale signals, broker disconnects, lost acknowledgements and reconciliation. No provider orders have been placed by these local fixtures.
5. After provider and isolation verification, an operator can enable the demo gate on both Worker and gateway. Each user must separately approve demo execution and risk settings. Monitor the instance, broker and account directly; stopping or making a bot private pauses future activity but does not close open positions.
6. Real-money operation needs a separate reviewed implementation, provider verification and explicit user authorization. The existing real-money block must not be inferred to be removed by deploying the web UI.

## Money backtests

Enter the starting ZAR balance and instrument contract size, minimum and step volume, conversion, spread, slippage, commission and, when available, leverage in the workspace assumptions. The simulation calculates money P/L, balance, percentage returns and drawdown, estimated risk at the stop and rejected entries from those inputs. If the inputs are missing or an old saved run has no replay signals, monetary results are unavailable rather than invented. Gaps can exceed stop risk; swaps, intrabar equity and changing conversion rates are not modeled.

## Bot access

Public managed bots offer free membership; membership is separate from access to source and does not enable orders. A private bot can be shared through single-use, 256-bit access codes, with at most 100 outstanding codes per bot. Codes are shown only on creation, expire after 30 days and may be revoked; revoke expired unused codes to free a slot. The creator can make a bot private, which stops its scheduler and pauses followers. Existing positions remain open.
