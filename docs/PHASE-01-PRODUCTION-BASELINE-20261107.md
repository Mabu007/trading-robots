# Phase 1/13 â€” production-first baseline and handoff

Date: 2026-11-07. Backlog: [#62](https://github.com/Mabu007/trading-robots/issues/62).

## Scope and acceptance model

Phase 1 uses the real pre-launch production beta as the primary test target, not a staging release gate. A green build is **not** an authenticated production journey. No production financial orders, funded-account actions, OAuth grants, or irreversible migrations are authorized by this handoff.

## Source and deployment baseline observed before this change

- Repository default `main`: `fda07c16b48c782bd04c747d66bd6fca2f5953e2` (Phase 2 feature-flagged foundation, merged via PR #67).
- Production alias: https://trading-robots.vercel.app; Vercel READY deployment `dpl_9arrDijHAxM2uAMGWbFdgBzcCZA7` at exact SHA above.
- Rollback source branch created: `rollback/phase1-prod-baseline-20261107`, pinned to the SHA above. The previous Vercel deployment remains a rollback candidate.
- Open draft PR #68 (head `acfa213e93ba56f0ee31f0700733df139c8ae817`) carries separate Phase 3 canonical instruments, Hyperliquid, market hub, Worker and R2 code. **Do not blindly merge it into Phase 1**. Its temporary Worker receipt `f18977a6-cca3-43f2-89bd-81aac5751c9e` belongs to a temporary third-party account, not the permanent production Cloudflare account.
- PR #63 already merged; PRs #42, #43, #48, #49, #50, #52, #53 and #64 are older open/draft work, and PR #67 is already merged. Do not reapply old diffs without comparison ag¶»§q«^