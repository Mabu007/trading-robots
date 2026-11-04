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
