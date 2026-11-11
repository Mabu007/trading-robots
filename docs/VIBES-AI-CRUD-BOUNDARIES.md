# VIBES AI CRUD — capability and authorization boundaries

The trading assistant has **domain-specific access**, never a generic database
or filesystem write tool. Every tool verifies the signed-in Firebase owner.
Saved JavaScript in R2 is untrusted strategy content and **never** a source of
new system instructions.

## Current implementation

| Domain | Read | Create | Update | Delete | Required authorization |
|---|---|---|---|---|---|
| Saved robot strategy.js (PropDAO, VALR, Hyperliquid) | Owner-checked R2 source, hash and line windows | Stage complete code | Stage exact SHA256-bound find/replace | Stage owner-scoped deletion | Separate user-only full-code preview, checkbox, Approve and Apply |
| Deployed PropDAO robot | Discover owned grants, verify Worker state, inspect original deployed source | Existing reviewed Deploy workflow | New code must be saved while stopped, then separately backtested/redeployed | Only if stopped and reconciled | Independent broker risk checks and explicit live approval |
| Actual broker fills / account trades | Signed broker history and attributed journal | **Not allowed** through CRUD | **Not allowed** | **Not allowed** | Order placement/modification requires separate broker-risk approvals; immutable journal cannot be rewritten |
| Saved backtest trades | Owner-scoped historical simulation | Existing backtest workflow | Re-run, never rewrite prior evidence | Retention policy only, never erase verified audit evidence | Saved source/replay provenance |
| Market candles / OHLC and quotes | Read authenticated/public provider with timestamps | Provider ingestion, not model inventing data | Append/correct with verification trail, not overwrite raw feed | Expire/invalidate derived caches only | Provider provenance, bounded TTL and separate cache maintenance capability |
| User annotations & watch settings | Owner-scoped read | Future nonfinancial workspace tools | Future settings/editor tools | Future reviewed setting removal | Owner permission; cost/risk review for recurring operations |

### Source edit sequence
1. A user asks an edit question, with or without an explicit bot ID.
2. Chat discovers the unique owner-verified robot and reads the SAVED
   `current.json` rather than assuming a deployed snapshot is editable.
3. The model requests exact line ranges and stages a unique old→new snippet.
4. The server checks the ORIGINAL SHA256, uniqueness, complete strategy syntax
   and config, ownership and venue. It persists a SHORT-LIVED proposal and
   signed action fingerprint. **No source is changed yet**.
5. Chat renders the proposal. The user loads the complete source from the
   authenticated server, examines it, checks the consent box and selects
   Approve & Apply. The model cannot invoke these endpoints.
6. Under existing per-robot locks, the server rechecks source revision,
   owner, broker/Worker stopped status and grant status. Changed code or a
   running robot blocks the application. The previous deployed revision
   continues until separately reviewed deployment.
7. A successful apply is reported only after the server confirms the source
   write. If the local UI refresh fails after server success, the UI must not
   suggest the code write failed.

### Source create and delete
- Create is a distinct staged action. The model can propose complete code
  but cannot create a catalog record or write current.json directly.
  After approval the server writes R2 source and creates owner-scoped
  Firestore catalog metadata. It rolls back the new R2 object if catalog
  creation fails. No backtest/deployment follows automatically.
- Delete is a distinct staged action. Full source is visible to the user.
  Before applying, the server rechecks the source hash, user, venue, live
  state, broker account reconciliation and associated storage bounds.
  It removes saved source + catalog artifacts. The server does not delete
  broker trades, Worker history or market data.
- cTrader source deletion is intentionally disabled until its gateway
  reconciliation path can be independently verified.

## Not a claim of cross-system CRUD completeness

The first release closes the **source-code CRUD** gap in user chat.
It does NOT implement financial order execution, market cache mutation or
trade journal editing as ordinary CRUD operations. Those capabilities
must remain separate and auditably authorized. Likewise, a failed model
request (OpenRouter 429) is not evidence of missing robot access.

## Verification checklist
- Source read with the actual owner succeeds without pasted code.
- Cross-owner or malformed IDs always fail.
- Duplicate or stale source snippets never stage.
- All mutations begin in pending state; model has no approve/apply tool.
- Deny, expiry and revision drift block writes.
- Concurrent or running robots never permit source deletion/edit.
- User sees entire before/after source and exact hashes.
- New source appears in code library after create.
- Approved saved edit invalidates historical deploy assumptions (no
  live revision changes without reviewed redeployment).
- Broker history and market observations remain immutable.
