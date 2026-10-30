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
- **2026-10-30 — Managing chats.** Archiving is a nullable `archived_at` on conversations (not a
  separate table): archived chats are listed apart (`GET /api/conversations?archived=true`) and
  writing in one brings it back. Deleting is permanent and removes the messages (database
  cascade); the UI always asks for confirmation. Several chats are archived, restored or deleted
  with one request (`POST /api/conversations/bulk`, up to 100 ids, unknown ids skipped).
- **2026-10-30 — Chat polish.** Regenerating and editing only apply to a chat's last exchange
  (`replaces_id`): the old exchange is deleted in the same transaction that stores the new one,
  so a failed or stopped answer keeps the original. Stopping aborts the request; the server
  stores nothing for it. Code is highlighted with `rehype-highlight` (highlight.js, no language
  auto-detection to keep it cheap) and colored from the daisyUI theme variables, so both themes
  pass axe contrast checks. History search is a case-insensitive `ILIKE` over titles and
  messages, fine at this size; a full-text index can come later.
- **2026-10-30 — Chat studio.**
  - *Versions instead of replacing.* Regenerating or editing no longer deletes the old answer:
    exchanges carry `version_of` (the first exchange of the turn) and `is_active`. Only active
    exchanges are sent as context and exported. Switching versions is limited to the last turn so
    later messages never refer to an inactive answer.
  - *Images in the database.* Attachments are `bytea` rows (up to 4 × 3 MB per message), simple
    and transactional at this size; object storage can come later. nginx allows 20 MB bodies.
    Regenerating a turn reuses its images.
  - *Settings per chat.* System prompt, temperature, max tokens and reasoning are stored on the
    conversation; empty means the server default. Current Claude models reject sampling
    parameters, so temperature only applies to Gemini.
  - *Reasoning.* Claude uses adaptive thinking with summarized display. Gemini needs
    `include_thoughts` plus `thinking_budget=-1`: Flash-Lite doesn't think otherwise.
  - *Caching and cost.* Claude requests use automatic prompt caching (top-level `cache_control`);
    cache reads and writes are stored per exchange. Costs are estimates from the `MODEL_PRICES`
    list (prefix match), shown as "estimated" and meaningful only on a paid tier.
  - *API call inspector.* Each exchange stores the request parameters and the provider's raw
    usage (`api_call`, JSONB); the messages are rebuilt from the stored context ids, with image
    bytes replaced by their size.
- **2026-10-30 — Reload after a deploy.** The build emits `version.json` with a unique id and
  nginx serves it with `no-store`; open pages poll it every 5 s while visible (production builds
  only) and reload when it changes, unless the user is busy (typed text, an answer streaming or a
  dialog open), in which case they show a Reload notice. nginx re-resolves the `api` host through
  Docker's DNS (`resolver 127.0.0.11`), so recreating only the API container no longer leaves
  nginx pointing at the old IP (502).
