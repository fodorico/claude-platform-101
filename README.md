# Claude Platform 101

A small full-stack app built while taking Claude Platform 101: you send a message, the backend
asks the configured model (Claude by default, or Gemini), and the question and answer are stored
and shown as a history.

## Stack

- **Backend** (`backend/`): Python 3.15, FastAPI + Uvicorn, pydantic-settings, PostgreSQL with
  SQLAlchemy 2 (async) + Alembic, Anthropic Python SDK and Google Gen AI SDK. Ruff, mypy
  (strict), pytest + Testcontainers.
- **Frontend** (`frontend/`): React + TypeScript (strict), Vite, React Router, TanStack Query,
  React Hook Form + Zod, Tailwind CSS + daisyUI, lucide-react, Motion. ESLint, Prettier, Vitest,
  Playwright + axe.
  Served by nginx in production.
- **API contract**: the frontend client (`frontend/src/api/generated/`) is generated with orval
  from the backend OpenAPI schema. Never edit it by hand.
- **Infra**: Docker + docker-compose, GitHub Actions, Dependabot, pre-commit.

## Run everything with Docker

```bash
cp .env.example .env   # then set ANTHROPIC_API_KEY, or LLM_PROVIDER=gemini + GEMINI_API_KEY
docker compose up --build
```

Open http://localhost:8080. Migrations run automatically when the API starts.

## Local development

Requirements: `uv`, Node 26, Docker.

```bash
# Database (the compose one is not exposed on the host)
docker run -d --name cp101-db -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app \
  -e POSTGRES_DB=app -p 5432:5432 postgres:18

# Backend (http://localhost:8000, docs at /docs)
cd backend
cp .env.example .env   # set the provider's API key
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload

# Frontend (http://localhost:5173, proxies /api to the backend)
cd frontend
npm ci
npm run dev
```

Git hooks: `cd backend && uv run pre-commit install`.

## Checks

| | Backend (`backend/`) | Frontend (`frontend/`) |
|---|---|---|
| Lint | `uv run ruff check .` | `npm run lint` |
| Format | `uv run ruff format .` | `npm run format` |
| Types | `uv run mypy` | `npm run typecheck` |
| Tests | `uv run pytest` (needs Docker) | `npm test` |
| End-to-end + accessibility | — | `npm run test:e2e` (first time: `npx playwright install chromium`) |

## API

- `POST /api/messages`: send a message and get the stored exchange in one response. Body:
  `content`, plus optional `conversation_id` (none starts a new chat), `provider` and `model`.
  Earlier messages of the conversation are sent as context.
- `POST /api/messages/stream`: same, streamed as server-sent events (`delta`, then `done`, then
  `title` for a new chat; or `error`). The UI uses this one.
- `GET /api/conversations`: chats, latest activity first. `GET /api/conversations/{id}/messages`:
  a chat's exchanges, oldest first.
- `PATCH /api/conversations/{id}` (rename with `title`, archive with `archived`),
  `DELETE /api/conversations/{id}`, and `POST /api/conversations/bulk` (`ids` + `action`:
  `archive`, `unarchive` or `delete`). `GET /api/conversations?archived=true` lists archived chats.
- `GET /api/model-settings`: providers (and whether they have an API key), their models, max
  tokens and system prompt. Interactive docs at `/docs`.

## Changing the API

1. Change the backend (and add an Alembic migration if the database changes:
   `uv run alembic revision --autogenerate -m "..."`).
2. Regenerate the client: `cd frontend && npm run api:generate`.
3. Commit both. CI fails if the generated client is out of date.

## Configuration

Backend settings are environment variables (see `backend/app/config.py`):

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://app:app@localhost:5432/app` | |
| `LLM_PROVIDER` | `claude` | Default provider: `claude` or `gemini` |
| `ANTHROPIC_API_KEY` | — | Without it, Claude is shown but can't be picked |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Claude's default model |
| `ANTHROPIC_MODELS` | `["claude-opus-5-5","claude-sonnet-5-5"]` | JSON list offered in the model picker |
| `ANTHROPIC_EFFORT` | `low` | `low` to `max`; low keeps simple answers fast and cheap |
| `GEMINI_API_KEY` | — | Without it, Gemini is shown but can't be picked |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | Gemini's default model |
| `GEMINI_MODELS` | `["gemini-flash-lite-latest","gemini-flash-latest"]` | JSON list offered in the model picker |
| `MAX_TOKENS` | `16000` | Maximum answer length, both providers |
| `TIMEOUT_SECONDS` | `60` | |
| `SYSTEM_PROMPT` | Brief, simple answers | |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | JSON list |
