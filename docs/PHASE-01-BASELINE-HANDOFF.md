# Trading Vibes phase 1: integration baseline and phase 2 handoff

Recorded 2026-11-06. Recheck every ref and deployment before using this handoff.
The prior public production commit and main were 241ab67cd1907f735d1d80cb8c0304a629f5f451.
Its Vercel production deployment was dpl_Hjg9EqwSvDBaEXoxbQRkLcmco1Tz, READY.
The Phase 1 integration branch is based on PR 64 head 73cfc55e06d1872ea5c3839e8aa8c8264d7730bc.
Use this document's containing commit as the authoritative integration commit; re-read the PR and issue for its final merge and deployment state.

## Changes in this phase

- Integrates the existing PR 64 work on an independent branch. The AI SDK transport and public L2 adapter are present but not proof of an end-to-end agent.
- Restores the existing /api/ai route exactly as in the baseline and makes the frontend choose it by default. VITE_AI_SDK_CHAT_ENABLED=true opts a build into /api/ai-sdk/stream. This is a build-time frontend switch, not a live runtime kill switch, and is not an access-control boundary. Roll back with a new build using the flag unset/false or promote the known-good production deployment.
- Fixes the OAuth tampering test, which previously replaced the first character with X and sometimes did not alter it. The production OAuth implementation is not changed.
- Adds a focused test for default-off and exact opt-in behavior. Existing SDK HTTP test uses a locally signed test token and mocked model/provider; it does not verify a real account.

## Matrix: current status and next phase

| Area | Observed on integration branch | Remaining / verification |
| --- | --- | --- |
| Chat SDK | SDK stream behind an opt-in, previous primary route retained; authenticated mock HTTP test | Phase 2: useChat, typed SDK tools, real authenticated model journey, action approvals and parity |
| Market data | Source-labelled Hyperliquid L2; per-process coalescing and cache | Phase 3: source/instrument registry, shared cross-instance limiter/cache, subscriptions and history |
| Brokers | Existing PropDAO, cTrader and VALR code unchanged by Phase 1 | Demo/read-only verification, account selection and reconciliation remain; do not infer live readiness from tests |
| Apps/news | Existing Composio and GDELT foundations retained | Real authorized OAuth/actions, source health and provider-specific verification remain |
| Watchers/Telegram | Repository has CodeWatch worker; checked-in config defaults disabled | Durable monitor, shared feeds and actual delivery remain unverified |
| Strategies/backtests | Existing platform retained | Agent tool migration, reproducibility and real-data acceptance remain |
| UI/voice/MCP/memory | Existing partial UI retained | Dynamic verified UI, voice, scoped MCP, memory and end-to-end tests remain |

## Open draft branches assessed

- PR 42: cTrader branch is a large independent historical/runtime implementation, not an ancestor of main; broker fills/protective orders and backfill are explicitly unverified. Review feature-by-feature in the broker phase; do not merge blindly.
- PR 43: warmup and signal diagnostics is a separate draft; verify what already exists and its live trade implications before using it.
- PR 48: research/intent work overlaps main (the chat-intent module exists); assess remaining differences and actual behavior before porting.
- PR 49: upstream response helper on its head is byte-identical to the main helper, but its head is not an ancestor. Check remaining Worker/tests before concluding the complete PR is incorporated.
- PR 50: chat-first UI and commands overlap newer main, while its branch is stale and not cleanly mergeable. Compare behavior, not just commit ancestry.
- PRs 52 and 53: alternative mobile/blueprint drafts; stale and not cleanly mergeable. Preserve useful UX ideas for the UI phase after regression and accessibility review.
- PR 64: integrated into the Phase 1 branch with the opt-in and OAuth test fix described above; the original draft remains a separate branch.

## Verification and limitations

On Node v24.22.1 in an isolated Vercel sandbox: npm ci succeeded; 450 tests in 83 files passed; npm run build and npm run check:runtime passed; VALR paper, VALR live, PropDAO live, CodeWatch and cTrader gateway Worker dry-run builds passed. These checks do not place orders and do not verify deployed Worker bindings or live broker behavior. The final PR/issue must record the exact tested commit.

GitHub Actions checks fail before any step. Public check-run annotation 127984076499 states: \"The job was not started because your account is locked due to a billing issue.\" GitHub's job logs return BlobNotFound. Account billing must be resolved by the account owner; do not infer that a workflow edit fixed it. Independent Node 24 checks are reported above.

Vercel production environment metadata contains CTRADER_GATEWAY_URL and CTRADER_GATEWAY_SECRET, PROPDAO_LIVE_RUNTIME_URL, PROPDAO_LIVE_INTERNAL_SECRET, PROPDAO_LIVE_ENABLED, R2_* and COMPOSIO_API_KEY names; values were not exposed. Presence is not proof of valid credentials, deployed bindings or account access. VITE_AI_SDK_CHAT_ENABLED was absent from inspected production metadata. Deployed Cloudflare Workers, live Durable Object bindings, R2 object inventory and actual broker positions could not be verified with the available sandbox credentials and must be inspected by authorized tooling in later phases. Checked-in Worker configs list BOTS/PropDAOLiveBot, WATCHES/CodeWatch, GATEWAYS/CTraderGateway and BOTS/CTraderLiveBot, and ACCOUNTS/ValrLiveAccount; config defaults are not evidence of deployed state.

The 30-minute production runtime scan reported one stderr Node DEP0169 url.parse deprecation warning on /api/economy/covers, not a confirmed application failure. The prior production deployment remains a rollback candidate. Preview of prior PR 64 head dpl_Dtxu45Bu4EyqWDpCr7iuGgpmSZE9 was READY; it was not a production deployment.

## Phase 2

Start from the latest integration/main state and inspect the final PR record. Make the AI SDK the primary chat and agent runtime only after migrating strategy, backtest, trade-context and approval workflows, using the version-matched SDK UI, preserving user data, and verifying a real signed-in end-to-end model/tool journey. Keep the old default until parity is verified. Later phases must implement global shared provider limits and complete the issue 62 matrix.
