import { starterCode } from './strategy';

const supported = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1'];

/** Instructions copied to an external AI. Keep this aligned with the strategy runtime. */
export function strategyDocumentation(asset: string, availableTimeframes: string[]): string {
  const available = availableTimeframes.filter(tf => supported.includes(tf));
  const exampleTimeframe = available.includes('m1') ? 'm1' : available[0] || 'm1';
  const example = starterCode.replaceAll('"m1"', `"${exampleTimeframe}"`);
  return `# Trading Vibes strategy-writing guide

You are writing a single JavaScript strategy for Trading Vibes. Turn the user's rules into clear, deterministic signal logic that works with the platform's backtester and its strategy-execution interface. Ask a brief question if a rule needed for entry, stop loss or target is missing; never invent market data or results.

## Current workspace
- Selected instrument: ${asset}.
- Listed historical timeframes: ${available.length ? available.join(', ') : 'not loaded yet; ask which stored timeframes are available'}.
- Supported timeframe names: ${supported.join(', ')}. Use only timeframes that have historical data for this instrument.

## Required file
Return the complete contents of one plain JavaScript ES module named strategy.js. It must have exactly these two exports:
1. export const config = { ... }; with a static JSON-style object and a semicolon. Do not use expressions, variables, comments inside the object, or trailing commas in config.
2. export function onCandle(ctx) { ... } as a synchronous function.

Config requires timeframes (a nonempty array), executionTimeframe (a supported timeframe, included in timeframes), riskPercent (greater than 0 and at most 10), and riskReward (greater than 0). Helper functions and constants may be declared in the same file without export. Do not add imports, require(), extra exports, network requests, file access, a command-line runner, DOM access, credentials, direct broker orders, timers or async functions. Use native JavaScript only.

## What the strategy receives
onCandle is called after each execution-timeframe candle closes. ctx contains:
- ctx.candle: the current execution candle.
- ctx.index: its zero-based index in the execution dataset.
- ctx.timeframes[timeframe]: an array of up to 1,000 completed candles, ordered oldest to newest. Other timeframes include only candles closed by the current execution candle's close; never use later bars.
- Each candle is { time, open, high, low, close, volume }; time is a Unix timestamp in seconds, and prices and volume are numbers.

Guard against insufficient history and return WAIT while indicators warm up. Calculate everything from these runtime candles. Do not assume ctx.position, account balance, broker prices, live orders, future candles, external indicators or persistent storage exist. Keep logic deterministic and efficient; do not rely on unbounded global state across runs.

## Signal and protective levels
Return { action: "WAIT" } when no entry is valid. Otherwise return { action: "BUY" | "SELL", stopLoss: number, takeProfit: number, reason?: string }. For BUY, both prices must be positive and stopLoss < ctx.candle.close < takeProfit. For SELL, takeProfit < ctx.candle.close < stopLoss. Validate finite prices and a positive risk distance. Levels must also remain valid at the next candle's open or the backtester skips the entry. Do not return CLOSE, HOLD, limit orders, position size or invented fields as substitutes for these actions.

## How the platform backtests
The script contains strategy and signal logic; Trading Vibes supplies the historical candles and runs the backtest engine. Do not write a second simulator inside strategy.js. A signal at candle close fills at the next execution candle's open. The simulation has at most one open position; ignores entries while a position is open; closes at stop or target, or at the final close; and assumes the stop is hit first if both levels touch in one candle. Stop gaps on later candles can fill at the open. Results and drawdown are in R multiples, not cash. config.riskPercent is validated but does not set monetary position size in the browser backtest. config.riskReward is a strategy parameter; the strategy must calculate the target itself.

Optional static config fields backtestSpread and backtestSlippage use price units, and backtestCommissionR uses R per trade. Their default is zero; swaps and contract-value conversions are not modeled. Do not claim a backtest result or profitability without running a test on real supplied data.

## Execution boundary
Use the same onCandle signal logic for the platform's execution interface. The script does not itself connect to a broker, place orders or include the backtest engine. Broker execution, risk checks, infrastructure and demo approval are separate and must be configured and verified; live trading is not guaranteed to be enabled. Backtest fills and real or demo broker fills can differ. A GitHub repository can store this strategy file, but running it standalone requires a separate compatible runner.

## Valid example — adapt it to the user's actual rules
\`\`\`js
${example}
\`\`\`

Now write the complete strategy for these rules (the user will provide them below):`;
}
