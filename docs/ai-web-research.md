# AI partner — current market research

Trading Vibes AI chat now has a read-only, **server-side** research path when a conversational (non-code-edit) question requests news, live market context, macro drivers, sentiment or a market regime.

## Sources and limits
- Recent headlines: [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/), with Google News RSS fallback. No new API keys are needed. Headlines are dated, deduplicated, checked for safe HTTPS URLs, and limited to seven. A headline alone is not evidence for every claim in an article.
- General internet: OpenRouter's [web-search server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search), with **one search at most**, up to five results. Web search may use paid OpenRouter credits even if the LLM is a free model. The app falls back to public headlines/candles when an OpenRouter model/key rejects the search tool.
- Gold market structure: public Hyperliquid `xyz:GOLD` completed H1 candles. An indicative trend/range heuristic uses EMA20, EMA50 and 24-hour high/low, only if at least 60 candles are valid and the feed is fresh. This is **not** spot XAUUSD, a reliable trading signal, or broker fill evidence.
- If external research fails, the assistant must report which evidence is unavailable. Neither future-dated nor old article titles qualify as current.

## Privacy and execution isolation
- Never send personal OpenRouter credentials, broker keys, account balances, code from `strategy.js`, or earlier private messages to the web-search request. Search only the latest sanitized public question and optional short public follow-up.
- Public research is not strategy execution: no automated order placement, no account modification, no code edits, and no changes to Cloudflare trading runtimes.
- Firebase authentication, OpenRouter key encryption, streaming chat, and API usage accounting are retained.
- Links in assistant replies are rendered as HTTPS links with `rel=noopener noreferrer`.

## Validation
`npx vitest run server/ai-research.test.ts server/openrouter-account.test.ts src/api.test.ts && npm run build`

The Vercel 100-deployments/day cap can block verification/deployment; do not merge or describe the feature as live unless the exact production deployment SHA is READY.


## Strategy-edit intent (chat safety gate)

The AI chat defaults to answering questions. `src/chat-intent.ts` uses a
conservative strategy-edit classifier: the user's *first requested action*
must be a direct code/strategy modification, not a question about how
indicators, data, Cloudflare runtime, or deployment work. It understands
clear instructions such as "Please edit strategy.js to use EMA20" and
"Can you rewrite my bot as an M1 scalper" but treats "Why doesn't my
bot preload data before calculating indicators?" as a normal question.

An isolated "yes" is only treated as consent to edit if the previous AI
message explicitly offered a code edit in a question. The existing
code-syntax validation, strategy contract validation and manual Apply
flow are unchanged.

**PropDAO implementation note:** The existing Cloudflare Worker
`workers/propdao-live-object.ts` already loads approximately 210
*previously completed* Hyperliquid candles **per required timeframe**
on each evaluation. It does not wait to accumulate 210 future candles.
Its first evaluation is scheduled for the next completed execution
candle; strategies requiring longer history or missing/stale candles
may still not produce a signal. This PR intentionally does not alter
this working Worker runtime.

Chat intent regression coverage is in `src/chat-intent.test.ts`.
Execute `npx vitest run src/chat-intent.test.ts src/api.test.ts server/ai-research.test.ts && npm run build`
before merging PR #48.
