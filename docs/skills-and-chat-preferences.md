# Skills library and per-conversation AI configuration

## User-owned Skills

Saved under Firestore \`users/{uid}/skills/{skillId}\` with existing owner-only rules. Skills are **plain text or Markdown**, never executable scripts. Each document contains a name, description, instructions, up to 12 optional trigger phrases, \`enabled\`, \`alwaysOn\`, and \`updatedAt\`.

Users can create, edit, import .md/.txt (maximum 16 KB), enable, disable, search and delete skills. All changes persist between devices using the user's authenticated account. The app does not import external URLs or run uploaded code.

At chat time, \`chooseSkills\` selects a maximum of **three enabled** skills in stable library order using a phrase match against the current user message, direct skill name reference or \`alwaysOn\`. \`skillPrompt\` bounds injected guidance to approximately **7 KB** total. These user-authored preferences can guide research, explanations and code proposals, but cannot override explicit deployment approval, broker risk controls, platform security, or trading execution rules. They are not market evidence.

The server's read-only news research branch normally removes older private strategy/chat context. For relevant skills, the client sends only the selected, bounded skill instructions, and the server includes them as user-authored task guidance. Public news-provider search strings still contain only the latest sanitized question, not the skill contents or private strategy source.

## AI configuration per chat

Each Firestore conversation document under \`users/{uid}/conversations/{chatId}\` has an optional \`model\` field. When null or absent, the account's default OpenRouter model is used. The chat composer contains a searchable model selector. Selecting a model saves only that conversation's preference; it does not modify the account default or other chats.

Before streaming, the server validates an explicitly selected model against the current OpenRouter models catalogue. Retries and continuation requests use the same chat model. Model-specific availability, context limits and possible costs still apply.

## Chat rename and deletion

The chat list provides accessible rename and delete controls. Rename stores an explicit \`title\` separately from messages. Normal message autosave uses a merging write, so the title and model cannot be reset by another message. For legacy conversations without a title, the list derives a label from the first user message.

Deletion requires confirmation, waits for queued per-conversation writes, deletes the owned Firestore conversation and marks it deleted locally to stop a delayed autosave from resurrecting it. The queue and tombstones are scoped to authenticated user ID plus conversation ID. Deleting the active chat opens a fresh blank conversation. Saved Code, Skills, broker credentials and account trade history are unaffected.

## Mobile and desktop shell

The mobile header has a compact, responsive toggle / context title / theme arrangement. Secondary areas (Code, Skills, Apps) display a page title instead of the Chat/Trades switch. The desktop chat scrollbar belongs to the full-width message viewport, while message text remains in a readable centered column. The composer, model selector, sidebar chat controls, dialogs and trading tables have narrow-screen overflow and safe-area handling.

## Tests and release

Run:
\`\`\`bash
npm run build
npm run check:runtime
npx vitest run
\`\`\`

This work does **not** change the PropDAO or VALR order placement, execution ledger, Durable Object trading runtime, broker authorization or strategy sandbox.
