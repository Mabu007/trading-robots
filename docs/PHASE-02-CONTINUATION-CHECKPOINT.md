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
