# Trading Vibes — AI-first trading desk and persistent trade provenance
Audit date: 2026-11-10. Scope: PropDAO broker, React conversation, AI SDK, Cloudflare execution journal and Firestore.

## Root cause
"Papi we losing so much why?" was intercepted by a client-side branch that forced saved robot
selection before an AI tool could look up real broker trades. A saved robot list or the selected
editor is not proof of what executed in an account. Saved backtests are simulations, not live fills.

## Implemented
Natural language -> owner-authenticated PropDAO account list -> each account's recent broker trades ->
optional bounded Worker execution events -> exact identity-based attribution -> idempotent
Firestore records -> query current Johannesburg day -> deterministic win/loss and P/L metrics ->
AI receives verified tool receipt and explains losses. No robot selection required before the read,
and no trading permission or broker order changed.

Independent authenticated endpoint: GET /api/trading-desk/today. AI tool: getTradingDeskToday.
Today uses the South African UTC+02:00 00:00–23:59 window. Response includes trade outcomes,
fee caveat, recent losers, attributable robot/group, stale/missing coverage and source metadata.
A structured card can appear between paragraphs of normal AI text.

## Firestore persistence
- users/{uid}/liveTrades/{stableHash}: account, broker trade ID, market, side, entry,
  exit, quantity, reported P/L, fees, dates and provider reason, verified bot/grant
  only when broker position or intent identity matches the Worker, provenance and localDay.
- users/{uid}/liveExecutionEvents/{stableHash}: Worker stages, bot, grant, intent and
  position reference. Not treated as proof of a closed broker trade.
- users/{uid}/liveRobotDecisions/{stableHash}: bounded decision snapshots, exact code hash,
  grant, candle time, decision, reason and actual strategy filter checks when emitted.
Deterministic document IDs make reads idempotent. Firestore day query uses localDay.
An exact provider identity found later can enrich a previously unattributed trade.

## Boundaries and caveats
- Current PropDAO recentTrades fetch supplies at most 50 records per account per request.
  Results at the limit are flagged. Retained observations survive rolling windows, but a
  trade never seen by the app cannot be reconstructed from absent data.
- Broker trades are authoritative for P/L; Worker STATUS and SIGNAL events are not fills.
  PROTECTED_FILL is an entry event, not proof of a closed trade. Worker history may be incomplete.
- Bot attribution requires exact provider position/intent identity, matching account,
  symbol and side. No fuzzy matching using price, time or current editor.
  Unattributed does not mean manual.
- Unknown provider fee inclusion is stated; do not deduct fees twice.
- Stop-loss is an exit reason, not proof of a flawed indicator condition. To diagnose
  root causes, correlate entry candle market data, exact strategy source, risk distances,
  spread, slippage and reported filter checks. Missing data remains unknown.
- One failing provider does not turn into zero-trades evidence. Report partial coverage.
- This implementation is read-through on an authenticated desk read. It is NOT guaranteed
  24/7 event ingestion. Existing Cloudflare Worker has not been redeployed.

## Roadmap to an elite data-engineered autonomous trader
P0: Durable Worker outbox for fills, orders, bracket changes and closes, signed server
ingestion to Firestore with idempotency, retry and independent recurring broker close
reconciliation. Do NOT place broker order submission behind a Firestore write requirement.
Persist provider watermarks; alert on lag and missing trade IDs.

P0: Immutable identity chain user -> account -> bot -> grant -> exact revision hash ->
intent -> provider order -> position -> trade-close ID. Never invent missing links.

P0: Owner-only Firestore Security Rules, tested authenticated access, no model access
to API secrets, runtime approvals unchanged, retention/export/delete controls.

P1: Temporal forensics for each loss: compare entry-time candles, actual EMA/ATR/RSI,
strategy decision checks, session, volatility, spread/slippage and stop distances,
then explain observed vs inferred causes. An SL reason is not enough.

P1: Semantic tool orchestration: model chooses authenticated ledger, market history,
strategy and risk tools; tools return typed provenance, timestamp and completeness.
Ask one question only after relevant reads when a missing dimension materially affects
the analysis. Keep canned workflows for explicit actions, not normal conversation.

P1: Deterministic performance engine for verified realized losses, loss streak, risk
exposure, sessions and R-multiples; AI interprets, not fabricates calculations.

P1: Production observability of data freshness, broker sync completion, outbox lag,
model tool receipts and cost. Extend provider adapters to cTrader/VALR separately.

## Acceptance conditions
- More than one saved robot and "we losing today" -> no forced robot picker.
- Verified account-wide PropDAO trades for the SAST day, no historical backtest substitution.
- Multiple reads do not duplicate Firestore records or calculated P/L.
- Worker outage still permits broker history; broker outage returns partial data.
- Missing broker identity is recorded as unattributed; never guessed.
- No strategy edits, broker permission changes, trade executions or Worker deploys.
- Automated tests do not prove actual production broker sync: use authenticated E2E verification.
