# Phase 3 handoff — Phase 2 acceptance exception

Date: 2026-11-06. Repository: Mabu007/trading-robots. Release source: PR #67, branch `codex/phase2-auth-rollout-validation-20261106`.

## Acceptance decision

The owner explicitly accepted the remaining Phase 2 external-verification gaps on 2026-11-06 to begin Phase 3 and defer them to a system-wide debug on a local PC. This is a **feature-flagged code release**, not evidence that the SDK chat, approvals, or QuickJS backtest work end to end in production. Keep global flags off until the corresponding real authenticated tests pass. Do not report unverified gates as passed.

Local Node 24 checks on the branch: `npm ci`, 496/496 tests across 95 files, `npm run build`, `npm run check:runtime`, and dry-run bundles for VALR paper/live, PropDAO live, CodeWatch, and cTrader gateway passed. GitHub Actions verify remains blocked before steps by account billing. No live orders or risk changes were made.

## Current runtime

- React/Vite app, Firebase Auth and Firestore user records. Default chat is legacy. `VITE_AI_SDK_CHAT_ENABLED=true` opts a build into AI SDK `useChat` compatibility streaming and tool traces; it is a build switch, not an authorization gate.
- `server/index.ts` hosts Firebase-authenticated SDK streaming, scoped tool selection, read-only user-owned strategy/agent/monitor and native broker connection metadata, plus gated review/backtest endpoints.
- `server/agent-backtest-tools.ts` reads owner-checked Firestore metadata and R2 strategy source, exact Hyperliquid completed OHLC candles, and uses QuickJS Wasm for bounded deterministic **R-based simulations**. No broker fills, monetary parity, funding, spreads, or live orders. `AI_SDK_SERVER_BACKTEST_ENABLED` defaults off.
- `server/strategy-approval-flow.ts` and `server/approval-intents.ts` stage exact source changes, validate owner/venue/source, require a UI approval, and consume a single-use expiring intent under bot locks before writing R2. These endpoints do not authorize live broker orders, deployments, or risk changes. `AI_SDK_STRATEGY_APPROVAL_ENABLED` defaults off.
- `server/phase2-feature-gates.ts` has an isolated QA path requiring an exact UID and expiry, with a constant-time secret header if configured. `PHASE2_E2E_ALLOW_SHARED_MODEL` additionally gates the test model and pins `openrouter/free`. Never enable broad shared-key fallback.
- Firestore user-owned bots/agents/chats and approval-intent records remain the record layer; R2 stores strategy source and historical assets. Inspect exact path constructors in the storage modules before migration. Durable Objects retain native venue bot runtimes and CodeWatch; never bypass their deterministic risk and account controls.

## Required debug before enabling Phase 2 features

1. Establish a protected branch preview or isolated Vercel staging project with a separate Firebase Auth/Firestore project and R2 bucket. This Vercel account currently reports custom-environment limit zero. Do not copy the production Firebase Admin account into general Preview.
2. Use two disposable Firebase email/password accounts and the bounded OpenRouter free model. Run `scripts/phase2-real-auth-e2e.mjs` with transient secrets, record JSON outcomes and delete Auth users as well as test records.
3. Verify actual model-selected owner-scoped tool events, two conversations, refresh/restore, abort/retry/sign-out races, and desktop/mobile UI.
4. Exercise deployed Firestore approval transaction plus R2 stage/approve/apply/deny/expiry/replay/concurrency/cross-user tests and the QuickJS route with real Hyperliquid candles. Verify no broker orders. Inspect runtime logs.
5. Verify native PropDAO, cTrader, and VALR read-only status and unchanged live execution guards. Fix GitHub Actions billing separately; local tests are not a green CI run.
6. Only after evidence is recorded, enable SDK/chat/backtest/approval flags deliberately and run production smoke tests. Keep release rollback deployment available.

## Phase 3 order

First complete the system-wide debug above. Then implement native server-canonical persisted tool results and typed workflows; multi-account routing at every privileged boundary; durable monitoring and notification delivery; coding agent isolation; voice and MCP. Each write requires independent owner/account/risk verification and human approval at the execution boundary. Never infer broker readiness from saved metadata.

## Release metadata

The exact merge SHA, Vercel deployment ID/status, and production smoke results must be added to issue #62 after release. The SHA of this pre-merge handoff is not the eventual squash merge SHA.
