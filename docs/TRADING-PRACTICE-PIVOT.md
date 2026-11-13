# Trading practice pivot: initial audit

Audited against main at c824a03. Existing production behavior is retained; the experimental sweep entry point in Market Replay is hidden unless `VITE_TRAINING_PREVIEW=true` at build time.

## What exists

- `src/App.tsx` owns the authenticated workspace and navigation; the landing page is separate. `CodeLibrary` opens `MarketReplay`.
- `src/components/MarketReplay.tsx` and `src/market-replay-engine.ts` provide Gold M1 replay, chart drawings, fullscreen, manual market and pending orders, cost inputs, journal and browser-local session restoration. `lightweight-charts` renders the chart. This is a useful base, not yet a workout session system.
- `src/history-cache.ts` calls the authenticated `/api/market-alert-history` endpoint. `server/alert-history.ts` loads Dukascopy bid data and caches day files through the configured store. Coverage gaps are reported rather than filled. Current replay requires an account and only Gold history is wired here.
- `src/firebase.ts`, `server/firestore-store.ts` and `firestore.rules` support existing account data. Replay saves currently use localStorage, not synchronized workout records.
- `shared/market-alerts.ts`, `workers/market-alert-worker.ts` and associated Durable Object infrastructure provide existing monitoring logic; their condition semantics must be assessed before attempting parity with the new detector.
- AI, strategy, broker and order routes remain in use elsewhere. Practice continues to use the replay simulation engine; no broker order is invoked by the new preview.

## First increment

The flag exposes an experimental sweep option in the existing replay setup. It searches actual returned M1 candles for a sweep of the preceding 20 consecutive minutes that closes back within that range; gaps invalidate the window. It opens five candles before the first match, with future candles hidden. It does not claim curated or independently verified events, does not create automatic trades, and reports zero matches honestly. The detector is a provisional definition, not yet the shared live condition engine.

## Migration plan

1. Establish a versioned moment model and definition, data provenance and reproducible fixtures; resolve historical data redistribution rights before public release.
2. Build a curated, verifiable workout catalogue and a practice-first entry point behind a flag. Include real moment counts and usable empty/error states. Avoid a guest promise until a rate-limited public history path is designed.
3. Extend replay with discrete rep boundaries, review, explicit completion, next rep and isolated session storage; ensure restart, data gaps and incomplete candles do not leak the future.
4. Add authenticated, idempotent session/rep persistence and security rules, with local offline queue and honest sync status. Preserve all legacy data and routes.
5. Extract a versioned condition engine only after reconciling its semantics with the existing alert implementation; test replay/live parity. Add worker scanning and custom workouts incrementally.
6. Measure first-rep timing, bandwidth and monitoring costs; implement Watch/PWA and commercial features only after the practice loop is verified.

## Release gates and open risks

This initial preview is not a completed workout product: there is no catalogue, next-rep flow, cross-device progress, guest access or proven 60-second journey. NFP event timestamps, London daylight-saving handling, accessible mobile and browser end-to-end behavior remain to be validated. Candle-based fills cannot resolve intrabar ordering exactly. Validate provider licensing, data quality and applicable South African regulatory requirements before commercial release. No migration or deletion is needed for this flagged increment. Do not enable the flag in production until the first workout journey is tested end to end.
