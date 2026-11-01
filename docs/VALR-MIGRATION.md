# VALR runtime status

VALR supplies market pairs, historical candles and public live quotes. Strategies are created in the app and run in the browser backtester or isolated Cloudflare paper Worker. Account credentials are encrypted server-side. R2 is used for private application storage, not market data.

The old broker gateway, worker, queue configuration and execution routes have been removed from the repository. Deleting source files does not stop separately deployed Workers or cancel any exchange orders. The live VALR coordinator is connected through an authenticated internal provider bridge and a per-connection Durable Object. Live orders remain disabled until infrastructure and real exchange verification gates are explicitly configured.

The paper runtime supports active spot pairs and BUY signals. It does not simulate fees or slippage and limits historical replay to 5,000 source candles per timeframe. User bot data, publications and deployed resources are not automatically removed by a code deployment.

Unit and local Cloudflare tests cover protective client-ID exit summaries, idempotent daily-loss accounting, per-strategy authorization, restart recovery and duplicate protection. Before enabling real orders, verify the conditional-to-exit client ID behavior, actual fill fees and timestamps, account ownership/isolation and real-account end-to-end behavior. Triggered, partially filled, missing or ambiguous orders must not be treated as settled.
