# PropDAO, public research and connected apps

PropDAO remains the primary trading path. GOLDUSDC replay uses exact `xyz:GOLD` reference candles from the R2 archive and public Hyperliquid. Public Hyperliquid only exposes recent candles. Coverage fields report the actual requested window and missing candles, including intervals unavailable outside public retention. The reference feed is distinct from PropDAO order and fill data.

Chat can discover IMF, EconData, Trading Economics, CFTC and OECD sources, retrieve public HTTPS HTML, JSON, CSV and XML, and cite the source and date. A public catalogue or API document does not imply access to subscription datasets. Public reads have an isolated tool set, validate public IP addresses and redirects, and limit data size. Composio discovers its own tool catalogue and uses the signed-in user's active connected account. A write requires review of the exact destination, action, parameters and version. Market and brokerage execution remain native.

The Strategy sidebar label is a presentation change. The existing strategy editor and backtester retain their current semantics.

## Market-triggered monitor outputs

The existing Code Watch Durable Object can record detections, summarize a qualifying new detection with the owner's OpenRouter connection, or send a bounded Telegram message to an explicitly approved connected account and chat ID. These are read-only market workflows. The server claims an event at most once and limits outputs per watch to one every 15 minutes. Stopping revokes future output. Broker order execution and P&L backtests are separate.

To activate unattended delivery, deploy `workers/wrangler.code-watch.jsonc` to the production Cloudflare account with `CODE_WATCH_ENABLED=true`, `CODE_WATCH_CALLBACK_URL` set to the Vercel production origin, and a strong `CODE_WATCH_INTERNAL_SECRET`. Set the same secret plus `CODE_WATCH_ENABLED=true`, `CODE_WATCH_OUTPUTS_ENABLED=true` and `CODE_WATCH_RUNTIME_URL` on Vercel. Verify the worker's authenticated health endpoint, the monitor start response, and a qualifying event before claiming live delivery. Existing PropDAO Worker bindings are separate. The outputs remain disabled if the required configuration is missing.
