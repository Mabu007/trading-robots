# Trading Vibes durable task agent — initial implementation

## Goal

A trading research task must survive browser close, model output limits and process restarts. The model may call tools, validate source and run read-only reference simulations; its claims do not authorize execution.

## Components

- shared/agent-task-state.ts: bounded compact memory, immutable identity, task phases, matching draft/backtest evidence and deterministic completion gates.
- workers/agent-task-worker.ts: isolated Cloudflare Worker plus SQLite-backed Durable Object. One task per owner/task pair; persistent state, alarms, resume, cancellation, bounded retries and a 1-hour deadline. No user OpenRouter key, broker key or trading permission is transferred to the Worker.
- server/agent-task-engine.ts: Vercel AI SDK 7 ToolLoopAgent with bounded steps using the user's OpenRouter key only inside the authenticated Vercel backend. New tool invocations read data or create isolated R2 task drafts. It cannot execute broker orders.
- server/data-capability-registry.ts: explicit callable data sources with source type, venue, access requirements and limitations.
- server/agent-task-backtest.ts: deterministic QuickJS simulation with genuine completed Hyperliquid candles, continuity checks and reference-only caveats.
- server/agent-task-routes.ts: Firebase-authenticated create/list/status/cancel/resume/read-draft routes; internal secret-protected step callback from Cloudflare Worker.
- src/components/AgentTaskPanel.tsx: optional scheduled-work interface for research tasks and draft inspection. Firestore holds task index for navigation; Durable Object is the task state authority.

Tasks do not run in one continuous hour-long process. Each bounded model/tool iteration checkpoints its memory and the Durable Object schedules the next alarm. The per-task iteration budget is independent of its one-hour deadline. The default model-loop iteration budget is 12.

## Security

- This is read-only market/owner research plus scoped draft writes only. No live execution, broker-risk changes, existing strategy overwrites or approvals.
- Draft code and full backtest results are stored in task-scoped R2 and identified by SHA-256, never in Durable Object memory.
- A matching draft/backtest receipt only permits research review; it does not establish PropDAO execution parity or challenge readiness.
- Data tools verify source, timestamp coverage and user ownership.
- The application never pretends an in-process job is durable. Task creation returns 503 unless a valid Cloudflare Worker URL and internal secret are configured. UI feature is disabled by default.

## Deployment prerequisites

1. Authenticate an authorized Cloudflare CLI session.
2. Deploy the separate Worker using:
   npx wrangler deploy --config workers/wrangler.agent-tasks.jsonc
3. Set VIBES_TASK_INTERNAL_SECRET on the Worker using wrangler secret put, at least 32 random characters.
4. Set Vercel server-side VIBES_TASK_WORKER_URL and matching VIBES_TASK_INTERNAL_SECRET; never use VITE_ variables for secrets.
5. Verify the Worker VIBES_CONTROL_URL points to the intended Vercel backend.
6. Test two real Firebase users, owner isolation, live tool calling on a BYO OpenRouter model, interrupt/recovery, backtest receipt integrity and zero brokerage side effects.
7. After those steps, set VITE_AGENT_TASKS_ENABLED=true on Vercel, then redeploy the web app.
8. Do not claim production readiness until those real authenticated checks pass.

## Remaining phases

- Ordinary Chat does not yet automatically initiate a durable task; initial launch is from Scheduled work/API.
- A reference Hyperliquid backtest is NOT a PropDAO challenge evaluation. Add broker-specific cost/slippage/fill parity, firm equity and daily-limit replay, walk-forward/out-of-sample checks and risk validation before accepting challenge-ready candidates.
- Deployment approvals and live monitoring are still separate, explicitly authorized paths. Later link their authorization receipts to the task record, without giving the agent direct trading privileges.
- The first runtime uses Durable Object alarms instead of a separate Cloudflare Workflow definition. For heavyweight stages and human approval waits, add Cloudflare Workflows after validating task boundaries and retry/idempotency semantics.
