# Gold research and Telegram alerts — implementation handoff

Starting GitHub main: 224b61d92f7d0fb670519b437c6e73e94ca066e0.
Production alias checked during implementation: c903098c4609ee425c67247cd9e188bb162fa09d.

## Implemented path

Scheduled → Market alerts lets signed-in users describe a setup, review an AI-created draft, replay its exact rules on Dukascopy history, link Telegram and explicitly activate monitoring. Main VIBES chat also receives draft/read/market tools. Only the review UI can activate monitoring. Telegram tools cannot activate alerts or place orders.

The new Worker and Durable Object namespace are separate from all broker and existing code-watch Workers. No broker runtime or authorization is modified.

Supported first-release rules: XAUUSD, one completed-candle timeframe (M1/M5/M15/M30/H1/H4), price close above/below, EMA, Wilder RSI, previous-N-range breakout and sweep (wick outside, close inside). Any/all/sequential stages, expiry, session timezone, one-shot/repeating and cooldown are saved in immutable rule drafts. Stages advance once per candle. Revising creates a fresh draft; pause the old alert before replacing it.

Unsupported requests must be explained: tick-level price touches, yesterday/session highs, arbitrary JavaScript execution, multi-timeframe rules and automatic trade execution. Existing arbitrary-strategy browser backtests are preserved separately; converting an arbitrary saved strategy into alert rules requires review and is not automatic.

Historical alert replay counts detections, not trades: no entry/SL/TP model is defined, so trade P/L/win rate is not manufactured. Browser replay results are saved with their rule revision as browser-produced estimates. The existing strategy trade backtest remains available separately.

Dukascopy M1 bid candles use a separate R2 prefix, validated before caching; full higher-timeframe buckets only. Calendar gaps are disclosed, never filled. Historical replay requests one UTC day at a time, max 31 days in the UI. Indicator warm-up is within the selected range. The live evaluator uses a bounded 300-bar window, shared with replay. BiQuote reads are cached by symbol/timeframe in a shared DO; closed/stale quotes and missing latest candles suspend evaluations. Feed recovery resets staged sequences and discloses possibly missed events.

The DO persists rule state and pending outbox together. It retries failed callback transport requests using the same event ID. Firestore claims each delivery transactionally before Telegram send. Known rate-limit rejections retry with backoff, up to five retries. Lost/ambiguous send responses are UNKNOWN and never blindly resent. A crash after send but before receipt commit may leave delivery unknown; exactly-once delivery is not claimed. Pending outbox rows are retained. Pausing revokes server delivery permission before requesting Worker stop; unconfirmed stop is UNKNOWN.

## Required production configuration

These new production environment names were absent when inspected. Do not paste token values into chat, logs or source files.

Vercel:
- TELEGRAM_BOT_TOKEN (create a dedicated bot with BotFather)
- TELEGRAM_BOT_USERNAME (username without @)
- TELEGRAM_WEBHOOK_SECRET (random, at least 32 characters, Telegram-compatible characters)
- ALERT_SECRET (separate random secret, at least 32 characters)
- MARKET_ALERT_RUNTIME_URL (new Worker HTTPS URL)

Cloudflare new Worker:
- ALERT_SECRET (same value as Vercel)
- ALERT_CONTROL_URL=https://trading-robots.vercel.app
- MARKET_ALERTS_ENABLED=true only after the new bindings/config are verified

Deploy ONLY workers/wrangler.market-alerts.jsonc for this feature. Never deploy another checked-in broker Worker configuration as part of this release. Configure secrets in the provider dashboards or CLI without printing values. Verify the ALERTS binding points to the new MarketAlert SQLite class.

Register Telegram setWebhook with URL https://trading-robots.vercel.app/api/telegram/webhook, secret_token matching TELEGRAM_WEBHOOK_SECRET, allowed_updates=["message"]. Keep pending updates; do not drop them. /start tokens are single use and expire after ten minutes. Linking requires private chat and matching sender/chat identity. Disconnect revokes both owner and reverse chat bindings.

Telegram replies retain the original rule revision/event for reply-to messages and fetch current owner-scoped status separately. Free-form replies use the user's configured OpenRouter model/key with read/draft tools only. Replying exactly “Pause this alert” to an alert pauses that alert; /pause ALERT_ID also works. AI failure is reported and the incoming message remains saved. Webhook update IDs prevent duplicate handling; unconfirmed processing is retained for investigation rather than repeating uncertain external sends.

## Verification status

- New unit/integration tests cover rules, freshness, historical cache, account linking, ownership, immutable review, delivery deduplication, Worker restart/outbox retry and Telegram HTTP flow with mocked transport/model.
- Node 24 native API import compatibility checked.
- Live Dukascopy probe: 2025-10-01 XAUUSD, 288 M5 candles, zero missing M1 intervals. This probe did not write production R2.
- Live BiQuote probe returned stale/closed data and was correctly rejected. Continuous fresh live operation is not yet verified.
- Wrangler dry-run bundle succeeds for the separate alert Worker. Local Wrangler is not authenticated; deployed Cloudflare bindings/version are unverified.
- No real Telegram delivery, real configured model conversation, authenticated browser journey or production release is claimed.

## Release gate and next verification

After credentials and Cloudflare access exist: deploy the new isolated Worker, verify health and bindings, configure webhook, deploy the tested app revision, check production alias revision, then link a real user and test a controlled notification/reply/pause. Test a fresh market condition with the browser closed. Confirm stale feed and recovery behavior using the live feed. Preserve existing broker deployments throughout.

Do not call this launch-ready until that real end-to-end journey passes. Revert the app commit and disable/pause only this new Worker for rollback; do not delete evidence or alter broker Workers.

Authorization records, Telegram bindings and delivery receipts live under server-only top-level Firestore collections, rather than the client-writable users tree. Existing Firestore default-deny rules protect them without changing user rules. Alert control reuses the existing cross-instance account-lock primitive with a separate namespace. Interrupted control locks require operator reconciliation. Incoming Telegram updates retain their text/context identifiers and processing outcome; linking tokens are redacted from those records.

Final automated validation: 773 tests passed across 151 files (`npm test -- --maxWorkers=2 --testTimeout=15000`), including the mocked Telegram HTTP scenario. Production frontend build, Worker type-check, new server TypeScript check, Node 24 native API import, and isolated Worker dry-run passed. Build retains the existing large-bundle warning. These checks do not establish a real configured-model/Telegram/browser production journey.
