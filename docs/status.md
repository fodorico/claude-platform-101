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

## Next

- Conversations (multi-turn): the history panel lists conversations instead of single
  questions, and earlier messages are sent as context. Branch `feat/conversations`, after the
  side panels PR is merged.
- Continuous deployment: hosting target not chosen yet (options considered: Google Cloud Run,
  Render, a VPS). Images are already published to GHCR on every merge to main.
- Try it with a real `ANTHROPIC_API_KEY`.
- Ideas as the course advances: multi-turn conversations, tool use, an MCP server
  (Building with the Claude API / Intro to MCP).

## Open questions

- None.
