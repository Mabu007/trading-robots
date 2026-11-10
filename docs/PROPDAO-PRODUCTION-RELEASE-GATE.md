# Trading Vibes — PropDAO release gate (10 November 2026)

This is the authoritative operator checklist for the AI trading control plane,
the Cloudflare Durable Object, Firestore and the authenticated chat backend.

## Release must not change active trading authorization

Production Vercel was observed with `PROPDAO_LIVE_ENABLED=true`. The
previous checked-in Wrangler file set the Worker variable to `false`.
That mismatch can stop new order entries during an ordinary deploy.

The updated Wrangler config has `keep_vars: true`, removes the entry
gate from `vars`, and declares the internal secret as required. The
release command also passes `--keep-vars`, and the pipeline compares
the **current** Cloudflare gate both before and after. It never runs
`wrangler secret put` as part of deployment.

Only `.github/workflows/deploy-propdao-worker.yml` is authorized for
a controlled release. It requires a matching observed Cloudflare active
version ID, an explicit expected gate, a human confirmation string,
Vercel production healthy **at the same Git SHA**, the complete tests,
a Worker dry-run, and a successful authenticated Worker health check.
A failed postflight triggers a guarded rollback to the previous version.

**Never deploy `workers/wrangler.propdao-live.jsonc` using an unreviewed
command or change the gate to make a check pass.**

## Step 1: Merge / deployment order

1. Review and merge PR #106 (durable live SQL sync).
2. Review and merge the dependent PR #107 (attribution, conversational
   context and deterministic diagnostics).
3. Review and merge this release-gate PR only after its tests are green.
4. Confirm Vercel production `/api/health` reports `ok:true` and its
   `releaseCommit` equals the actual latest main SHA. If it is null,
   configure the standard Vercel system commit environment variable
   before attempting Cloudflare deployment.
5. Run the **read-only** workflow `PropDAO Cloudflare read-only release
   audit`. It uses GitHub encrypted secrets and prints sanitized
   information about current Cloudflare bindings, entry gate and active
   Worker version, never the API token or secret.
6. Only if audit succeeds, manually dispatch
   `Deploy PropDAO Worker (preserve verified entry gate)` on main.
   Supply the observed version UUID and the observed gate, then enter
   `KEEP THE CURRENT ENTRY GATE`. Do not guess these inputs.
7. Verify the complete job reports successful health and matching SHA.
   A failed rollout is NOT a green release, regardless of its build status.

### Why the release cannot automatically claim a successful demo fill

A GitHub Actions build has no access to the signed-in user's PropDAO
credentials or actual Firebase conversation. Forcing an order simply to
produce a green test would violate the user's risk authorization.
Simulated test fixtures are not live financial evidence.

## Step 2: Real, signed-in demo trade acceptance

Existing **real broker-confirmed, closed PropDAO demo trades** may be used.
No new order is required. Choose a specific authenticated account/trade
from the Trading Desk and a recent VIBES conversation that inspected the
trade with `inspectBrokerTrade`. That conversation must use the
user's connected OpenRouter model and finish with actual streamed text
and a persisted tool receipt. The server now stores a minimal successful
completion receipt (owner, conversation, selected model, receipt ID,
time and response-character count). No prompt or broker credentials
are copied to this proof.

Using the same signed-in Firebase session, call:

```
POST /api/trading-desk/release-acceptance
Content-Type: application/json

{"accountId":"<owned-demo-account-id>",
 "tradeId":"<actual-closed-broker-trade-id>",
 "conversationId":"<existing-conversation-id>"}
```

The server automatically looks up the most recent successful tool receipt
for this conversation. It returns **HTTP 200 only if every check passes**,
otherwise HTTP 409 with a per-stage failure report, or HTTP 403 if
account ownership cannot be verified. Do not pass API keys or Firebase
tokens in the JSON body; the app's existing authenticated request
transport supplies the Firebase authorization.

The eight independent checks are:
- Authenticated connected PropDAO demo account ownership
- Fresh broker-reported closed trade (not a Worker signal)
- Exact broker-identity match to a protected fill and robot/grant
- Recorded strategy decision and protected-fill journal
- Both the broker trade and protected-fill SQL records archived to Firebase
- Immutable R2 source corresponding to that grant and code hash
- Cloudflare Worker authenticated health/gate and exact Vercel release SHA
- A genuine, recently completed OpenRouter model response and saved
  conversation-specific `inspectBrokerTrade` tool receipt

**Do not certify probable attribution as exact.** The published PropDAO
trade endpoint may omit a position, intent and order identifier. No
implementation can recover a provable join from time, price and side
alone. The AI should describe such cases as probable or unknown,
never verified. The acceptance endpoint correctly remains blocked.

## Step 3: Historical data coverage

Worker M1 reconciliation continues using a lightweight 50-record broker
sample. User-triggered Trading Desk and individual trade investigations
can use bounded `limit/offset` pages (up to 500 records per account),
the documented PropDAO API. A cap or provider error is reported as
partial coverage, never zero trades. It does not weaken broker/robot
identity requirements or submit orders.

## Rollback and incident controls

- An unknown or ambiguous order **must stay locked** until verified
  reconciliation, even if the Worker returns a timeout.
- The Worker deploy workflow rechecks the original entry gate and
  automatically attempts a version-level rollback after a failing
  postflight, never re-submitting trades.
- If the rollback cannot be proven, mark production as unverified,
  preserve the Durable Object SQL ledger and Firestore evidence, and
  inspect Cloudflare deployments directly before further order activity.
- Deploying or rolling back code does not close existing broker positions.
- Logs must not print encrypted API keys, bearer tokens, authorization
  headers, user identity tokens or private source code.

## Evidence standard

Build, tests, preview READY, unauthenticated Worker HTTP 401 and
production Vercel HTTP 200 are **necessary but insufficient**.
The full acceptance gate is green only after the real broker fill,
Firebase evidence, deployed Worker SHA and genuine model conversation
are verified by the signed-in user-scoped backend.
