# VALR runtime status

VALR supplies market pairs, historical candles and public live quotes. Strategies are created in the app and run in the browser backtester or isolated Cloudflare paper Worker. Account credentials are encrypted server-side. R2 is used for private application storage, not market data.

The old broker gateway, worker, queue configuration and execution routes have been removed from the repository. Deleting source files does not stop separately deployed Workers or cancel any exchange orders. The live VALR coordinator remains unconnected and live orders are disabled.

The paper runtime supports active spot pairs and BUY signals. It does not simulate fees or slippage and limits historical replay to 5,000 source candles per timeframe. User bot data, publications and deployed resources are not automatically removed by a code deployment.

Before exposing live orders, complete and verify the conditional-to-exit fill link, idempotent daily-loss accounting, per-user live authorization, and end-to-end account checks. Triggered, partially filled, missing or ambiguous orders must not be treated as settled.
