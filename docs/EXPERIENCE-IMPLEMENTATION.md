# Trading Vibes — Experience implementation and release checklist

Target blueprint: *Trading Vibes — The Experience Blueprint*, 5 November 2026.
Integration base: \`main\` at commit \`d6257cbd0a8b4a2d7a40cae64abb1006136cc6cd\`.
Change type: UX only. No broker contract, risk engine, simulation model or Worker deployment is modified.

## Implemented in the UI-specific branch

- Signed-out marketing entry: fresh chat-first visual language, honest capabilities and risk disclaimer.
- S02 first-run intent: one decision, four paths, skip, persisted per account/device.
- S05 guided learning: five interactive educational lessons, progress saved on this device, knowledge checks and optional AI follow-up. Content is education, not financial advice.
- S03–S04 AI chat: authenticated streaming via existing \`/api/ai\`, cancellation, visible failures, conversation history stored locally on this device, loading indicators and contextual actions. This chat does not pretend to have tool access it does not have.
- S06–S07 markets: watchlist saved on this device, real venue market discovery, search, historical OHLC chart with timeframe selection, source and last completed candle timestamp, and data-grounded AI context with stated limitations.
- S08–S09 creation entry: agent-create action wired to existing builder; searchable mobile market sheet replacing dense dropdown in creation.
- S13 agent library: actual account bots, draft/backtest distinctions and link to existing workspace. No fabricated active/running badges.
- S15/S20 account navigation: actual VALR and PropDAO account manager, AI credentials, existing profile and subscription screens, clear other-venue limitations.
- UX architecture: four stable destinations Chat / Markets / Agents / You, dark quiet-intelligence palette, responsive navigation, keyboard/touch target handling.
- Shared colors and typography extended over existing builder / editor / chart workspace without modifying order execution.

## Reused existing engine/workflows (must be regression-tested)

- S01 Firebase sign-in; legacy authentication form remains.
- S10 Strategy editor and version history.
- S11 Backtest setup and progress.
- S12 Backtest results and detailed trades.
- S14 Agent monitoring.
- S16 Actual deployment permissions and risk checklist.
- S17–S18 Execution activity and trade detail.
- S21 Marketplace and creator tools (existing dashboard).
  
## Not falsely represented as completed

- Extended adaptive learning curriculum beyond the five shipped beginner lessons; full AI-authored lessons and multi-device cloud-synced progress are not enabled.
- S19 cross-agent push notification centre (explicitly labelled unavailable).
- S22 voice assistant (microphone disabled and labelled as planned).
- Cloud-synced *general assistant* thread history across devices (threads currently persist on this device only).
- Full real-time market quote streaming on Markets screen (historical candles only; no live quote claim).
- Verified Hyperliquid/cTrader account linking (new entry surface directs to supported workspace; completion requires separate verified integrations).
- Market order submission directly from general chat (intentionally unavailable; explicit approval remains in existing execution flows).

## Required QA before release

1. Confirm \`npm test\`, \`npm run build\`, \`npm run check:runtime\` and worker dry-run builds.
2. Verify 320 / 360 / 390 / 430 / 768 / 1280 CSS widths, Android virtual keyboard, iPhone safe areas, reduced motion and large text.
3. Verify Firebase new signup, existing login and sign-out.
4. Confirm no draft/code/backtest/chat data disappears when navigating back from existing workspace.
5. Send an educational AI message with a configured OpenRouter key; verify streaming, stop, retry/error and no unsupported live-data claims.
6. Navigate each market venue, search instruments and load a historical chart; test unavailable provider, empty market, missing candles and stale history.
7. Create, save, load and backtest one robot; confirm previous data and risk assumptions preserved.
8. Connect PropDAO/VALR only using their existing secure flows; no automatic orders.
9. Validate paused/stopped/deployed/live/uncertain UI states in an actual account and inspect protective-order metadata.
10. Verify CSP, screen reader labels, focus/escape behavior for dialogs, list keyboard interaction and responsive overflow.

## Branch and release boundaries

Do not merge this UI branch into main or deploy trading Workers without explicit release approval. Preserve PR #50 and issue #51 so Astra's unfinished integration can be compared later. GitHub preview builds may run automatically on branch pushes; this branch was created as a batch commit to minimise unnecessary pushes.
