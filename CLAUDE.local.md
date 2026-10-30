# claude-platform-101

Practice app for the Claude Platform 101 course (step 2 of the `tech-lead-career` plan):
send a message to Claude, store the exchange, show the history. Keep it simple; grow it
step by step (Building with the Claude API, then MCP).

- Stack follows `~/Proyectos/docs/starter-project.md` (v2); deviations are recorded in
  `docs/decisions.md`.
- UI copy is in **English**.
- Read `docs/status.md` at the start of a session.
- Before finishing a change, run all checks (see README "Checks"); backend tests need Docker.
- After finishing a change, if the Docker stack is running, rebuild it
  (`docker compose up -d --build`): open pages notice the new version and reload themselves, so
  the user never has to refresh.
- Any backend API change: regenerate the client (`cd frontend && npm run api:generate`) and
  commit it together with the backend change.
- Database changes always go through an Alembic migration.
- The streaming events are the one hand-kept contract: change `StreamDelta` / `StreamError` in
  `backend/app/schemas.py` and `frontend/src/api/stream.ts` together.
- Model providers live in `backend/app/services/` (`claude.py`, `gemini.py`) behind the
  `LLMService` contract in `llm.py`; `LLM_PROVIDER` picks one. Tests never call a real API
  (fake service for endpoint tests; httpx2 mock transport for Claude, a stub client for Gemini).
