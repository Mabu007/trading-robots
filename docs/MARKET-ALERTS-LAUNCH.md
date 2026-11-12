# Gold research and personal Telegram alerts

## Release state

GitHub main at the start: `224b61d92f7d0fb670519b437c6e73e94ca066e0`.
Production alias rechecked during this follow-up: `c903098c4609ee425c67247cd9e188bb162fa09d`, deployment `dpl_9oWh3k4CwjtEG336oNsEs6yBcimX`.
Implementation: PR #114. Not released to production; the real Telegram/offline journey remains a release gate.

## User journey and primary data

New strategy creation, Markets and research preferences use BiQuote live data and Dukascopy historical data. Gold/XAUUSD is the supported launch instrument. Existing broker records, explicit legacy broker tools and deployments are preserved. This release does not deploy broker Workers, revoke trading authorizations or place orders.

Alerts lets a signed-in user describe a setup to VIBES, review the resulting rules, backtest, add a personal Telegram bot, link their chat and explicitly activate monitoring. Main chat has authenticated read/draft/research tools. Telegram conversations have no trading tools and cannot bypass review to activate monitoring.

Supported rules: live midpoint touch/above/below levels; completed-candle price, EMA, Wilder RSI, previous-N-range breakout and sweep (wick beyond the range, close inside). Any/all/sequential stages, per-condition timeframes, session timezone, expiry, one-shot/repeating and cooldown are saved. Stages advance once per evaluation. M1/M5/M15/M30/H1/H4/D1 are supported when the source returns valid candles. Subjective concepts and yesterday/session highs require precise supported definitions; do not claim unsupported concepts work.

Users can also select an owned saved Gold strategy.js. The exact R2 source SHA and execution timeframe are bound to the alert. QuickJS executes the actual onCandle BUY/SELL signals as notifications, not orders. This preserves the existing strategy contract rather than claiming arbitrary JavaScript can be translated into equivalent declarative rules. Strategies outside that contract require adaptation. Live history is bounded to 300 candles per timeframe; reliable trade volume is unavailable. These constraints are disclosed. Editing source does not change a running immutable alert; create a fresh review.

## Historical data and browser estimates

Dukascopy M1 bid candles are validated and cached in an isolated R2 prefix. Higher timeframes contain full buckets only. Calendar gaps are reported, never filled. Browser date ranges are completed UTC days, up to 31 days. Indicators warm up within that range. Historical tick alerts replay one UTC day from hourly midpoint ticks, also cached in R2. Volumes are zero placeholders for compatibility, not reported traded volume.

Declarative replay reports signal events, without inventing trade win rates or P/L. Saved JavaScript strategy replay reuses the existing browser sandbox/backtest with estimated metrics and trades. Results are bound to the rule revision and, where applicable, source SHA and daily dataset identities. Results are explicitly browser-produced estimates; no mandatory independent server replay is added for alerts. Dukascopy and BiQuote prices can differ.

## Personal Telegram bot connection

Each user can create a dedicated bot in BotFather and enter its token in Alerts. Tokens must never be entered in AI chat. The server verifies getMe, refuses an unrelated existing webhook, transactionally reserves bot ownership and encrypts credentials in server-only Firestore collections. AES-256-GCM uses the server encryption key with user identity as associated data. The token is never returned to the browser.

With explicit webhook-management consent, the server installs `/api/telegram/webhook/:botId` and a distinct secret token. A short-lived, single-use /start link then binds the private Telegram chat to the authenticated user and correct bot. Private-chat sender identity and webhook secret are verified. Expired, reused and wrong-bot links are rejected. Disconnect revokes chat bindings; bot disconnect also removes its webhook and encrypted credentials.

Telegram supports account login/OIDC, but an app bot/client registration is still needed and login alone does not supply a user-owned bot token. This release implements personal bot tokens, not an OAuth button. Optional legacy shared-bot settings remain supported.

Notifications are normal, non-silent Telegram messages; sound depends on the user's device settings. Reply-to context stores the original rule revision/event and fetches current owner-scoped state separately. VIBES uses the user's configured OpenRouter model/key. Replying “Pause this alert” pauses the referenced alert; /pause ALERT_ID is also supported. AI failures retain the inbound message and report failure. No trading tools are exposed.

## Durable monitoring and delivery safety

The new `trading-vibes-market-alerts` Worker/SQLite Durable Object namespace is isolated from all broker Workers. One shared SignalR connection per symbol fans ticks to owner-checked alert actors; fragmented frames, heartbeat expiry and reconnect are handled. A gap resets the crossing baseline and warns that intermediate touches may have been missed. Pausing/resuming establishes a new tick baseline. Missing fresh ticks appear as waiting/unavailable, not proof that conditions were absent.

Completed-candle strategies evaluate only closed candles. Per-condition inputs must be completed by the execution candle close. Shared upstream snapshots limit redundant reads. Stale quotes, closed markets and incomplete latest candles suspend evaluation. Recovery resets staged sequences and discloses gaps.

State and the notification outbox are persisted together before external sends. Worker callback retries reuse the event ID. Server delivery claims are transactional. Explicit Telegram rate-limit rejections retry with backoff; uncertain send responses are UNKNOWN and never blindly resent. A crash between send and receipt commit may leave delivery unknown: exactly-once Telegram delivery is not claimed. Delivery more than an hour late is retained as expired, not presented as a fresh signal. Pending events are bounded; backlog errors remain visible.

Pause revokes server delivery permission before asking the Worker to stop. Unknown stop results stay UNKNOWN. Source validation occurs before activation grants delivery permission. Rules, authorizations, credentials and receipts use server-only collections protected by existing default-deny Firestore rules. Existing user strategy catalogue access remains unchanged. Cross-instance control locks use separate namespaces; interrupted locks require operator reconciliation.

## Required production configuration and rollback

Vercel:
- Existing `AI_CREDENTIAL_ENCRYPTION_KEY`, or a separate `TELEGRAM_CREDENTIAL_ENCRYPTION_KEY`: base64 32-byte key. Preserve the existing key.
- `ALERT_SECRET`: separate random secret, at least 32 characters, same in the new Worker.
- `MARKET_ALERT_RUNTIME_URL`: the isolated Worker HTTPS URL.
- Existing Firebase Admin/Auth, R2 and per-user OpenRouter settings.

Cloudflare:
- Deploy only `workers/wrangler.market-alerts.jsonc`, with the new ALERTS SQLite binding.
- Configure ALERT_SECRET as a secret and ALERT_CONTROL_URL as the production origin.
- Set MARKET_ALERTS_ENABLED=true only after verifying the new binding and deployment.
- The checked-in enabled flag is false intentionally; do not deploy another broker configuration as a workaround.

A global Telegram bot/webhook credential is not required for personal bots: their secrets are stored per user and setWebhook is called on connection. Optional shared bot mode requires TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET.

Rollback: restore the previous app deployment and disable/pause only this new monitoring Worker. Preserve evidence and all broker runtimes. Never print secrets in deployment logs or source.

## Verification evidence and blockers

- **781 tests passed across 153 files**. Includes mocked HTTP linking → review → deduplicated delivery → contextual reply, tick fan-out ownership, source-validation authorization, live rules, historical validation, QuickJS execution, restart/outbox retry and cross-user checks.
- Frontend TypeScript/build, Worker TypeScript, new server TypeScript, native Node 24 API import and isolated Wrangler dry-run passed. Existing large frontend bundle warning remains.
- Real read-only Dukascopy probes: 2025-10-01 returned 288 M5 candles with zero missing M1 intervals; 10:00 UTC returned 9,362 valid midpoint ticks. These probes did not write production R2.
- Real read-only BiQuote SignalR handshake succeeded and four live ticks were observed over 18 seconds. An earlier closed/stale REST response was correctly rejected.
- Production alias still serves c903098c. No successful production release is claimed.
- Cloudflare CLI is unauthenticated. A Cloudflare API setting exists in Vercel but is a non-readable Secret; do not weaken visibility or attempt to recover it. Browser sign-in succeeded; Wrangler device authorization is awaiting user consent in that tab.
- Real personal Telegram delivery, a configured OpenRouter Telegram reply, authenticated production UI and browser-closed monitoring remain unverified. No real user bot token was available for this work.

After Cloudflare sign-in: provision/deploy the isolated Worker, verify health/bindings, configure its server connection, deploy the tested app, verify the actual alias revision, then connect a personal bot and exercise a controlled alert/reply/pause. Run the monitor with the app/browser closed and verify persisted evidence after recovery. Do not call the Gold journey launch-ready until that real test passes.
