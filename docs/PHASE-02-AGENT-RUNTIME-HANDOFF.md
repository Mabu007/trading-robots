# Phase 2 agent runtime: partial implementation and continuation

This phase is **not complete**. Start from the latest main and the containing PR/issue handoff, rather than assuming an old SHA. The parent baseline inspected was 51a780cabacb682a8f0c4b786289f2243f42c3f9, with production deployment dpl_33JPGSXGcNaiwQCRaueohn778JPN.

## Implemented
- Correct the SDK streaming route to move legacy system messages into the installed AI SDK's instructions option; the SDK rejects system messages inside messages. Add server-owned instructions that retrieved content is untrusted, saved simulations are not live fills, and writes need actual authorized results.
- Add typed read-only SDK tools for an exact user-owned strategy ID: saved strategy source (bounded to 20,000 characters, with SHA-256 and truncation flag), saved backtest summary and one simulated backtest trade by index. Stored owner and bot ID are verified. Gzip payloads have format, size and output bounds; absent or invalid evidence fails closed. None of these tools can place orders, alter strategy code or write records.
- Add capability descriptors and scoped schemas. These three tools are only included in the opted-in SDK market-conversation path; they are deliberately excluded when external research mode is active to avoid sending user strategy data into third-party web search. The model selects from the small available toolset. This is not yet the full dynamic platform registry.
- Extend local authenticated HTTP fixture to cover app-like system instructions and model-selected saved strategy and backtest tool calls, using a test signing key and mocked provider/storage. Unit tests cover ownership mismatch, compressed records, malformed sizes, missing data and simulated-trade labeling. Fixtures are not real user/model verification.

## Still required before enabling primary SDK chat
- Integrate version-compatible useChat with existing React UI, preserving user-owned conversations, streaming/progress, cancellation, retry, model and skill settings, tool results and concurrent chat isolation. Current production continues to use the legacy chat route by default.
- Migrate strategy discovery and edits, actual backtest execution, live trade context, broker status, monitors and approval workflows into scoped server-side SDK tools. The new tools only read exact saved IDs, and saved backtest inspection is simulation evidence, not a real broker transaction.
- Complete tool-registry metadata, progressive discovery, health and limits, persistence and meaningful parallel orchestration.
- Implement durable approval binding and execution-boundary enforcement for exact owner/account/instrument/action/parameters/version/risk/expiry and idempotent continuation. Existing client-side review code is not proof of this requirement. Never enable an unprotected financial write.
- Test signed-in conversation restoration, strategy editing, actual or fixture-backed backtest execution, real trade context, approval/denial/expiry and race, cancellation and concurrent chats. Perform a real authenticated model/tool workflow and provider checks before switching the build flag. R2/Cloudflare deployed state and real broker access remain unverified.
- Complete cross-instance provider caching and rate limiting in Phase 3. Current L2 cache is per process.
- GitHub Actions was blocked in phase 1 by GitHub account billing; recheck actual run annotations instead of declaring CI healthy based on local tests.

## Continuation
Keep VITE_AI_SDK_CHAT_ENABLED unset or false in production until Phase 2 parity and verification are complete. Do not claim this phase is complete or that live SDK, brokers, OAuth or user workflows were verified. Update issue 62 with exact merged/preview/production commits and further test evidence.
