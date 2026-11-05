# Trading Vibes integration release report

Date: 2026-11-05
Base: production SHA `d6257cbd0a8b4a2d7a40cae64abb1006136cc6cd`
Integration branch: `integration/chat-first-controlled-release` (integration base `0f51bf3`; durable-agent integration at `d514290`)
Release state: integration verified locally. The user authorized pushing and merging this branch into `main`; final remote refs and merge SHA will be recorded after the operation. No separate Vercel or Cloudflare deployment command is part of this task.

## Integration decisions

| PR or branch | Decision | Reason / boundary |
|---|---|---|
| #50 `feature/chat-first-ui` | Integrated locally | Kept its first-run, asset-optional Chat, backtest/status tool commands, confirmation cards, OpenRouter entry point, and mobile Backtest controls. Reworked the navigation to the blueprint’s Chat · Markets · Agents · You; Code and Backtest remain real Agent workspaces. |
| #48 `feature/ai-grounded-live-web-research-20261104` | Integrated locally | Retained sourced research and safer edit-intent handling. It was merged alongside Chat changes, then regression-tested. Research stays read-only and cannot authorize orders or strategy writes. |
| #49 `fix/propdao-transient-520-upstream-20261104` | Integrated locally | Kept transient handling for read-only upstream failures and continuation on a later completed candle. No retry was added for ambiguous order submissions; those still fail closed. |
| #43 `fix/propdao-live-history-diagnostics` | Integrated locally with conflict resolution | Added timeframe candle coverage and freshness diagnostics plus bounded late-candle recovery. Conflict resolution preserved #49’s ambiguous-order lock and pending-order reconciliation. |
| #53 `feat/chat-first-mobile-blueprint` | Design adopted; PR not merged | Its Chat · Markets · Agents · You direction is implemented in the local app. The PR itself still uses legacy pathways and explicitly defers detailed agent monitoring, full markets history, confirmation work, and voice. The local version connects those destinations to existing workspaces and tools. |
| #42 `feat/ctrader-r2-history` | Deferred and kept gated | Draft, non-mergeable WIP. Gateway, broker auth, monetary replay, fills, protective orders, and reconciliation have not received end-to-end broker verification. It must not be enabled from this integration. |
| `origin/codex/propdao-live-activation` | Deferred; inspect before any runtime cherry-pick | Seven unique commits cover Worker activation and pending-entry / partial-fill reconciliation. The live runtime is safety-critical; these changes need a focused diff review against the current pending-intent model and a dedicated reconciliation regression run before inclusion. |
| `origin/feat/propdao-dwellir-r2-history` | Already superseded by current history implementation | Its Dwellir/R2 history work overlaps the current server history loader. No branch-wide merge was taken; provider/cache differences need separate coverage review before further history changes. |
| `origin/feat/propdao-evaluation-backtest` | Already incorporated / superseded | PropDAO evaluation replay and risk persistence are represented in the current backtest and evaluation paths. Unique branch UI/test changes were not copied as a whole because the current implementation differs. |
| `origin/feat/propdao-live-deploy-runtime` | Already incorporated in part; no merge | Runtime, history, and confirmation pieces overlap the current PropDAO path. Current deployment readiness remains explicitly gated; no Worker activation or live confirmation was performed. |
| `origin/fix/compressed-backtest-r2` | Already incorporated / superseded | Large-result persistence work overlaps the current backtest storage paths. No separate branch merge was needed for the current chat-first release. |
| `origin/fix/propdao-live-workspace-and-runtime` | Deferred | Contains useful unknown-status, polling, and live-trade isolation fixes, but changes the live runtime and API. Not bundled without a targeted safety review. |
| `origin/fix/propdao-multibot-stop-ui-ai-20261104` | Deferred | Multi-bot and stop behavior includes useful safe pre-submit classification, but also touches Worker order state and broad UI/API behavior. Keep isolated until separately reconciled and tested. |
| `origin/fix/propdao-pause-play-backtest-live-trade-details` | Deferred | Pause/resume authorization and stop semantics need dedicated live-runtime verification; not treated as a visual-only UI patch. |
| `origin/fix/propdao-reconciliation-backtest-rr-20261104` | Rejected for this release | Diff includes account-scoped recovery, entry-fill guards and backtest changes, but also alters reconciliation and execution assumptions. It is not safe to merge wholesale without review of the changed risk/fill semantics and dedicated broker-state tests. |
| `origin/fix/workspace-persistence-ai-audits-20261104` | Deferred / partly superseded | Contains useful backtest persistence and AI audit context. This release keeps the current saved-result model and adds persistent conversations; the branch changes affect engine/result metadata and need a separate parity review. |
| `origin/fix/propdao-live-trades-fullwidth-20261104` | Superseded | Small workspace layout patch is replaced by the new responsive Agent/Backtest layout. |
| `origin/fix/prop-results-output-tab` | Already incorporated / superseded | Current result output and PropDAO evaluation tabs remain in the workspace; no branch cherry-pick was required. |
| `origin/fix/goldusdc-public-r2-fallback-20261103`, `origin/fix/goldusdc-r2-archive-20261103`, `origin/fix/goldusdc-all-timeframes-r2-20261103` | Already incorporated / superseded | Gold history/cache behavior is covered by the current data services. No whole-branch merge was taken. |
| `origin/codex/bot-start-stop`, `origin/codex/stop-order-clarity`, `origin/codex/live-trading-e2e`, `origin/codex/money-library-summary`, `origin/codex/propdao-runtime-deployment`, `origin/codex/propdao-runtime-safety`, `origin/codex/ui-readiness`, `origin/codex/valr-account-launch`, `origin/codex/valr-live-runtime`, `origin/codex/valr-market-data-foundation`, `origin/codex/venue-selection`, `origin/fix/email-login-workspace-reliability`, `origin/fix/migrate-legacy-package-covers`, `origin/fix/mobile-creator-nav-and-profile`, `origin/fix/mobile-scroll-and-bot-home`, `origin/fix/profile-auth-layout`, `origin/fix/queued-backtest-range`, `origin/codex/chart-backtest-ai`, `origin/codex/four-venue-foundation` | Already included or stale; not merged | Patch-equivalent commits are already on `main`, or the branch has no unique patch commits. The actual branch ancestry and patch IDs were checked; presence on GitHub was not treated as evidence that a change was missing. |
| `trading-robots-old-version` | Rollback reference only | Matches the production SHA exactly. No changes were made to it. |
| Durable agent identity work | Integrated locally on `integration/chat-first-controlled-release` | Adds owner-scoped agent records, permission state, strategy-version linkage, audit history, live-runtime linkage and backtest lifecycle recovery. It does not create an agent for a chat. |

## Implemented in this integration

- Signed-in users open Chat, including accounts without an existing robot or selected market. Main navigation is Chat · Markets · Agents · You; Backtest and Code open the actual agent workspaces.
- Conversations persist separately from agent execution. Chat stays mounted while the user changes tabs so a long-running backtest does not disappear with the tab switch.
- Markets shows venue catalogue data and requests historical candles through the existing history service. It labels data source and timestamps, reports unavailable data honestly, and does not invent live quotes. cTrader is visibly gated.
- Agents shows the user’s saved bots and verified runtime data where available; unverified venues are labeled as such. Chats remain independent. A durable Firestore agent identity is created only when a saved strategy starts a historical backtest or an execution deployment is explicitly authorized. Each record is owner-scoped and tracks asset, venue, strategy hash/revision, configuration, permissions, active run or grant, status and append-only audit events. Live records link to the existing PropDAO/VALR Durable Object grants and read real runtime status; no parallel execution Worker or order path was added.
- Backtests continue to use the existing historical engine. Their Firestore lifecycle record heartbeats while the browser run is active, records the verified result summary and exact strategy hash, retries completion sync while the app remains open, and marks a run interrupted after its heartbeat expires. This record is not a server-side durable backtest executor: closing or freezing the browser can interrupt a historical run, which is surfaced rather than left running indefinitely.
- Chat orchestration uses a server-side OpenRouter tool-selection request with a closed allowlist, strict argument validation, and deterministic app execution. Status and backtest are read-only; deployment, stop, create and code edits require review or user action. Stale, replayed or identity-changed review cards expire or reject.
- Strategy edits are syntax/configuration validated and shown with current/proposed source before application. Live-locked or unverified agents cannot have code applied.
- OpenRouter onboarding supports PKCE and secure manual-key fallback. User keys are encrypted server-side with per-user and environment-specific storage paths, validated as standard inference keys, and never returned to the browser. The UI shows model pricing and current provider-enforced key limit/usage with a direct limit-management link.
- Firebase-backed agent creation now uses atomic Firestore transaction writes with explicit document-existence preconditions, so both first-time agent/audit creation and updates work with Firestore's REST transaction API. Cross-user route access is covered by authenticated fixture tests. Production Firebase server credential variable names are configured; preview server credentials were not present during the read-only environment check.
- Added a network-only installable PWA shell and a notification worker stub. Push subscription/sender and voice are not presented as complete features.
- PropDAO 520 read handling, next-candle recovery, candle diagnostics, and fail-closed ambiguous order semantics are retained.
- Added a persistent light/dark appearance preference, with light mode as the first-run default, an accessible header/account toggle, and theme-aware charts, editor, and primary workspaces. The preference is stored per browser and applied before React paints.
- GitHub workflow install uses `npm ci`; this is reproducible-lockfile usage, not a CI check bypass.

## Changed files

Application and presentation:

- `index.html`
- `src/App.tsx`
- `src/chat-first.css`
- `src/chat-commands.ts`
- `src/chat-commands.test.ts`
- `src/chat-intent.ts`
- `src/chat-intent.test.ts`
- `src/studio-polish.css`
- `src/components/TradingDestinations.tsx`
- `src/components/trading-destinations.css`
- `src/components/Marketplace.tsx`
- `src/components/OpenRouterDialog.tsx`
- `src/components/ValrLiveQuote.tsx`
- `src/components/ui/DateRangePicker.tsx`
- `src/strategy-documentation.ts`
- `src/strategy-documentation.test.ts`
- `src/action-review.ts`
- `src/action-review.test.ts`
- `src/main.tsx`
- `src/theme.ts`
- `src/theme.css`
- `src/theme.test.ts`
- `src/firebase.ts`
- `src/agents.ts`

Server, authorization, and tests:

- `server/index.ts`
- `server/agent-registry.ts`
- `server/agent-registry.test.ts`
- `server/openrouter-credentials.ts`
- `server/openrouter-credentials.test.ts`
- `server/firestore-store.ts`
- `server/firestore-store.test.ts`
- `server/propdao-live-routes.ts`
- `server/valr-live-routes.ts`
- `server/valr-live-routes.test.ts`
- `shared/valr-live-authorization.ts`
- `server/ai-research.ts`
- `server/ai-research.test.ts`
- `server/chat-tools.ts`
- `server/chat-tools.test.ts`
- `server/chat-tools-routes.test.ts`
- `server/openrouter-account.ts`
- `server/openrouter-oauth.ts`
- `server/openrouter-oauth.test.ts`
- `server/propdao-live-history.test.ts`
- `workers/propdao-live-history.ts`
- `workers/propdao-live-object.ts`
- `workers/valr-live-object.ts`
- `workers/propdao-upstream-response.ts`
- `workers/propdao-upstream-response.test.ts`

Research documentation:

- `docs/ai-web-research.md`

Build, local QA and release:

- `.github/workflows/marketplace-checks.yml`
- `package.json`
- `vite.config.ts`
- `vitest.config.ts`
- `scripts/dev.mjs`
- `public/manifest.webmanifest`
- `public/sw.js`
- `docs/INTEGRATION-RELEASE-REPORT.md`
- `qa/firebase-fixture.ts`
- `qa/network-fixture.ts`
- `qa/responsive.html`
- `qa/vite.config.ts`

## Verification results

| Check | Result |
|---|---|
| `npm test -- --run` | PASS — 63 files, 364 tests, including light/dark preference, agent isolation/lifecycle, duplicate-run prevention, Firestore transaction creation, Firebase ownership and OpenRouter credential tests. |
| `npm run build` | PASS — Vite production bundle created. Warning: app JavaScript chunk is 747.75 kB minified (232.56 kB gzip), above Vite’s 500 kB advisory threshold. |
| `npm run check:runtime` | PASS — Worker TypeScript compilation. |
| PropDAO Worker dry-run | PASS — 628.97 KiB bundle; no Worker was deployed. |
| VALR preview Worker dry-run | PASS — 624.29 KiB bundle; `STRATEGY_ISOLATION_VERIFIED=false`. |
| VALR live Worker dry-run | PASS — 643.63 KiB bundle; `VALR_LIVE_ENABLED=false`, `VALR_PROTECTION_LINKAGE_VERIFIED=false`, `STRATEGY_ISOLATION_VERIFIED=false`. |
| `npm run test:valr-paper` | PASS — fixture only; candle processed and stop recovered. |
| `npm run test:valr-live` | PASS — mocked exchange; duplicate blocked, protection reconciled and restart recovered. No real orders. |
| `npm run test:valr-live-runtime` | PASS — local Worker/QuickJS and alarms with mock exchange; owner isolation and restart recovery verified. No real orders. |
| Browser smoke | BLOCKED — connected Chrome could not reach the local Vite server, and the cloud browser blocked the local preview URL. No authenticated or visual browser evidence is claimed for this pass. The responsive QA fixture exists but does not substitute for a rendered browser check. |
| `git diff --check` | PASS — no whitespace errors. |

The repository GitHub Actions check failures were reported as an account billing lock. The code change to `npm ci` does not resolve that account-level block; hosted CI still needs to be rerun when GitHub billing is restored. UI fixture evidence is not a substitute for authenticated Firebase/Firestore or broker integration tests.

Passing builds and mocks are not proof of live-trading safety. No real broker account, live order, live Worker, production Firestore, or production credential was used in this verification.

## Remaining work and blockers

- Re-enable and verify hosted GitHub Actions after resolving the billing lock.
- Run authenticated Firebase/Firestore integration tests, especially cross-user conversation and agent ownership on a configured preview environment. Current agent and Firestore tests use fixtures; production Firestore was not touched. Preview Firebase Admin credentials also need to be added before a preview can exercise the new server-side agent routes.
- Verify OpenRouter OAuth against a real user-authorized account and verify provider-enforced spending limits; current OAuth tests use mocked provider responses. Production has the BYO encryption-key variable; a branch-scoped preview encryption key was not present for this integration branch. Current OpenRouter documentation supports the implemented `/auth` PKCE flow and single-use `/api/v1/auth/keys` exchange.
- Complete reviewable action-card details and backend-bound authorization for all live deployment, stop and strategy mutations. Existing app confirmation gates remain authoritative; chat cards only open those existing review flows.
- Agent identities and permission/audit records are now separate from conversations and are linked to the existing bot and Durable Object infrastructure. They are not a new Durable Object class. Historical backtests still run in the existing browser engine; moving those computations into a persistent server-side worker is a separate change. This release does not create AI-generated trade approval cards or submit proposed orders.
- Keep cTrader disabled until broker-auth, fill, protection, monetary replay, reconciliation and restart tests pass end to end.
- Voice conversations are not implemented. Push subscriptions/sending are not implemented; service-worker notifications are informational only.
- Improve chunk splitting before release if desired; the current build emits a size advisory, not a build failure.
- Run real-device keyboard, screen-reader and authenticated account smoke tests. Browser coverage in this report is the isolated local fixture.

## Deployment and rollback plan

1. The integration branch is pushed once after local tests. The pull request is merged to `main` only after its final diff and checks are inspected. GitHub-to-Vercel automation may start as a consequence of this requested merge; no separate manual deployment or promotion command is issued.
2. Verify the resulting `main` commit and any automatic Vercel deployment status. Do not deploy Cloudflare Workers as part of the web merge.
3. Treat Cloudflare Workers as a separate release: deploy only after reviewing Worker-specific secrets and bindings; verify health, disabled-by-default flags, owner isolation, order-intent state, ambiguous-outcome behavior, protective exits, duplicate-order blocking, reconciliation, alarm recovery and stop semantics using venue test accounts. Do not enable live gates until those checks and explicit release approval pass.
4. For rollback, restore production source to `trading-robots-old-version` (`d6257cbd0a8b4a2d7a40cae64abb1006136cc6cd`) through the normal controlled Vercel rollback process. Roll Worker code back separately to its prior verified Worker release. Do not modify Firestore, accounts, bot state, broker connections, or historical records during rollback.
