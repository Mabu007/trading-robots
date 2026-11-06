# Phase 2: production-authenticated acceptance gate and release handoff

**Date:** November 6, 2026. **Repository:** Mabu007/trading-robots. **Protected work branch:** codex/phase2-complete.
**Baseline deployed main:** `7400ac4f5f034f435324d17e4bcfe7be9ccc446b`.
**Do not claim Phase 2 fully verified or enable the primary SDK build flag until the real signed-in user workflow below succeeds.**

## What was verified in this run

- Against the real **public Hyperliquid API**, `createAgentBacktestTool` fetched and validated 120 completed BTC M1 candles and evaluated a WAIT-only test strategy in the QuickJS WebAssembly sandbox. Reported 120 records / zero missing / zero sample trades; **no live orders**.
- A separate live public Hyperliquid `xyz:GOLD` M1 candle request returned **120 completed candles**, zero missing, zero gaps. This is a Hyperliquid derivative; it does not establish a PropDAO `GOLDUSDC` fill.
- The connected Browser read-only view of the signed-in Trading Vibes application showed an authenticated user workspace and a saved Code library. This is **not** proof that the new SDK / approval / R2 E2E workflow succeeded. Browser tools here cannot act using the private session.
- The Vercel project environment metadata confirms the presence of Firebase Admin, R2 and OpenRouter variable names. This does **not** verify token values, entitlement, provider access, rate limits or deployed resource connectivity.
- Local HTTP integration fixture (test-generated Firebase-compatible RSA identity and mocked Firestore/R2/Hyperliquid) verified anonymous rejection, signed authorization, exact strategy approval, prevention of double consumption, and bounded QuickJS backtest through real Express routes. This fixture is NOT a live authenticated Firebase or Firestore/R2 test.
- The SDK React path remains build-flagged and the execution-boundary approval is server-flagged. The legacy production chat and manual review route are unchanged.
- An authenticated `GET /api/agent/capabilities` exposes flags without making any writes. The SDK editing UI prefers staged server approval when the server advertises it and otherwise retains legacy human-reviewed code updates.
- An authenticated rate-limited `POST /api/agent/backtest/verify` evaluates the same user-owned Hyperliquid tool directly, without requiring the LLM to choose it. It is read-only and gated by `AI_SDK_SERVER_BACKTEST_ENABLED=true`.
- The new staged SDK strategy edit refuses cTrader when gateway stopped-state verification is not available. It does not authorize broker orders, deployments, risk changes or disconnected-account operations.
- The function package explicitly includes the QuickJS strategy runtime's source dependencies. Validate actual Vercel Node bundling in a staged deployed function.

## How to execute the real production-like integration test

**A. Safe environment:** Have Work's authenticated Cloud Browser or another authorized test runner create two *disposable* ordinary Firebase email/password accounts named `tv-phase2-e2e-<random>@example.com` or `example.test`. Never use an owner's trading account to create test orders or change strategy state.

**B. Staged build:** Using Vercel's protected production-like deployment environment, turn on the two server flags **only for the staged test**:
- `AI_SDK_STRATEGY_APPROVAL_ENABLED=true`
- `AI_SDK_SERVER_BACKTEST_ENABLED=true`

Keep production `VITE_AI_SDK_CHAT_ENABLED` unset/false until all gates pass. A staged build may enable it explicitly for user-interface E2E. Preserve a known-good rollback deployment.

**C. Test runner:** In a trusted CI/Work execution environment, inject `TV_E2E_ID_TOKEN` and `TV_E2E_SECOND_ID_TOKEN` from the two test Firebase sessions as **secure transient process environment values**, not into chat, GitHub issues, script arguments, logs or committed files. Set `TV_E2E_FIREBASE_PROJECT_ID` to the public project ID and `TV_E2E_BASE_URL` to the exact staged deployment URL. Then invoke:

`TV_E2E_ALLOW_WRITES=1 node scripts/phase2-real-auth-e2e.mjs`

This script refuses a human account (requires `tv-phase2-e2e-...` email), creates a single temporary test strategy, checks real Firestore + R2 access, approval stage/approve/apply and replay rejection, executes an exact-instrument Hyperliquid QuickJS simulation, verifies ownership isolation with the optional second test account, and removes its test Firestore/R2 documents. Verify cleanup was reported as successful. **Do not mark green if any cleanup failed.**

**D. OpenRouter:** For a real model/tool selection test, connect the first disposable Firebase test user to an explicitly authorized test OpenRouter account with a limited budget. Set `TV_E2E_MODEL=1` before invoking the harness. The test makes a real model call and checks that it selects `getSavedStrategy`. A missing test-account OpenRouter connection is a blocker, not a passing test; do not repurpose the owner's API key.

**E. Browser parity tests:** In the real logged-in browser validate two conversations, restoring a conversation after refresh, stream cancellation, a strategy review modal, approved and denied changes, isolation after sign-out/sign-in, tool trace, retry, error recovery and mobile presentation. Note that an API-only test cannot prove React `useChat` parity.

**F. CI and release:** The previous GitHub Actions `verify` job did not start because of an account billing lock. Repair the GitHub billing condition and obtain a real green check. Run Node 24 `npm ci`, `npm test`, `npm run build`, `npm run check:runtime`, and all touched Worker dry runs.

Only after all of these gates pass should Phase 2 be merged **once** into `main`, deploy **once** to Vercel and verify the exact SHA, aliases, runtime logs and rollback. If any gate remains unverified, leave the code on the protected branch and report it honestly. No Cloudflare Worker needs deployment unless its source or configuration actually changed.

## Unverified, not to be reported as completed

- Real signed-in `/api/ai-sdk/stream` using a user-managed OpenRouter key and observed server tool invocation
- Actual authenticated Firestore approval transactions, R2 stage/write/read/cleanup and replay checks against deployed infrastructure
- Deployed serverless QuickJS packaging and productionlike function execution
- Real account switching, conversation persistence and browser cancellation on SDK path
- Live financial order approval and risk-change enforcement (not part of this release; remain with native adapters)
- GitHub Actions green CI (billing lock remains outside this codebase's control)

Do not switch to Phase 3 on the assumption that these checks have passed. The saved code, mocked HTTP fixture, and live Hyperliquid read-only checks are useful progress, but they are distinct evidence categories.
