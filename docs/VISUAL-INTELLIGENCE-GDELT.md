# Trading Vibes Visual Intelligence + GDELT (November 2026)

## What shipped
- Streaming-friendly Markdown rendering in the existing React/Vite chat through Streamdown.
- A restricted json-render catalog/registry with **12** components: TradeInspection, CandlestickChart, BacktestSummary, EquityCurve, BrokerAccounts, StrategyCard, RiskBreakdown, MarketSnapshot, MonitorStatus, ActionApproval, NewsSnapshot, NewsCoverage.
- Source-backed specs: `{root,elements}` use a `recordId` pointing to evidence already attached to the current authenticated response. The model cannot supply balances, fills, candles, PnL, headlines, broker tokens or arbitrary URLs through component props; the registry does not expose side-effect actions.
- Existing saved backtest / market-analysis chat cards remain in place to preserve their interaction and historical semantics. Trade inspections and GDELT responses use json-render.
- Server-side GDELT DOC 2.0 integration: `GET /api/news/snapshot?topic=gold&span=24h` and `GET /api/news/trend?topic=macro&span=7d`.
- Supported topic names: gold, forex, crypto, equities, macro, energy, global. Time ranges: 24h, 3d, 7d.
- Auth: existing Firebase bearer verification required for both routes. User-scoped request throttling (18/min), strict argument validation, 5-minute per-instance response cache, 6s upstream request pacing, deduplicated concurrent requests, 12s upstream deadline, bounded response size, HTTP 429 handling, URL and timestamp normalization, and no fake fallback headlines.
- New AI SDK tools `getFinancialHeadlines` and `getNewsCoverage`, read-only and sharing the GDELT adapter/cache with the HTTP routes.
- Existing main chat recognizes requests like “Latest Gold headlines” or “Show Gold news coverage trend” and returns real GDELT data or an explicit failure; no hidden trade execution.

## Limitations and nonclaims
- GDELT returned HTTP 429 on an external request during implementation. This is an upstream restriction; the application returns a rate-limit error instead of inventing headlines. Provider availability is not guaranteed.
- GDELT `seendate` records indexing time, **not** verified publication date. The API provides discovered headline links, **not** article content or verified causes of market moves.
- Neither GDELT nor this UI is a broker data source, news trading signal, guaranteed real-time feed or a validated sentiment model.
- The json-render catalog is implemented, but only the context types with actual fetched evidence display detailed financial data today; do not claim that every user-visible component is already wired to its own database query.
- New AI SDK tools exist at `/api/ai-sdk/chat`. The current primary chat still uses the established `/api/ai` for other conversations.
- AI-generated arbitrary layouts, full resumable UI streaming and the rest of the operating-system directive remain tasks for Work; do not let generated UI authorize trades.

## Testing
`npm test` (includes native Node TypeScript stripping checks), `npm run build`, `npm run check:runtime`, and Wrangler dry-run builds before release. Tests cover GDELT validation, deduplication, caching, rate limits, news intent, schema safety and actual React server rendering of json-render components.

## Product follow-ups for ChatGPT Work
- Connect all existing read-only authenticated portfolio, strategy, monitor and backtest data APIs to the approved registry via stable owner-scoped record IDs. Review all missing-data and consent boundaries.
- Integrate the JSON UI transport and model-selected spec streaming with the Vercel AI SDK primary chat, while preserving existing conversations, manual tool approval, Firebase persistence and app layout.
- Add external GDELT provider reliability checks/backoff metrics, and approved shared/serverless cache for multi-instance workloads. Consider official GDELT rate guidance; no aggressive retries or API key assumptions.
- Add browser/mobile visual QA, Lighthouse performance budgets, chart bundle code splitting, accessible screen-reader summaries, failure-state tests and final real-user OAuth/broker verification.
