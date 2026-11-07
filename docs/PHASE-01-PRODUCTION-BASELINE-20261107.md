# Phase 1/13 — production-first baseline and handoff

Date: 2026-11-07. Backlog: [#62](https://github.com/Mabu007/trading-robots/issues/62).

## Scope and acceptance model

Phase 1 uses the real pre-launch production beta as the primary test target, not a staging release gate. A green build is **not** an authenticated production journey. No production financial orders, funded-account actions, OAuth grants, or irreversible migrations are authorized by this handoff.

## Source and deployment baseline observed before this change

- Repository default `main`: `fda07c16b48c782bd04c747d66bd6fca2f5953e2` (Phase 2 feature-flagged foundation, merged via PR #67).
- Production alias: https://trading-robots.vercel.app; Vercel READY deployment `dpl_9arrDijHAxM2uAMGWbFdgBzcCZA7` at exact SHA above.
- Rollback source branch created: `rollback/phase1-prod-baseline-20261107`, pinned to the SHA above. The previous Vercel deployment remains a rollback candidate.
- Open draft PR #68 (head `acfa213e93ba56f0ee31f0700733df139c8ae817`) carries separate Phase 3 canonical instruments, Hyperliquid, market hub, Worker and R2 code. **Do not blindly merge it into Phase 1**. Its temporary Worker receipt `f18977a6-cca3-43f2-89bd-81aac5751c9e` belongs to a temporary third-party account, not the permanent production Cloudflare account.
- PR #63 already merged; PRs #42, #43, #48, #49, #50, #52, #53 and #64 are older open/draft work, and PR #67 is already merged. Do not reapply old diffs without comparison against current main.
- The pre-existing checkout `/vercel/trading-robots` contained uncommitted Phase 3 changes and was **not** modified. All tests and edits were made in a separate fresh clone `/vercel/phase1-baseline`.

## Real evidence collected

### Reproducible local code checks (Node 24, fresh main checkout)

- `npm ci --no-audit --no-fund`: PASS.
- `npm test`: **496/496 tests, 95/95 files** PASS.
- `npm run build`: PASS.
- `npm run check:runtime`: PASS.
- Wrangler dry runs: `workers/wrangler.propdao-live.jsonc`, `workers/wrangler.ctrader-gateway.jsonc`, `workers/wrangler.valr-live.jsonc`, `workers/wrangler.code-watch.jsonc`: all PASS. **Dry runs are not deployed Worker receipts.**
- GitHub Actions `verify` remains subject to the known account billing lock. A local PASS does not establish green hosted CI.

### Actual production backend responses

On 2026-11-07, from an external Vercel Sandbox network path, production returned:
- `GET /`: HTTP **200** and rendered HTML; versioned frontend asset HTTP **200**.
- `GET /api/health`: HTTP **200** with `ok:true`, both Firebase configured indicators and OpenRouter BYO capability; shared model fallback reported `false`.
- Anonymous `GET /api/agents`: HTTP **401**.
- Anonymous `GET /api/agent/capabilities`: HTTP **401**.
- Anonymous `POST /api/ai-sdk/stream`: HTTP **401**.
- All six checks reproducible with `npm run test:production-smoke`. This script makes **no authenticated writes or broker calls**.

### Actual Chromium browser test against the production URL

- Landing screen rendered with no console exceptions and no failed network requests after test-sandbox host permissions were corrected.
- `LOG IN` opened the sign-in screen with email/password controls.
- `Create an account` opened the registration form with name/email/password fields.
- Browser screenshots captured in the sandbox at `/tmp/tv_phase1_landing.png` and `/tmp/tv_phase1_login.png`; these are ephemeral test-environment files, not user-download links.
- A first browser run failed to fetch Firebase SDK modules from `www.gstatic.com` because the **test sandbox** network allowlist blocked it. Allowlisting the host and rerunning removed that error; do not report this as a production defect.
- Attempting to automate creation of a disposable production Firebase test account was blocked by the tool environment's safety checks **before execution**. Thus sign-up, authenticated Chat/Strategies/Code/Backtest navigation, refresh persistence, actual Firestore/R2 writes, broker UI, and signed-in settings **are unverified in this Phase 1 run**. No account was created by this run.

## Production connections and observability

- Vercel project and production deployment identity were verified. Configuration metadata shows production-scoped Firebase Admin, R2, Cloudflare, PropDAO and cTrader credentials, plus BYO OpenRouter, but **not their values**. Presence is not proof of functioning authenticated integrations or correct ownership.
- No permanent Cloudflare Worker version or R2 bucket operation was verified in this run; do not treat existing Wrangler dry-runs or the temporary Phase 3 Worker as equivalent.
- Vercel runtime error aggregation over the historical window identified earlier Composio connection lookup failures (prior deployment) and Node `url.parse()` deprecation warnings (including the baseline deployment). The sampled recent 30-minute runtime-log query returned no entries; this is not proof of no errors or no traffic. Hobby raw-log history is limited.
- `VITE_AI_SDK_CHAT_ENABLED`, `AI_SDK_SERVER_BACKTEST_ENABLED`, `AI_SDK_STRATEGY_APPROVAL_ENABLED` and broad shared-model fallback remain unverified/disabled in the current baseline; never switch them on based solely on fixture tests or this smoke suite.

## Prioritized remaining defects / acceptance gaps

1. **P0: authenticated production UI journey unverified.** With an explicitly authorized test identity in a real interactive browser, verify sign-up/sign-in, Chat, Strategies/Code, Backtest, connected brokers/settings, refresh, persistence, and failure states; capture sanitized network and browser evidence.
2. **P0: provider identity and live state.** Inspect permanent Cloudflare Worker versions and Durable Object bindings, R2/Firebase owner-scoped operations, and non-destructive live PropDAO/cTrader/VALR status. Never assume any connected account is demo; only test orders in a positively confirmed disposable/demo account with normal risk controls.
3. **P1: historical Composio lookup/connect errors.** Reproduce with an authenticated permitted app connection before altering integration behavior.
4. **P2: Node `url.parse()` deprecation warning.** Locate dependency/caller and update only after compatibility tests; warning alone is not evidence of an outage.
5. **Operational: GitHub Actions billing lock and limited Hobby raw-log retention.** Track separately from application source failures.

## Phase 2 reuse / handoff

Reuse existing `@ai-sdk/react` / `useChat` integration and transport, Firestore conversation records, owner-scoped tools, QuickJS backtest and reviewed-code approval server routes. See `docs/PHASE-03-HANDOFF.md` and `docs/PHASE-02-REAL-AUTH-VERIFICATION.md`; these features were merged behind flags, not proved end to end through a real production browser in this run. Begin Phase 2 by verifying the production signed-in AI SDK/tool journey rather than rebuilding the foundation, and preserve account/risk/approval controls.

## Release receipts

- Production before this Phase 1 PR: `fda07c16b48c782bd04c747d66bd6fca2f5953e2`, `dpl_9arrDijHAxM2uAMGWbFdgBzcCZA7` READY.
- Phase 1 source change: only a read-only `scripts/production-baseline-smoke.mjs`, `npm run test:production-smoke` package script, and this handoff. No Worker source/bindings changed, so no Worker redeploy required.
- **Fill in exact merged SHA, deployment ID, production alias checks, and browser result from actual post-merge evidence. Never infer deployed SHA from PR head.**

