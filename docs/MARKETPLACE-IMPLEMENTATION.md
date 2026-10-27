# Marketplace implementation plan

Baseline: b814b7b. Preserve Vite/React, Express/Vercel, Firebase account bot paths, R2 history, existing links and JavaScript contract.

1. Server-owned Firestore marketplace records, access entitlements, zero-until-verified earnings, creator/customer dashboards.
2. Extend OAuth (trading consent), encrypted tokens/refresh, account selection; persistent shared cTrader JSON WebSocket gateway (one connection per environment).
3. One bot Durable Object, immutable deployed version, completed-candle alarms, persisted signal/outbox and subscriber controls; separate per-account execution serialization.
4. Isolated Dynamic Worker strategy evaluation with no bindings or network; reuse the browser's canonical evaluator. Queue execution with durable idempotency and unknown-ack reconciliation.
5. Minimal deployment/risk dialogs and dashboard links; keep Backtest / Start / Connect broker.
6. Typecheck/build, regression tests, scheduler restart/fanout tests, broker protocol tests, security checks; provider demo tests and deployment only with actual credentials and permissions.

## Initial inspection

- Existing: R2 historical data and user strategy snapshots, Firebase Auth + private Firestore metadata, browser iframe backtesting, public R2 publication snapshots/free copies, read-only OAuth callback.
- Missing: Workers/config/DO/Queues, gateway, token refresh/account selection, subscriptions/entitlements, transaction ledger, creator/customer dashboards.
- No existing Cloudflare resources can be inventoried from this session (no connector/token). Do not assume resources in another repository belong to this app.
- Vercel access initially returned 403 and was subsequently restored. The added client ID and `CTRADER_SECRET_KEY` are present in production; code now accepts that secret alias. No local `.env`, cTrader credentials, Cloudflare credentials, or Firebase service account is present.
- Provider demo execution, real Cloudflare alarm recovery, Dynamic Worker resource isolation, data redistribution rights and cTrader approval remain external verification gates.
- Live execution must remain server-disabled until demo verification and a separate explicit production authorization. No live orders during implementation.

## Current handover

See [MARKETPLACE-STATUS.md](MARKETPLACE-STATUS.md) for implemented features, actual verification, missing infrastructure/credentials, schema, resources, release gates and deployment status.
