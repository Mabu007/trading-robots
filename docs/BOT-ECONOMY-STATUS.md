# Bot economy implementation — 27 October 2026

This branch combines the current main application and the existing `marketplace-demo-runtime` implementation. It is a release candidate. Production creator persistence and real broker execution are **not verified or enabled**. See `MARKETPLACE-STATUS.md` for the inherited gateway/Worker verification and configuration details.

## Implemented

- Authenticated homepage opens a dark creator workspace with My Bots, Acquired Bots, Bot Members, My Trading, Activity, Earnings, Usage, discovery and account navigation. Existing editor, charts, chat, backtests, rename/delete and sharing are reused.
- Profiles have unique transactional usernames, display name, bio, avatar/cover uploads through existing R2, join date, actual aggregate counts and shareable `/u/{username}` routes. Profiles initialize lazily without moving existing user bots.
- Public `/marketplace` and `/creators` directories; paginated public metadata, category/search filters and loaded-result sorting. `/bot/{id}` shows version packages, terms, source acquisition and independent-copy actions. Existing public sharing pages remain the fallback for older links and incomplete creator configuration.
- Free manual JavaScript/paste and validated `.js` imports enter the existing workspace without AI. The existing isolated browser backtester remains the execution engine.
- Source releases snapshot code/configuration and SHA-256 digests into independent R2/Firestore records. Release manager can freeze current code or import an existing saved version, select up to 20 releases and publish a package. Existing workspace version rename/delete does not mutate these snapshots.
- Acquisitions freeze exact version IDs and license terms/revision. Paid acquisition is refused without checkout; no synthetic payment or sale records are written. New source acquisitions never confer live broker membership. Source reads require ownership or an active entitlement containing that exact version.
- Remix creates a new R2 draft, user-owned workspace record and server-owned provenance. Original source remains unchanged. Personal copies cannot publish; Commercial Remix requires executable changes and the same redistribution restrictions; Full Resale Rights allows unchanged resale. API-side checks also cover legacy sharing and managed deployment. These checks cannot police code copied outside the platform or determine substantive originality.
- Live invitations use 256-bit random tokens; only hashes are stored. Invitations are expiring, revocable and single-use. Email-bound invitations require the verified email in the server-verified Firebase identity. The invite screen can send a verification email and refresh the Firebase identity after verification. Acceptance atomically grants a separate membership; it does not grant source rights or enable execution.
- Owner-only member emails, bot filters, status/expiration controls and sanitized broker/execution status. Member revocation, suspension and expiration are checked again during order eligibility. Each member keeps independent broker authorization and risk controls. Revoking access never closes existing positions.
- Deployment controls reuse one strategy DO, queued independent fan-out and per-account durable intents. Select an immutable source release for deployment/rollback; saved-code deploy also pins by hash. Start/stop preserve pin metadata. There is no new cron. Imported strategy code never executes in the API process.
- AI provider usage metering records measured tokens when supplied, and unknown tokens otherwise. Deployment lifecycle usage is unbilled free/test usage, not invented compute consumption. Existing earnings use verified ledger records; checkout, payouts and usage charges remain disconnected.

## Routes

Public pages: `/marketplace`, `/creators`, `/u/{username}`, `/bot/{id}`, `/invite/{token}`. Existing `/` authenticated workspace, editor, account settings and legacy public links remain.

New API namespace `/api/economy`:

| Family | Methods / operations |
| --- | --- |
| `/me` | GET profile/counts/billing readiness; PUT own profile |
| `/creators`, `/creators/{username}`, `/creators/{username}/bots` | GET paginated public metadata |
| `/creators/{username}/follow` | GET own following status; POST follow/unfollow |
| `/bots`, `/bots/{id}` | GET discovery/detail with sanitized packages |
| `/projects/{id}/versions` | GET own releases; POST immutable snapshot/import |
| `/projects/{id}/packages` | POST licensed version package |
| `/versions/{id}/source` | GET ownership/entitlement-protected source |
| `/packages/{id}`, `/packages/{id}/acquire` | GET metadata; POST free/owner acquisition |
| `/acquisitions`, `/acquisitions/{id}/remix` | GET own entitlements; POST independent project |
| `/listings`, `/members`, `/memberships`, `/invitations`, `/activity`, `/usage` | GET owner/account-scoped pages |
| `/members/{id}` | POST owner status/expiration changes |
| `/bots/{id}/invitations`, `/invitations/accept`, `/invitations/{id}/revoke` | POST invitation lifecycle |
| `/bots/{id}/unpublish` | POST stop/unpublish and synchronize legacy link visibility |
| `/images/{digest}` | GET validated raster bytes from R2; immutable cache and nosniff |

## Data and security

Existing `users/{uid}/bots`, chats, saved versions, R2 drafts and historical backtests are preserved. New logical records:

| Collection | Purpose |
| --- | --- |
| `creatorProfiles`, `creatorUsernames` | Profiles and transactional username claims; old handles stay reserved |
| `sourceVersions` | Immutable source snapshots; distinct from inherited runtime `botVersions` |
| `botPackages` | Immutable selected versions, license terms, metadata and price |
| `botAcquisitions` | Exact-version source entitlements |
| `botForks` | Server-owned lineage/restrictions, outside editable user records |
| `botMembers`, `botInvitations` | Live access and hashed invitation state |
| `creatorFollows`, `botActivity` | Genuine relationships/events |
| `resourceUsage`, `deploymentReleases` | Unbilled usage and deployment release audit |

`marketplaceBots`, deployment, broker and ledger collections from the runtime branch are reused. Firestore's direct-browser deny rule covers every new server-owned root; existing private workspace permissions are retained. APIs verify Firebase JWT signatures/claims independently. No new endpoint accepts a client-asserted owner, verified email, acquisition entitlement, completed payment or broker credential. Public responses exclude private code/storage pointers, member email and internal acquisition lineage identifiers. Firestore rules/indexes are prepared, **not applied to production**.

New feeds use document cursors and pages of 30 (maximum 100). Existing runtime analytics still use bounded operational scans; a dedicated aggregate/search service is needed at substantially greater scale. Discovery search/sort currently applies to loaded pages and says so. There is no fabricated global trending rank.

## Verification

- `npm test`: **101 tests passing**, including 22 new source/profile/invitation/membership/API tests plus four Firestore REST adapter tests. Tests use persisted in-memory fixtures and mock brokers, not actual provider accounts.
- `npm run build`: TypeScript and production Vite build passed. Existing large client chunk warning remains.
- `npm run check:runtime`: Worker and gateway type checks passed.
- `npm run worker:build`: Cloudflare bundle dry run passed with execution/isolation gates false.
- `npm run test:cloudflare`: actual local workerd/DO/R2 alarm, empty strategy environment, blocked egress and process restart recovery passed. No real broker orders. Production CPU interruption remains unverified; `STRATEGY_ISOLATION_VERIFIED=false` remains necessary.
- `git diff --check`: passed. This repository has no lint script/ESLint configuration; no separate lint pass is claimed.
- Native Node 24 API loading is covered by regression tests, including the new server modules.
- Provider-authenticated browser workflows and production Firestore transactions/rules have not been verified against real accounts. Local browser installation failed and the remote browser could not reach localhost. No authenticated preview browser verification has been completed; publishing approval was subsequently received. Responsive CSS is implemented, but mobile interaction testing is not claimed.

Test coverage includes exact version inclusion/exclusion, frozen code after seller edits, independent copies, personal/commercial/resale checks, hash integrity, paid checkout refusal, forged/foreign entitlements, unique usernames, follow deduplication, R2 profile images, verified-email binding, generic-token acceptance races, invitation expiry/revocation/reuse, member privacy, revoked/expired execution eligibility, public metadata sanitization, pagination and unpublishing.

## Required external setup

The existing Vercel project's variable **names and environment scopes** were inspected without decrypting values. Existing Firebase web, R2 and OpenRouter names are present. cTrader client ID/secret are production-only. These backend names are absent:

- `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — server Firestore access; existing `VITE_FIREBASE_PROJECT_ID` is accepted as project ID.
- `CTRADER_REDIRECT_URI` — exact approved OAuth callback.
- `BROKER_TOKEN_ENCRYPTION_KEY` — independent base64 AES-256 key, same on API/gateway.
- `TRADING_INTERNAL_SECRET` — shared backend authentication secret.
- `ROBOT_RUNTIME_URL`, `CTRADER_GATEWAY_URL`, `CONTROL_API_URL` — actual configured HTTPS services.

Also required: Cloudflare account/Worker/DO/Queue/Dynamic Worker configuration, persistent gateway host, Firestore rules/index deployment, real authorized cTrader demo accounts and provider/production isolation verification. Keep `DEMO_TRADING_ENABLED=false` and `STRATEGY_ISOLATION_VERIFIED=false` until verification. Live-money orders remain hard-disabled in the inherited adapter. Do not copy production secrets into previews.

Yoco checkout, payment webhooks, paid entitlements, royalties, payouts and usage charging are future integrations. Explicit approval-request memberships, public featured collections, global indexed search/trending, detailed release editing/backtest attachments and dedicated commission-inclusive provider verification remain follow-up scope. Source releases and account-controlled demo execution are usable after backend configuration; this is not an assertion of completed production broker integration.

## Deployment

The user explicitly authorized pushing and merging this release into main. The existing Git/Vercel deployment workflow applies to that merge. Web deployment does not enable backend trading infrastructure or remove execution gates; backend configuration and provider verification remain incomplete. No Cloudflare production resources, schedules or real orders were created by this task.

The initial push of local commit `74fe550` was rejected by automatic approval review because the repository link was interpreted as permission for local work, not explicit permission to publish to GitHub. That initial attempt created no remote branch, pull request or preview. The user subsequently explicitly authorized push and merge. Publication proceeds through the connected GitHub account because the local Git checkout has no saved credentials. Follow-up corrections cover list pagination, profile email verification and invited private-bot membership. Final remote commit and merge status are supplied in the conversation handoff.
