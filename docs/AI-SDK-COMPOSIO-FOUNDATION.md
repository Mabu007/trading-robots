# Trading Vibes AI SDK + Composio foundation

This is an isolated incremental integration. It does not replace the existing production OpenRouter /api/ai chat, Firebase conversations, market history, or any live trading Worker.

- POST /api/ai-sdk/chat: Firebase-authenticated read-only AI SDK streaming using the user's existing OpenRouter credentials, bounded inputs and a deterministic Hyperliquid completed-candle tool. It cannot trade.
- GET /api/apps/catalog, GET /api/apps/connections, POST /api/apps/connect: restricted Composio sessions for Telegram, GitHub, Google Drive/Sheets, Gmail, Notion and Discord. Authenticated users have independent connection namespaces. Existing broker routes remain native.
- The existing Apps page adds searchable Composio cards and status/authorization UI while retaining native broker controls.
- server/account-routing.ts defines strict owner-scoped explicit account resolution, **not yet wired to existing trading execution**.

Environment: COMPOSIO_API_KEY server-side; optional APP_URL for OAuth callback; existing OpenRouter credentials reused. Do not expose secrets to browsers.

Still not complete: main chat replacement/persistence, multi-account Composio account selection/disconnect, durable Cloudflare monitors and notification delivery, native multi-broker orchestration, voice, MCP, coding agents, production broker verification, real-user OAuth tests, end-to-end workflow acceptance. No live order submission has been added.

Production release should be held until real-user OAuth, streaming, Firebase and broker regressions are verified. Existing live-trading code is untouched.
