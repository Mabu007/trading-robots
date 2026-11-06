# Phase 2 continuation checkpoint - not complete

Base when this work began: main 7400ac4f5f034f435324d17e4bcfe7be9ccc446b. Inspect the latest main, this branch, issue 62 and Phase 1 and Phase 2 handoffs before continuing. Keep the production SDK flag off until all acceptance gates pass.

## Implemented in this checkpoint
- Integrates the installed AI SDK's React useChat lifecycle in the existing opt-in path using a compatibility transport to the authenticated SDK stream. The pre-existing client chat and action cards remain; the legacy path remains the production default. On SDK path the model and token, streaming callbacks, output-limit continuation and abort are preserved.
- SDK tool call/result events are sent to the compatibility transport as structured parts. A bounded per-message user-visible tool trace is persisted alongside the existing user-owned chat record. These client-side snapshots are not a server-canonical financial record or an authorization decision.
- Cancels opt-in SDK requests on owner or conversation changes and checks the current chat scope before applying streamed text or results.
- Adds an SDK-based, authenticated planner endpoint for the opt-in path. It can propose an action but cannot execute or approve it; current confirmation and platform handlers remain in place.
- Adds SDK read tools for owner-checked agent runtime and CodeWatch status. A missing, unavailable or unverified runtime is not reported as a confirmed running monitor.
- Adds an atomic approval-intent storage component with owner/action fingerprint, connection/account, instrument, strategy version, parameters, risk snapshot, expiry, deny and single-use transitions. It does not execute trades and is **not wired to any broker endpoint or UI**. Never treat its presence as protection for existing execution routes.
- Branch-specific Vercel git configuration disables automatic deployment for codex/phase2-complete. Do not remove this checkpoint protection until ready for a single intended production release.

## Checks
On Node 24 in the isolated sandbox, the latest full npm test run passed 464 tests in 89 files; npm run build and npm run check:runtime passed. PropDAO and VALR paper/live Worker dry runs passed earlier in this same working state; no Worker source was changed. Focused SDK tests exercised cancellation, output limits, authenticated test-token requests, a mocked SDK model and owner-scoped mocked strategy/backtest tool calls. Real Firebase/model, user interface, Cloudflare, broker and provider action verification remains outstanding. GitHub Actions previously did not start because the account is locked due to billing; verify current annotations.

## Still required to finish Phase 2
- Replace the remaining client-side planner/command execution with authenticated typed SDK strategy-edit, actual backtest execution, live trade, broker and monitor workflows. The SDK planner currently only proposes and existing UI executes selected local flows.
- Connect a durable approval flow to user-visible review and to every sensitive execution boundary. Independently recheck ownership, current account, instrument, exact parameters, strategy version and risk; make order intent idempotent and reconcile uncertain outcomes. Approval-intent records alone are not a live-trading authorization system.
- Move from compatibility SSE and client-owned tool snapshots to native SDK UI-message streaming with authenticated server-canonical persisted messages, tool results, resumable task and approval state; complete progressive capability discovery, per-tool health, cost and limits. Ensure cancellation and owner/conversation changes cannot accept stale asynchronous results throughout all chat and action paths.
- Verify real authenticated conversation restoration, strategy discovery/edit proposal, a real or fixture-backed executed backtest, live trade context, monitor and broker status, approval and denial/expiry/replay/race, concurrent chats and cancellation. Fixture tests are not production verification.
- Validate real OpenRouter account/model and app-user flows, provider failures and complete UX on desktop and mobile. The preview previously lacked backend credentials; do not claim that a health check proves these workflows. Resolve GitHub billing lock before depending on GitHub Actions.
- After parity, approvals, real-user verification and exact-head tests are complete, switch the SDK primary path, remove obsolete orchestration and perform one final authorized merge/deployment. Coordinate with the user about any explicit authorization needed for real financial writes; never place real-money test orders.

This checkpoint is a recoverable partial branch, not permission to move to Phase 3 or claim the full directive complete.


## Additional implementation in the safe continuation branch (do not mark Phase 2 complete)

This branch has been extended in a separate named Vercel Sandbox without any Vercel project deployment or main-branch merge.

### Implemented in this continuation
- Owner-scoped SDK strategy/agent discovery with bounded, allowlisted metadata and private-tool capability selection. Unrelated public market research no longer receives private user tool schemas. Authorization remains independently enforced inside each tool.
- Read-only broker connection metadata for PropDAO, cTrader and VALR. No credentials or financial order tools are exposed. Stored connection state is not represented as live broker readiness.
- An exact-market, read-only Hyperliquid backtest tool using the existing isolated QuickJS WebAssembly runtime and deterministic R-based simulation. It verifies owned R2 code and Firestore metadata, rejects non-Hyperliquid brokers and venue mismatches, rejects missing candle ranges, and never submits orders. It is **disabled by default** behind server env `AI_SDK_SERVER_BACKTEST_ENABLED=true` and only offered for explicit backtest requests. It is not a general monetary or broker-accurate backtest engine.
- An authenticated three-stage approval flow for SDK-generated saved strategy edits: stage code + expected hash, approve on a user-clicked review control, and apply with exact single-use approval consumption under the existing VALR/PropDAO bot locks. It verifies strategy ownership, venue and unchanged source at commit time. The legacy manual PATCH path remains untouched in behavior. The new path is **disabled by default** behind server env `AI_SDK_STRATEGY_APPROVAL_ENABLED=true`. No SDK tool can approve or execute orders.
- Node 24 native TypeScript import compatibility for shared QuickJS strategy sandbox and simulation utilities, plus extensive ownership, data-integrity, expiry, concurrency and UI/runtime regression tests.

### Validation of this continuation before publication
- Node v24 sandbox `npm ci` succeeded.
- `npm test` **487 passing tests / 93 files**.
- `npm run build` passed.
- `npm run check:runtime` passed.
- `npm run worker:valr:build`, `npm run worker:valr:live:build`, `npm run worker:propdao:live:build` all passed as Wrangler dry runs.
- No live-money orders, risk-limit changes or remote broker writes were performed.

### Outstanding Phase 2 blockers and release guard
- **Do not switch `VITE_AI_SDK_CHAT_ENABLED` to true in production yet.** The production legacy path remains the default. Real signed-in OpenRouter, Firebase, Composio, broker and R2 acceptance testing is still required.
- The QuickJS tool is currently a bounded Hyperliquid OHLC R-based simulation, not real broker execution parity, monetary accounting, or persisted server-owned backtest results.
- The new approval flow protects *reviewed strategy code changes on the SDK path* only. Do not claim it has been wired into live broker orders, live strategy deployments or risk changes; those remain behind the existing native approved workflows.
- Approved code changes require explicit user UI action; never expose the approve/apply endpoints as LLM-callable tools.
- GitHub Actions remained blocked by account billing in the previous handoff. Recheck before final merge; independent sandbox tests are not CI.
- Check actual Cloudflare Workers, R2 datasets, auth and broker account configurations through authorized connectors before claiming external verification.
- Keep automatic Vercel deployment disabled for `codex/phase2-complete`. Do not merge until all Phase 2 acceptance criteria are satisfied, or the user explicitly authorizes releasing a partial feature-flagged build.

### November 6 final verification attempt
- Confirmed actual disposable Firebase Auth signup, production API authentication, production R2 write/read and cleanup, signed-in Firestore write/read and cleanup. All returned success (HTTP 200); test Firebase Auth user deletion also returned HTTP 200. No private user credentials used.
- Confirmed real Hyperliquid completed BTC M1 data, 120 candles, evaluated by QuickJS sandbox with a WAIT-only simulation. No live orders.
- Added signed HTTP fixture for staged review and server-run simulation, plus strict QA-UID-only test gating. Full test suite **493 passed across 95 files**, build/runtime passed. See `docs/PHASE-02-REAL-AUTH-VERIFICATION.md`.
- Remaining live E2E: actual OpenRouter model tool use, new approval Firestore transaction and R2 integration under a deployed Vercel function, and deployed QuickJS route. Because the branch is not deployed and no authorized test model connection exists, **do not merge, enable global flags or mark Phase 2 complete**.

### Protected QA preview checkpoint 2026-11-06
Both manual protected previews built READY; no production merge or alias promotion.
Test-only expiring signed-header free-model gate committed at 98edfabb; normal users are unaffected. Future branch preview QA flags reset to false.
Preview cannot verify server Firebase Admin approval path because Admin credentials are production-only. The external disposable E2E command was blocked by execution safety before running.
Local suite 495 tests / 95 files; build/runtime passed. Release remains HOLD. See PHASE-02-REAL-AUTH-VERIFICATION.md.
