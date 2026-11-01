# Trading Vibes

A single workspace for drafting JavaScript strategies, loading public VALR historical candles, running deterministic candle-by-candle simulations, inspecting trades, and requesting AI edits.

## Run locally

Use Node 20.19 or newer, or Node 22.12 or newer. Install the dependencies, copy `.env.example` to `.env`, and connect a personal OpenRouter key to enable AI features. The server encrypts and stores the key; it is never embedded in the client bundle. The usual `npm run dev` command starts both Vite and the API server. Backtests use public VALR candles and run on the user’s machine.

```sh
npm install
npm run dev
```

Vite runs at `http://localhost:5173`; the API runs at `http://127.0.0.1:8787` by default. Set `API_PORT` (not the generic `PORT`) to change the backend port; the Vite proxy reads the same value. Supported instruments are selected from VALR markets. The requested date range and timeframe must be available from VALR; missing candles are reported.

## Vercel deployment

Deploy this repository as a Vite project with the default `npm run build` command and `dist` output. The `api/index.ts` function and `vercel.json` rewrites forward `/api/*` to the Express routes; the Vite dev proxy is local only. Set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID` for the production build. Set server-only `FIREBASE_PROJECT_ID` to the same Firebase project, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, independent `VALR_CREDENTIAL_ENCRYPTION_KEY` and `AI_CREDENTIAL_ENCRYPTION_KEY`, plus `VALR_PAPER_RUNTIME_URL` and `VALR_PAPER_INTERNAL_SECRET` for the paper runtime in Vercel's Production environment. Redeploy after changing build-time `VITE_*` values. Check `/api/health` and `/api/r2/status` after deploying; they should return JSON rather than the site's HTML.

Enable Email/Password under Firebase Authentication → Sign-in method. Existing Google-only accounts need a password set for their email before using email sign-in; verify the reset flow for those accounts before removing access.

The AI route requires a Firebase sign-in token and supports a personal OpenRouter key and model. The sections below describe the retained legacy R2 history tools; they are not the active VALR workspace. Market-data import overwrites shared R2 prices, so it is disabled until `MARKET_DATA_IMPORT_UIDS` lists the authorized Firebase user IDs, separated by commas. Backtest reads require R2 data in the documented prefixes. Vercel Functions have a request-body limit; for large historical files, upload directly into R2 using an admin ingestion process.

Authorized administrators can import CSV candles into the shared R2 bucket; ordinary users cannot overwrite shared market history. CSV headers must include `time` (or `timestamp`, `date`, `gmt time`), `open`, `high`, `low`, and `close`; `volume` is optional. Timestamps without an explicit timezone are treated as UTC. The importer validates every row, stores one JSON object per UTC date, reads each object back to verify the upload, and adjusts the chart date range to the imported data. Backtests read these R2 partitions. XAUUSD backtests also read supported OHLC files under the `xauusd/` prefix and aggregate finer intervals when needed.

For XAUUSD, the server lists and reads CSV, JSON, or TXT OHLC files under the `xauusd/` object prefix in the configured bucket (the bucket name itself is not part of the object key). These files are used by AI and backtests. The app lists only assets and dates found in R2; for M1 XAUUSD data it can aggregate those stored candles to slower strategy timeframes. The R2 token must allow object listing as well as reads; the app does not expose bucket credentials to the browser.

Firebase stores each user's bot metadata, R2 object pointers, and chat history. Strategy source and named versions are saved in the private R2 bucket, scoped to the Firebase user's UID. Set the Firebase Web app values in `VITE_FIREBASE_*` and the server-side R2 credentials in the `R2_*` variables in `.env`; never prefix R2 secrets with `VITE_`. In Firebase Console, enable Authentication → Sign-in method → Email/Password, create the default Firestore database, and deploy the included rules with `firebase deploy --only firestore:rules`. Add `localhost` to Authorized domains for local development and your production hostname before launch. New visitors see the Trading Vibes landing page and must register or sign in before opening the strategy workspace. Existing anonymous sessions from earlier app versions can link to an email/password account without changing their UID, preserving their saved robots. Local drafts continue to work if Firebase is unavailable. Firebase Web config is client-visible; access is scoped by Auth and `firestore.rules`.

## Strategy interface

Strategies are one JavaScript file with a static config and `onCandle(ctx)`. The app fetches all declared timeframes from VALR and exposes only bars whose close time is no later than the current execution candle's close. Strategy code receives the most recent 1,000 completed bars per timeframe. A signal from a completed candle fills at the next execution candle's open. Decisions must be `BUY`, `SELL`, or `WAIT`; BUY and SELL require correctly placed `stopLoss` and `takeProfit` prices.

The browser runner uses a fresh iframe with an opaque origin, a restrictive CSP that blocks network connections, and an 8 second parent-side timeout. The frame is removed after the run. This gives strategies no access to app storage or server credentials. Browsers do not expose a reliable per-frame memory quota, so memory exhaustion cannot be bounded here; for public multi-user hosting, move execution to a hardened separate process/runtime with OS resource limits.

## Simulation assumptions

- One open position at a time; no pyramiding.
- Signals are evaluated after candle close and filled at the next candle open.
- If stop and target both touch in the same candle, the stop is assumed to fill first.
- If a position remains open at the end of the range, it is closed at the final candle close.
- Performance is expressed in R multiples: price movement divided by entry-to-stop distance. The configured riskPercent is validated but not used for monetary sizing. Results are not monetary P&L, lot sizing, account balance, or a forecast.
- Backtests use public VALR candle prices. Spread, slippage, commission, swaps, and instrument contract values are not modeled. Results therefore are not broker execution estimates.
- Missing periods are not filled with fabricated prices; Gaps remain visible as gaps.

## Checks

`npm test` runs deterministic strategy/engine tests. `npm run build` type-checks the app and creates the Vite production bundle.


## Shared robot pages

Use **Share robot** in the workspace or a robot card. Add a cover and public description, then choose **Create free link**. The stable `/bot/<id>` URL is available without signing in. Publishing stores a snapshot of the current strategy; **Update page** publishes the latest snapshot. **Unpublish** revokes the public page and new copies. Deleting the original also removes its publication.

**Backtest** asks visitors to sign in and opens a private, editable copy in their workspace. Each account reuses its copy; opening the link again preserves that account's edits. Existing free copies remain with their recipients after unpublishing. Public metadata excludes source code, owner IDs, private chat, and backtest history. Code is supplied only to an authenticated recipient's copy. Paid publishing is rejected by the API until payments are implemented.

The previous cTrader flow is parked. VALR paper execution is available on the preview branch; real-money execution is not enabled. See [VALR migration](docs/VALR-MIGRATION.md) for limitations and deployment status.

### AI generation diagnostics

The server uses the user’s selected OpenRouter model without silently switching models. Users can choose another available model in AI settings. A stream ending with `finish_reason: length` has reached its output limit; ask for a smaller change or configure another model. Server logs include the model, completion status, finish reason and token count when available, without logging prompts or credentials. A successful stream alone does not establish that the generated strategy is valid or profitable.

### Chart drawings and monetary simulation

The chart toolbar provides pan, measurement and drawings. Drawings and a user-configured pip size are stored locally for the signed-in account, robot and instrument; they are not synced between devices. Set the pip size explicitly before relying on pip measurements.

Account balance defaults to R500. Enter the instrument contract size, minimum volume, volume step and quote-currency-to-ZAR conversion under Assumptions to enable monetary results. These are user-supplied simulation assumptions, not verified broker specifications. Spread and slippage are in price units; commission is round-trip ZAR per lot. These monetary cost inputs are independent of the strategy’s theoretical R cost settings. The model treats candles as mid prices, charges the full spread on entry and slippage on both fills, rejects trades below minimum volume or above supplied margin limits, and compounds on closed equity. Stops can gap beyond intended risk. Margin is not checked without leverage. Drawdown uses candle-close and closed-trade equity; intrabar paths, swaps, and changing conversion rates are not modeled. Results are simulations and do not change live trading.
