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
