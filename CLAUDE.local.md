# claude-platform-101

Practice app for the Claude Platform 101 course (step 2 of the `tech-lead-career` plan):
send a message to Claude, store the exchange, show the history. Keep it simple; grow it
step by step (Building with the Claude API, then MCP).

- Stack follows `~/Proyectos/docs/starter-project.md` (v2); deviations are recorded in
  `docs/decisions.md`.
- UI copy is in **English**.
- Read `docs/status.md` at the start of a session.
- Before finishing a change, run all checks (see README "Checks"); backend tests need Docker.
- Any backend API change: regenerate the client (`cd frontend && npm run api:generate`) and
  commit it together with the backend change.
- Database changes always go through an Alembic migration.
- The Claude call lives in `backend/app/services/claude.py`; tests never call the real API
  (fake service for endpoint tests, httpx2 mock transport for the service itself).
