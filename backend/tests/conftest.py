from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from testcontainers.community.postgres import PostgresContainer

from app.config import Settings
from app.db import create_engine
from app.main import create_app
from app.services.llm import LLMError, LLMReply, get_llm_service

BACKEND_DIR = Path(__file__).resolve().parent.parent


class FakeClaudeService:
    """Stands in for the LLM service so tests never call a real provider."""

    def __init__(self) -> None:
        self.prompts: list[str] = []
        self.error: LLMError | None = None

    async def ask(self, prompt: str) -> LLMReply:
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        return LLMReply(
            text=f"Reply to: {prompt}",
            model="claude-test",
            stop_reason="end_turn",
            input_tokens=10,
            output_tokens=5,
        )


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    with PostgresContainer("postgres:18", driver="asyncpg") as postgres:
        url = postgres.get_connection_url()
        config = Config(str(BACKEND_DIR / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")
        yield url


@pytest.fixture(scope="session")
async def engine(database_url: str) -> AsyncIterator[AsyncEngine]:
    engine = create_engine(database_url)
    yield engine
    await engine.dispose()


@pytest.fixture(autouse=True)
async def clean_tables(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.execute(text("TRUNCATE exchanges RESTART IDENTITY"))


@pytest.fixture
def fake_claude() -> FakeClaudeService:
    return FakeClaudeService()


@pytest.fixture
async def client(database_url: str, fake_claude: FakeClaudeService) -> AsyncIterator[AsyncClient]:
    app = create_app(Settings(database_url=database_url))
    app.dependency_overrides[get_llm_service] = lambda: fake_claude
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http_client,
    ):
        yield http_client
