# PropDAO Durable SQL / Firestore offline trading ledger
2026-11-10 · PropDAO demo-first integration

## Running bot
The existing SQLite-backed PropDAOLiveBot class uses three SQL tables:
tv_broker_trades, tv_execution_events, tv_strategy_decisions.
The tables are created lazily in the existing Durable Object namespace,
which already uses the Wrangler new_sqlite_classes migration.

On each completed-candle alarm, the strategy and any broker order are
evaluated BEFORE independent read-only broker-history synchronization.
The SQL journal keeps provider-closed trade observations (never
automatically attributed to one bot), immutable execution events and
decisions including code hash, filter checks, and completed candle metadata.
No browser, AI credit, signed-in user or client polling is needed.

The signed Cloudflare ledger endpoint is read by the authenticated Vercel
PropDAO account activity service; the live AI trading-desk tool can inspect
SQL rows directly while the robot is running. Direct broker history is an
independent cross-check; outages are labeled rather than becoming zeros.

## Stop / pause / expiration
STOP revokes new-entry permission on the server first. The Worker marks
the robot stopped immediately and sets a near-immediate reconciliation
alarm. It never waits on Firebase to acknowledge the stop. It never closes
a position merely because the robot is stopped.

On stopped alarms the Worker fetches broker-closed trades using its
existing internal secret even though the trading grant is revoked. It
archives up to 60 SQL rows per batch to an authenticated Vercel endpoint.
The server verifies the Worker credential, bot ownership and broker
account ownership before any idempotent, user-scoped Firestore create.

After verified Firebase ACK, only those specific SQL rows are marked
archived, never deleted. A timeout, bad response, failed broker read or
Firestore outage leaves rows pending and retries on a later alarm.

Paused bots continue read-only observations without new entries. Stopped
bots continue offline monitoring while positions or orders remain,
exposure is unknown, pending orders are unresolved or Firestore transfer
is pending. To conclude, require two separately verified flat broker
snapshots, at least five minutes since stop, and all archive rows ACKed.
After verified completion, the extra alarm can be removed.

## Fail-closed trade evidence
Every BUY/SELL decision must be durably journaled with its code hash
before order execution. A failed SQL write for SIGNAL or SUBMISSION_STARTED
prevents the provider submission. When a pre-submit write fails after
an account lock is acquired, the runtime attempts to release the lock;
if cleanup cannot be verified, the pending intent remains locked for
operator reconciliation.

If a confirmed fill or cancellation cannot be durably recorded after
the provider has responded, the robot halts new entries and retains the
unresolved intent. This is deliberately conservative: the broker may
already hold exposure and must be independently checked. WAIT telemetry
remains best-effort and cannot authorize an order.

## Firebase
- users/{uid}/liveTrades/{stableHash}: broker-confirmed closed trade,
  provider ID, account, symbol, side, size, entry/exit, timestamps,
  P/L, fees, reason, observed date and provenance. Unattributed remains
  unattributed until exact provider/Worker identities can prove ownership.
- users/{uid}/liveExecutionEvents/{stableHash}: bot/grant/code revision,
  execution stage, intent, provider position, stop/target and risk data
  if actually returned. A protected entry is not a closed trade.
- users/{uid}/liveRobotDecisions/{stableHash}: code hash, execution
  candle, reason, action, actual strategy checks, and the available
  timeframe candle snapshots for future historical diagnosis.

While SQL is active, the Cloudflare Worker now transfers pending rows to
Firestore **while trading continues**, without needing AI calls or the user
to be online. Each batch is at most 60 rows, idempotent and acknowledged.
Healthy transfers run every five minutes, or every minute while a large
backlog is draining. Failed transfers retry with exponentially increasing
intervals, up to 30 minutes, without dropping or marking rows archived.

A high-timeframe worker wakes at least every five minutes for read-only
broker/ledger maintenance, even if the next strategy candle is hours away.
Archival is deliberately scheduled after strategy execution, not before a
new order. Firestore failures are visible as `sqlJournal.lastArchiveError`
and `sqlJournal.archiveFailures`; they never become fabricated broker fills.

The existing final flush and reconciliation on STOP remain in place. Routine
AI reads still defer opportunistic Firestore write-through to avoid
duplicating the Worker's archival writes. Firestore remains a fallback for
older observations and when the live Worker is unavailable.

## Rollout and release gate
1. Merge Vercel backend first: internal archive endpoint must exist
   before the new Worker starts transferring records.
2. Confirm Firebase Admin, account ownership and existing internal
   Worker secret. Use PropDAO DEMO for all write tests.
3. Deploy the Cloudflare Worker separately to the current namespace.
   Keep the existing bindings and preserve the actual operator's
   PROPDAO_LIVE_ENABLED configuration; a default plain deploy can
   unintentionally turn live entries off.
4. Run authenticated production tests: live broker fill, SQL read,
   stop with an OPEN position, later broker close, Firestore transfer,
   injected Firestore failure and idempotent retry.
5. Only then mark the end-to-end broker/Firestore loop verified.

## Limits and failure transparency
- PropDAO currently returns at most 50 closed trades per account read.
  If more than 50 close between successful Worker polls, the missing
  records cannot be reconstructed without provider pagination/webhooks.
  Capped samples are explicitly flagged as potentially incomplete.
- Trades and checks not captured by prior Worker versions are not
  retroactively invented.
- SL/TP exit reasons are not enough to prove why an entry lost;
  historical market conditions and actual decision checks are needed.
- Worker alarms run independently of the user and can incur charges
  when the broker is unavailable indefinitely; monitor retries.
- The current change is PropDAO-specific, not cTrader or VALR.
- SQL archive is retained; automatic retention/compaction is not enabled
  until a verified export/retention policy is approved.
