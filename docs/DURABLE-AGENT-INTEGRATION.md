# Trading Vibes durable agent integration — execution remains gated

This phase extends PR #89 with chat-native durable research, segment-based strategy authoring, account and deployment read tools, train/holdout reference evaluation, demo-only policy authorizations, and a task-linked policy pointer.

## Verified in isolated builds

- 610 tests across 126 files in the full regression suite prior to the final policy/fragments additions.
- Focused tests for fragment integrity, broker-state uncertainty, demo-account attestation, and native Node TypeScript API loading.
- Node 24/Vite build and Cloudflare Worker TypeScript and Wrangler dry-run passed.
- No actual authenticated OpenRouter task, Cloudflare production task, or genuine PropDAO demo fill was observed.

## Feature and authorization controls

- The chat and Scheduled task interface are gated by `VITE_AGENT_TASKS_ENABLED=true` (disabled by default).
- Requires separate Cloudflare Worker deployed from `workers/wrangler.agent-tasks.jsonc`; securely set `VIBES_TASK_INTERNAL_SECRET`, `VIBES_TASK_WORKER_URL` on Vercel, and matching secret on the Worker.
- Worker `VIBES_CONTROL_URL` must point to the compatible backend. For preview tests, use an authenticated preview origin, not production until code is merged.
- The new demo-only standing policy requires an actual broker account attestation (provider `demo/isDemo/environment=demo` or explicitly controlled `PROPDAO_AUTONOMY_DEMO_ACCOUNT_IDS` server allowlist), confirmed evaluation challenge metadata, ownership, active status, and safe risk room.
- Recording or linking a standing policy **does not** authorize broker order execution; all autonomous execution paths remain disabled until broker-specific risk and revision-bound server backtest acceptance are independently verified.
- No user credentials are stored inside Durable Objects. Source code and large reports remain task-scoped in R2.
- Policies are revocable. Revocation **does not** stop any already running independent bot or close positions. The existing PropDAO stop and broker reconciliation mechanisms must be used.

## Required next acceptance gate

1. An authorized Cloudflare operator runs `wrangler login` (interactive) and deploys the task worker, setting a strong secret.
2. Configure Vercel server-side `VIBES_TASK_WORKER_URL` and matching `VIBES_TASK_INTERNAL_SECRET`, without printing secrets.
3. Verify signed-in two-user Firebase owner isolation and policy attachment.
4. Exercise OpenRouter BYO model with advertised tool calling through one durable task; inspect checkpoint recovery, fragment validation, disjoint historical simulations and research gate outcomes.
5. Verify provider-classified DEMO accounts, live broker exposure reads and independent firm-specific challenge equity/drawdown simulation.
6. Implement and test a revision-bound execution adapter using existing PropDAO authorization/deployment services, with no second order submission path. Prove stop, reboot recovery, duplicate-intent prevention and actual broker acknowledgements before enabling any autonomous trading.
7. Only after signed-off checks enable `VITE_AGENT_TASKS_ENABLED`; keep any future autonomous trading feature flag false until broker demos genuinely pass.

## Limitations

Data registry describes currently integrated capabilities, not every possible market feed. A reference Hyperliquid simulation cannot prove PropDAO broker fills or challenge success. Policy linkage gives the agent awareness of the user's intended scope, not new privileged execution methods. No real demo trades or broker authorizations have been issued by this phase.
