# Claude Platform 101

A small full-stack app built while taking Claude Platform 101: you send a message, the backend
asks Claude, and the question and answer are stored and shown as a history.

## Stack

- **Backend** (`backend/`): Python 3.15, FastAPI + Uvicorn, pydantic-settings, PostgreSQL with
  SQLAlchemy 2 (async) + Alembic, Anthropic Python SDK. Ruff, mypy (strict), pytest +
  Testcontainers.
- **Frontend** (`frontend/`): React + TypeScript (strict), Vite, React Router, TanStack Query,
  React Hook Form + Zod, Tailwind CSS + daisyUI, lucide-react, Motion. ESLint, Prettier, Vitest.
  Served by nginx in production.
- **API contract**: the frontend client (`frontend/src/api/generated/`) is generated with orval
  from the backend OpenAPI schema. Never edit it by hand.
- **Infra**: Docker + docker-compose, GitHub Actions, Dependabot, pre-commit.

## Run everything with Docker

```bash
cp .env.example .env   # then set ANTHROPIC_API_KEY
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
cp .env.example .env   # set ANTHROPIC_API_KEY
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
| `ANTHROPIC_API_KEY` | — | Required to talk to Claude |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | |
| `ANTHROPIC_EFFORT` | `low` | `low` to `max`; low keeps simple answers fast and cheap |
| `ANTHROPIC_MAX_TOKENS` | `16000` | |
| `SYSTEM_PROMPT` | Brief, simple answers | |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | JSON list |
