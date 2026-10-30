# Status

## Done

- v0.1 scaffold: backend, frontend, Docker, CI, pre-commit, Dependabot (2026-10-29).

- Streaming answers (server-sent events) for Claude and Gemini (2026-10-30).
- Chat UI redesign: conversation layout, Markdown answers, light/dark theme (2026-10-30).
- End-to-end tests (Playwright, desktop + mobile) with axe accessibility scans in CI; fixed
  low-contrast text found by axe (2026-10-30).
- Side panels: history (past questions by day) and request details (time to first token, total
  time, tokens, stop reason, model settings), both collapsible; theme toggle next to the app name
  (2026-10-30).
- Conversations (multi-turn) with titles written by the model, and a model picker in the header
  (2026-10-30).
- Manage chats from the history: rename, archive/unarchive, delete (with confirmation), and
  select several to archive or delete at once (2026-10-30).
- Chat polish: stop, regenerate and edit the last message, retry on error; chat title with
  Markdown export; history search; keyboard shortcuts; code highlighting with copy; short model
  names; scroll-to-latest; per-chat totals in the details panel (2026-10-30).
- Chat studio: per-chat settings (system prompt, temperature, max tokens), visible reasoning,
  image attachments, answer versions with side-by-side compare and "try another model", fork a
  chat, pinned chats, prompt library, answer ratings, token count before sending, estimated cost
  and cache tokens, an API call inspector, dictation and read aloud (2026-10-30).

## Next

- Continuous deployment: hosting target not chosen yet (options considered: Google Cloud Run,
  Render, a VPS). Images are already published to GHCR on every merge to main.
- Try it with a real `ANTHROPIC_API_KEY` (Claude reasoning, caching and vision were only
  covered by tests; Gemini was tried for real).
- Prices in `MODEL_PRICES` defaults are a snapshot (Gemini 3.6 Flash's launch price ends
  2026-12-31); review them now and then.
- Ideas as the course advances: tool use, an MCP server
  (Building with the Claude API / Intro to MCP).

## Open questions

- None.
