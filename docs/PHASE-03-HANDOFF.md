# Phase 3 market-data continuation (2026-11-07)

See PHASE-03-MARKET-DATA-HANDOFF.md for the new implementation, tests, and outstanding external gates. The Phase 2 exception below remains binding; feature flags stay off.

---

# Phase 3 handoff â€” Phase 2 acceptance exception

Date: 2026-11-06. Repository: Mabu007/trading-robots. Release source: PR #67, branch `codex/phase2-auth-rollout-validation-20261106`.

## Acceptance decision

The owner explicitly accepted the remaining Phase 2 external-verification gaps on 2026-11-06 to begin Phase 3 and defer them to a system-wide debug on a local PC. This is a **feature-flagged code release**, not evidence that the SDK chat, approvals, or QuickJS backtest work end to end in production. Keep global flags off until the corresponding real authenticated tests pass. Do not report unverified gates as passed.

Local Node 24 checks on the branch: `npm ci`, 496/496 tests across 95 files, `npm run build`, `npm run check:runtime`, and dry-run bundles for VALR paper/live, PropDAO live, CodeWatch, and cTrader gateway passed. GitHub Actions verify remains blocked before steps by account billing. No live orders or risk changes were made.

## Current runtime

- React/Vite app, Firebase Auth and Firestore user records. Default chat is legacy. `VITE_AI_SDK_CHAT_ENABLED=true` opts a build into AI SDK `useChat` compatibility streaming and tool traces; it is a build switch, not an authorization gate.
- `server/index.ts` hosts Firebase-authenticated SDK ¶»§q«^