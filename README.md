# Trading Vibes

Build and edit JavaScript strategies, backtest them using VALR market history, and deploy spot BUY strategies to the isolated VALR paper runtime. Connect a personal VALR account to inspect balances and account activity. **Live VALR order execution is not enabled.**

## Development

Use Node 24, run `npm ci`, then `npm run dev`. `npm test`, `npm run build`, `npm run check:runtime`, and `npm run test:valr-paper` validate the app and paper worker. The Vercel production project runs the Vite build and the API in `api/index.ts`.

Configure Firebase web and server credentials, private R2 storage, VALR and AI credential encryption keys, and the paper worker URL and internal secret. See `.env.example`. R2 stores user robot files, images and encrypted provider credentials; it is not a market-data source.

VALR history is paginated with a limit of 5,000 source candles per timeframe. Paper simulation uses VALR candles but does not model fees or slippage. It is a simulation and does not place orders. Before enabling any future live trading, complete verified exit-fill linkage, loss accounting, explicit authorization and real-account end-to-end testing.

Removing runtime source code does not stop already-deployed Workers or erase saved robots; production resources must be managed separately.
