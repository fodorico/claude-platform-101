# Decisions

- **2026-10-29 — Scope of v0.1.** Solid base, minimal features: one screen with a message box,
  one endpoint that asks Claude, every exchange stored in PostgreSQL. Sentry, OpenTelemetry,
  Playwright and AG Grid are left out until they are needed.
- **2026-10-29 — Model and effort.** `claude-opus-5-5` at effort `low` (simple answers), with
  server-side refusal fallbacks (`fallbacks: "default"`). Both configurable by env var.
- **2026-10-29 — Non-streaming request.** Answers are short; streaming can come later if
  answers get longer.
- **2026-10-29 — TypeScript 6.0, not 7.** typescript-eslint 8 only supports TypeScript < 6.1.
  Revisit when it supports 7.
- **2026-10-29 — orval for the API client.** openapi-typescript requires TypeScript 5 as a peer;
  orval works with 6 and also generates the TanStack Query hooks.
- **2026-10-29 — Anthropic SDK 2.x uses httpx2.** The SDK's HTTP layer is `httpx2`, so service
  tests mock it with `httpx2.MockTransport`. `httpx` stays for the app's own HTTP needs and the
  FastAPI test client.
- **2026-10-29 — Gemini as an optional provider.** The Anthropic API is billed separately from
  the Claude subscription and the account has no API credit yet, so Gemini (free tier) can answer
  instead, chosen with `LLM_PROVIDER`. Claude stays the default so the course practice keeps
  using the Claude API. Both providers sit behind `app/services/llm.py`.
- **2026-10-30 — Public repository with a protected main.** Rulesets need GitHub Pro on private
  repos, so the repo was made public (history checked for secrets first); it also serves as public
  evidence for the career plan. main accepts changes only through PRs with all CI jobs green.
- **2026-10-30 — Streaming with server-sent events over POST.** `POST /api/messages/stream`
  sends `delta`, then `done` (the stored exchange) or `error`. EventSource only supports GET, so the
  frontend reads the stream with `fetch` in `src/api/stream.ts`, whose event types mirror
  `StreamDelta` / `StreamError` by hand (the generated client can't consume SSE). The exchange is
  stored only when the answer completes. The non-streaming endpoint stays.
- **2026-10-30 — Chat UI.** Conversation layout (oldest first, auto-scroll, composer fixed at the
  bottom, Enter to send). Answers render as Markdown with react-markdown + remark-gfm (raw HTML is
  not rendered) and Tailwind Typography. daisyUI themes `nord` (light) and `dim` (dark): system
  preference by default, toggle saved in localStorage.
- **2026-10-30 — End-to-end and accessibility tests.** Playwright runs the user flows against the
  production build (`vite preview`) on a desktop and a mobile viewport, and axe checks WCAG 2.2 A/AA
  on every screen state in both themes. The API is mocked in the browser (`e2e/mock-api.ts`), so
  the suite needs no backend or database and stays fast; the backend keeps its own integration
  tests. Runs as the `e2e` CI job (report uploaded on failure).
- **2026-10-30 — Side panels and answer metrics.** The chat combines three explored layouts: a
  polished single column, a history panel (left) and a request details panel (right). Both panels
  are toggled from the header, start closed and the choice is saved in localStorage; below the
  `lg` breakpoint they are drawers over the chat. The API measures each answer's total time and,
  when streamed, the time to the first token (new nullable columns `duration_ms` and
  `first_token_ms`; older rows have none) and returns stop reason and token usage, which were
  already stored. `GET /api/model-settings` exposes provider, model, max tokens and system prompt
  for the details panel; this is a practice app, so showing the system prompt is intended.
- **2026-10-30 — Conversations, titles and model picker.** Exchanges belong to a conversation and
  each message is sent with the conversation's last 20 exchanges as context. A conversation is
  created with its first successful answer (failed first messages leave nothing behind), titled
  with the shortened first message, then retitled by the same model in a second short request
  (`title` server-sent event; the shortened message stays if that fails). The open chat lives in
  the URL (`/?chat=12`), so the page doesn't remount when a new chat gets its id mid-stream.
  Each request picks provider and model; `LLMRegistry` holds a service per provider with an API
  key, and the offered models come from `ANTHROPIC_MODELS` / `GEMINI_MODELS`. Providers without
  a key are listed but disabled in the picker. The migration turned each earlier exchange into its
  own conversation and inferred its provider from the model name. `GET /api/messages` was removed.
